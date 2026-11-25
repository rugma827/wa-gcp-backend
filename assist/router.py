"""Assist — FastAPI Router (GCP-native).

Intent recognition via Vertex AI (Gemini), then dispatches to internal services.

Endpoints (UI contract — unchanged from AWS version):
  POST /assist/chat                  → intent classify + dispatch
  GET  /assist/progress/{task_id}    → SSE progress stream (Firestore)
  POST /assist/rebalance/confirm     → confirm borderline rebalance
"""

import asyncio
import json
import logging
import os
import uuid
from typing import Optional

import httpx
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from google import genai

from auth_dependency import verify_token
from google.cloud import firestore as _firestore
from meeting_prep.router import (
    _call_mcp_tool,
    _get_fs,
    _poll_firestore_progress,
    _ensure_meeting_context,
    _is_calendar_event_id,
    _resolve_client_name_from_event,
)
from bq_cache import put_cached, today as cache_today

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/assist", tags=["Assist"])

_PROJECT = os.getenv("GCP_PROJECT_ID", "agentic-wealthadvisor")
_LOCATION = os.getenv("GCP_LOCATION", "us-west1")
_MCP_URL = os.getenv("MCP_SERVER_URL", "https://wa-mcp-placeholder.run.app/mcp")

# ── Gemini client ────────────────────────────────────────────────────────────

_genai_client = genai.Client(vertexai=True, project=_PROJECT, location="global")

# ── Pydantic models ───────────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    message: str
    session_id: str = "default"
    conversation_history: list = []
    user_id: Optional[str] = None
    pending_intent: Optional[str] = None
    accumulated_params: Optional[dict] = None


class RebalanceConfirmRequest(BaseModel):
    client_id: str
    client_name: str
    user_id: Optional[str] = None


# ── Intent classification ─────────────────────────────────────────────────────

_INTENT_PROMPT = """You are an intent classifier for a wealth advisor assistant.
Classify the user message into one of: meeting_prep, rebalance, research, report, unknown.
Extract params: client_name (string or null), force_refresh (bool, default false).

Respond ONLY with valid JSON:
{
  "intent": "<intent>",
  "dispatch": <true if all required params present, else false>,
  "reply": "<conversational reply or follow-up question>",
  "params": {"client_name": "<name or null>", "force_refresh": false},
  "missing_params": ["client_name"] or []
}

Rules:
- meeting_prep requires client_name
- rebalance requires client_name
- research requires client_name or topic (put in client_name)
- report requires client_name
- unknown: politely decline and explain what you can do
- If pending_intent is provided and current message has no action word, treat it as a follow-up for that intent
"""


async def _classify_intent(message: str, history: list, pending_intent: Optional[str], accumulated_params: dict) -> dict:
    history_text = ""
    if history:
        history_text = "\n".join(f"{m['role'].upper()}: {m['content']}" for m in history[-4:])

    prompt = f"""{_INTENT_PROMPT}

{"Conversation history:\n" + history_text if history_text else ""}
{"Pending intent from previous turn: " + pending_intent if pending_intent else ""}
{"Already collected params: " + json.dumps(accumulated_params) if accumulated_params else ""}

USER: {message}"""

    try:
        response = await asyncio.to_thread(
            _genai_client.models.generate_content,
            model="gemini-3.5-flash-lite",
            contents=prompt,
        )
        text = response.text.strip()
        # Strip markdown code fences if present
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        return json.loads(text.strip())
    except Exception as exc:
        logger.error("Intent classification failed: %s", exc)
        return {
            "intent": "unknown",
            "dispatch": False,
            "reply": "I'm having trouble understanding that. Please try again.",
            "params": {},
            "missing_params": [],
        }


# ── Dispatch helpers ──────────────────────────────────────────────────────────

async def _dispatch_meeting_prep(client_name: str, uid: str, force_refresh: bool = False) -> dict:
    """Kick off meeting prep via MCP — returns pending result with task_id."""
    if _is_calendar_event_id(client_name):
        resolved = _resolve_client_name_from_event(uid, client_name)
        if resolved:
            client_name = resolved

    task_id = uuid.uuid4().hex
    task = f"Generate full meeting brief for {client_name}"
    today = cache_today()

    async def _bg():
        try:
            result = await _call_mcp_tool("get_meeting_brief", {"task": task, "task_id": task_id})
            status = result.get("status")
            if status not in ("ok", "partial"):
                _get_fs().collection("meeting_prep_progress").document(task_id).set({
                    "pct": 100, "message": "Failed", "done": True,
                    "result": {"type": "error", "message": result.get("data", {}).get("message", "Meeting prep failed")},
                    "updated_at": _firestore.SERVER_TIMESTAMP,
                })
                return
            data = result.get("data", {})
            meeting_id = data.get("meeting_id") or f"direct_{uuid.uuid4().hex[:8]}"
            client_id = data.get("client_id", "")
            brief = data.get("result", data)
            # Ensure client_id is accessible on brief.client for frontend navigation
            if client_id and isinstance(brief.get("client"), dict) and not brief["client"].get("customerId") and not brief["client"].get("clientId"):
                brief["client"]["customerId"] = client_id
            _ensure_meeting_context(client_id, meeting_id, today)
            put_cached(f"cockpit#{meeting_id}", today, brief)
            _get_fs().collection("meeting_prep_progress").document(task_id).set({
                "pct": 100, "message": "Meeting brief ready", "done": True,
                "result": {
                    "type": "meeting_prep",
                    "data": brief,
                    "meeting_id": meeting_id,
                },
                "updated_at": _firestore.SERVER_TIMESTAMP,
            })
        except Exception as e:
            logger.error("[assist] meeting_prep bg task failed: %s", e, exc_info=True)
            try:
                _get_fs().collection("meeting_prep_progress").document(task_id).set({
                    "pct": 100, "message": "Failed", "done": True,
                    "result": {"type": "error", "message": str(e)},
                    "updated_at": _firestore.SERVER_TIMESTAMP,
                })
            except Exception:
                pass

    asyncio.create_task(_bg())
    return {"type": "meeting_prep_pending", "task_id": task_id}


async def _dispatch_rebalance(client_name: str, client_id: str = "") -> dict:
    """Call rebalance MCP tool — returns result or pending."""
    try:
        result = await _call_mcp_tool("run_rebalancing", {"task": f"Rebalance portfolio for {client_name}", "client_name": client_name})
        status = result.get("status")
        if status == "needs_confirm":
            return {
                "type": "rebalance_confirm",
                "client_id": result.get("client_id", client_id),
                "client_name": client_name,
                "verdict": result.get("verdict", ""),
                "justification": result.get("justification", ""),
                "signals": result.get("signals", []),
            }
        if status == "no_rebalance":
            return {"type": "no_rebalance", "verdict": result.get("verdict", ""), "justification": result.get("justification", "")}
        if status in ("ok", "partial"):
            task_id = result.get("task_id") or uuid.uuid4().hex
            return {"type": "rebalance_pending", "task_id": task_id}
        return {"type": "error", "message": result.get("data", {}).get("message", "Rebalance failed")}
    except Exception as exc:
        logger.error("[assist] rebalance dispatch failed: %s", exc)
        return {"type": "error", "message": "Rebalance service unavailable"}


async def _dispatch_research(topic: str) -> dict:
    """Call market research MCP tool."""
    try:
        result = await _call_mcp_tool("run_market_research", {"task": f"Market research on {topic}", "topic": topic})
        if result.get("status") in ("ok", "partial"):
            return {"type": "research", "data": result.get("data", {})}
        return {"type": "error", "message": result.get("data", {}).get("message", "Research failed")}
    except Exception as exc:
        logger.error("[assist] research dispatch failed: %s", exc)
        return {"type": "error", "message": "Research service unavailable"}


async def _dispatch_report(client_name: str) -> dict:
    """Call report generation MCP tool."""
    try:
        result = await _call_mcp_tool("generate_report", {"task": f"Generate report for {client_name}", "client_name": client_name})
        if result.get("status") in ("ok", "partial"):
            return {"type": "report", "data": result.get("data", {})}
        return {"type": "error", "message": result.get("data", {}).get("message", "Report generation failed")}
    except Exception as exc:
        logger.error("[assist] report dispatch failed: %s", exc)
        return {"type": "error", "message": "Report service unavailable"}


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/chat")
async def assist_chat(req: ChatRequest, uid: str = Depends(verify_token)):
    """Classify intent and dispatch to the appropriate service."""
    accumulated = req.accumulated_params or {}

    classified = await _classify_intent(
        req.message,
        req.conversation_history,
        req.pending_intent,
        accumulated,
    )

    intent = classified.get("intent", "unknown")
    dispatch = classified.get("dispatch", False)
    reply = classified.get("reply", "")
    params = classified.get("params", {})

    if intent == "unknown" or not dispatch:
        return {
            "intent": intent,
            "dispatch": dispatch,
            "reply": reply,
            "params": params,
            "missing_params": classified.get("missing_params", []),
        }

    # Merge accumulated params with newly extracted ones
    merged = {**accumulated, **{k: v for k, v in params.items() if v}}
    client_name = merged.get("client_name", "")

    result = {}
    if intent == "meeting_prep":
        result = await _dispatch_meeting_prep(client_name, uid, merged.get("force_refresh", False))
    elif intent == "rebalance":
        result = await _dispatch_rebalance(client_name)
    elif intent == "research":
        result = await _dispatch_research(client_name)
    elif intent == "report":
        result = await _dispatch_report(client_name)

    return {"intent": intent, "dispatch": True, "reply": reply, "result": result}


@router.get("/progress/{task_id}")
async def assist_progress(task_id: str, uid: str = Depends(verify_token)):
    """SSE stream — polls Firestore for progress updates."""

    async def _stream():
        last_pct = -1
        for _ in range(900):  # max 15 min
            doc = _poll_firestore_progress(task_id)
            if doc:
                pct = doc.get("pct", 0)
                if pct != last_pct:
                    last_pct = pct
                    yield f"data: {json.dumps({'task_id': task_id, 'pct': pct, 'message': doc.get('message', ''), 'done': doc.get('done', False)})}\n\n"
                if doc.get("done"):
                    result = doc.get("result")
                    if result:
                        yield f"data: {json.dumps({'task_id': task_id, 'type': 'result', 'result': result})}\n\n"
                    return
            await asyncio.sleep(1)
        yield f"data: {json.dumps({'task_id': task_id, 'pct': 100, 'message': 'Timed out', 'done': True})}\n\n"

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/rebalance/confirm")
async def rebalance_confirm(req: RebalanceConfirmRequest, uid: str = Depends(verify_token)):
    """Confirm a borderline rebalance after user approval."""
    result = await _dispatch_rebalance(req.client_name, req.client_id)
    return {"intent": "rebalance", "dispatch": True, "result": result}


@router.get("/activity-log")
async def activity_log(user_id: str, uid: str = Depends(verify_token)):
    """Return latest 4 completed task log entries for the SuggestedPrompts quick links.

    Reads from Firestore assist_activity_log collection.
    Returns {"logs": [{log_id, module, summary, params_used, timestamp}]}
    """
    try:
        docs = (
            _get_fs()
            .collection("assist_activity_log")
            .where("user_id", "==", user_id)
            .order_by("timestamp", direction=_firestore.Query.DESCENDING)
            .limit(4)
            .stream()
        )
        logs = []
        for doc in docs:
            d = doc.to_dict()
            logs.append({
                "log_id": doc.id,
                "module": d.get("module", ""),
                "summary": d.get("summary", ""),
                "params_used": d.get("params_used", {}),
                "timestamp": d.get("timestamp", ""),
            })
        return {"logs": logs}
    except Exception as exc:
        logger.warning("activity-log fetch failed: %s", exc)
        return {"logs": []}
