"""Meeting Prep — FastAPI Router (GCP-native).

Replaces AWS meeting_prep/router.py.
  - Firebase JWT via auth_dependency.verify_token  (replaces Cognito)
  - MCP HTTP client → wa-mcp Cloud Run URL         (replaces local orchestrator)
  - Google OAuth2 + Secret Manager                 (replaces AgentCore)
  - BigQuery cache                                 (replaces DynamoDB)

UI contract (unchanged from AWS version):
  POST /meeting-prep/check-auth          → {"status":"authenticated"} | 401 + authorization_url
  GET  /meeting-prep/oauth-callback      → exchanges code, stores token, closes popup
  POST /meeting-prep/calendar-events     → {"events":[...]}
  POST /meeting-prep/upcoming-events     → {"events":[...]}
  POST /meeting-prep/client-prep-direct  → {"result":"meeting_prep_complete","task_id":"...","meetings":[{"data":{"client_id":"...","meeting_id":"...","reply":"...","result":{...}}}]}
  GET  /meeting-prep/snapshot            → MCP step result JSON
  GET  /meeting-prep/risks               → MCP step result JSON
  GET  /meeting-prep/angles              → MCP step result JSON
  GET  /meeting-prep/activity            → MCP step result JSON
  GET  /meeting-prep/download-pptx/{id} → .pptx file
"""

import io
import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse, StreamingResponse
from google.cloud import secretmanager
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from pydantic import BaseModel

from auth_dependency import verify_token
from bq_cache import get_cached, get_meeting_context, put_cached, put_meeting_context, today as cache_today

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/meeting-prep", tags=["Meeting Prep"])

# ── Config ────────────────────────────────────────────────────────────────────

_PROJECT = os.getenv("GCP_PROJECT_ID", "agentic-wealthadvisor")
_MCP_URL = os.getenv("MCP_SERVER_URL", "https://wa-mcp-placeholder.run.app/mcp")
_OAUTH_REDIRECT_URI = os.getenv(
    "OAUTH_REDIRECT_URI",
    "https://wa-backend-placeholder.run.app/meeting-prep/oauth-callback",
)
_OAUTH_SCOPES = [
    "https://www.googleapis.com/auth/calendar.readonly",
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
]
_CALENDAR_TOKEN_TTL_DAYS = int(os.getenv("CALENDAR_TOKEN_TTL_DAYS", "60"))

# ── Secret Manager helpers ────────────────────────────────────────────────────

_sm_client: Optional[secretmanager.SecretManagerServiceClient] = None


def _sm() -> secretmanager.SecretManagerServiceClient:
    global _sm_client
    if _sm_client is None:
        _sm_client = secretmanager.SecretManagerServiceClient()
    return _sm_client


def _get_secret(name: str) -> str:
    path = f"projects/{_PROJECT}/secrets/{name}/versions/latest"
    return _sm().access_secret_version(request={"name": path}).payload.data.decode()


def _put_secret(name: str, payload: str) -> None:
    """Create or add a new version to a secret."""
    client = _sm()
    secret_path = f"projects/{_PROJECT}/secrets/{name}"
    try:
        client.add_secret_version(
            request={
                "parent": secret_path,
                "payload": {"data": payload.encode()},
            }
        )
    except Exception:
        # Secret doesn't exist yet — create it then add version
        client.create_secret(
            request={
                "parent": f"projects/{_PROJECT}",
                "secret_id": name,
                "secret": {"replication": {"automatic": {}}},
            }
        )
        client.add_secret_version(
            request={
                "parent": secret_path,
                "payload": {"data": payload.encode()},
            }
        )


# ── OAuth Flow factory ────────────────────────────────────────────────────────

def _make_flow() -> Flow:
    """Build a Google OAuth Flow from the credentials stored in Secret Manager."""
    raw = _get_secret("google-oauth-credentials")
    creds_dict = json.loads(raw)
    # Secret may be stored as {"web": {...}} or flat {"client_id": ...}
    web = creds_dict.get("web", creds_dict)
    client_config = {
        "web": {
            "client_id": web["client_id"],
            "client_secret": web["client_secret"],
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [_OAUTH_REDIRECT_URI],
        }
    }
    flow = Flow.from_client_config(client_config, scopes=_OAUTH_SCOPES)
    flow.redirect_uri = _OAUTH_REDIRECT_URI
    return flow


# ── Calendar token helpers ────────────────────────────────────────────────────

def _load_calendar_token(uid: str) -> Optional[dict]:
    try:
        raw = _get_secret(f"calendar-token-{uid}")
        return json.loads(raw)
    except Exception:
        return None


def _save_calendar_token(uid: str, token_data: dict) -> None:
    _put_secret(f"calendar-token-{uid}", json.dumps(token_data))


def _build_calendar_service(uid: str):
    """Return an authenticated Google Calendar service, refreshing token if needed."""
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request

    token_data = _load_calendar_token(uid)
    if not token_data:
        return None

    creds_raw = _get_secret("google-oauth-credentials")
    creds_dict = json.loads(creds_raw)
    web = creds_dict.get("web", creds_dict)

    creds = Credentials(
        token=token_data.get("access_token"),
        refresh_token=token_data.get("refresh_token"),
        token_uri="https://oauth2.googleapis.com/token",
        client_id=web["client_id"],
        client_secret=web["client_secret"],
        scopes=_OAUTH_SCOPES,
    )

    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        _save_calendar_token(uid, {
            "access_token": creds.token,
            "refresh_token": creds.refresh_token,
            "expiry": creds.expiry.isoformat() if creds.expiry else None,
        })

    return build("calendar", "v3", credentials=creds)


# ── MCP client helper ─────────────────────────────────────────────────────────

async def _call_mcp_tool(tool_name: str, arguments: dict) -> dict:
    """Call a tool on the wa-mcp Cloud Run MCP server via streamable HTTP."""
    payload = {
        "jsonrpc": "2.0",
        "id": uuid.uuid4().hex,
        "method": "tools/call",
        "params": {"name": tool_name, "arguments": arguments},
    }
    try:
        async with httpx.AsyncClient(timeout=300) as client:
            resp = await client.post(_MCP_URL, json=payload)
            resp.raise_for_status()
            body = resp.json()
            # MCP response: {"result": {"content": [{"type":"text","text":"..."}]}}
            content = body.get("result", {}).get("content", [])
            text = next((c["text"] for c in content if c.get("type") == "text"), None)
            if text:
                try:
                    return json.loads(text)
                except json.JSONDecodeError:
                    return {"reply": text}
            return body.get("result", {})
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="wa-mcp service unavailable — URL not yet configured")
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f"wa-mcp returned {exc.response.status_code}")


# ── Meeting context helper ────────────────────────────────────────────────────

def _ensure_meeting_context(client_id: str, meeting_id: str, date: str) -> None:
    existing = get_meeting_context(meeting_id, date)
    if existing:
        return
    put_meeting_context({
        "meeting_id": meeting_id,
        "date": date,
        "client_id": client_id,
        "source": "backend_direct",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })


# ── Pydantic models ───────────────────────────────────────────────────────────

class BaseRequest(BaseModel):
    user_id: Optional[str] = None  # optional — uid comes from Bearer token


class ClientPrepDirectRequest(BaseModel):
    user_id: Optional[str] = None
    client_name: str  # UI sends client name; backend builds the MCP task string
    force_refresh: bool = False


class UpcomingEventsRequest(BaseModel):
    user_id: Optional[str] = None
    day_offset: int = 0
    num_days: int = 2


# ── 1. check-auth ─────────────────────────────────────────────────────────────

@router.post("/check-auth")
def check_auth(req: BaseRequest, uid: str = Depends(verify_token)):
    """Check if user has a valid Google Calendar token in Secret Manager.

    Returns {"status":"authenticated"} or 401 with authorization_url.
    UI contract: same shape as AWS AgentCore check_auth response.
    """
    token_data = _load_calendar_token(uid)
    if token_data and token_data.get("access_token"):
        connected_at = token_data.get("connected_at")
        if connected_at:
            age_days = (datetime.now(timezone.utc) - datetime.fromisoformat(connected_at)).days
            if age_days < _CALENDAR_TOKEN_TTL_DAYS:
                return {"status": "authenticated"}
            # Token TTL expired — fall through to re-auth
        else:
            return {"status": "authenticated"}

    # Not connected or TTL expired — generate OAuth URL
    try:
        flow = _make_flow()
        auth_url, _ = flow.authorization_url(
            access_type="offline",
            include_granted_scopes="true",
            prompt="consent",
            state=uid,  # pass uid through OAuth state so callback knows who to store for
        )
        raise HTTPException(
            status_code=401,
            detail={
                "status": "unauthenticated",
                "authorization_url": auth_url,
            },
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("check-auth flow error for uid=%s: %s", uid, exc)
        raise HTTPException(status_code=500, detail="Failed to generate authorization URL")


# ── 2. oauth-callback ─────────────────────────────────────────────────────────

@router.get("/oauth-callback", response_class=HTMLResponse)
def oauth_callback(
    code: str = Query(...),
    state: str = Query(...),  # uid passed through OAuth state
    error: Optional[str] = Query(None),
):
    """Google redirects here after user grants calendar access.

    Exchanges code for tokens, stores in Secret Manager, closes popup.
    The `state` param carries the Firebase uid set in check-auth.
    """
    if error:
        logger.warning("OAuth callback error: %s", error)
        return HTMLResponse(_popup_html("error", f"Authorization failed: {error}"))

    uid = state
    try:
        flow = _make_flow()
        flow.fetch_token(code=code)
        creds = flow.credentials
        _save_calendar_token(uid, {
            "access_token": creds.token,
            "refresh_token": creds.refresh_token,
            "expiry": creds.expiry.isoformat() if creds.expiry else None,
            "connected_at": datetime.now(timezone.utc).isoformat(),
        })
        logger.info("Calendar token stored for uid=%s", uid)
        return HTMLResponse(_popup_html("success"))
    except Exception as exc:
        logger.error("oauth-callback token exchange failed for uid=%s: %s", uid, exc)
        return HTMLResponse(_popup_html("error", "Token exchange failed. Please try again."))


def _popup_html(status: str, message: str = "") -> str:
    """Minimal HTML page that signals the opener and closes itself."""
    if status == "success":
        return """<!DOCTYPE html><html><body>
<script>
  if (window.opener) { window.opener.postMessage({type:'google_auth_success'}, '*'); }
  setTimeout(function() { window.close(); }, 500);
</script>
<p>Google Calendar connected. You can close this window.</p>
</body></html>"""
    return f"""<!DOCTYPE html><html><body>
<script>
  if (window.opener) {{ window.opener.postMessage({{type:'google_auth_error',message:{json.dumps(message)}}}, '*'); }}
  setTimeout(function() {{ window.close(); }}, 500);
</script>
<p>{message or 'Authorization failed.'} You can close this window.</p>
</body></html>"""


# ── 3. calendar-events (today) ────────────────────────────────────────────────

@router.post("/calendar-events")
def calendar_events(req: BaseRequest, uid: str = Depends(verify_token)):
    """Fetch today's Google Calendar events.

    UI contract: {"events": [...]} or 401 when token expired/missing.
    """
    return _fetch_calendar_events(uid, day_offset=0, num_days=1)


# ── 4. upcoming-events ────────────────────────────────────────────────────────

@router.post("/upcoming-events")
def upcoming_events(req: UpcomingEventsRequest, uid: str = Depends(verify_token)):
    """Fetch upcoming calendar events (today + tomorrow by default).

    UI contract: {"events": [...]} — useCalendar hook splits by date client-side.
    """
    if req.num_days < 1:
        raise HTTPException(status_code=422, detail="num_days must be >= 1")
    return _fetch_calendar_events(uid, day_offset=req.day_offset, num_days=req.num_days)


def _fetch_calendar_events(uid: str, day_offset: int, num_days: int) -> dict:
    service = _build_calendar_service(uid)
    if service is None:
        raise HTTPException(
            status_code=401,
            detail={"status": "unauthenticated", "authorization_url": None},
        )

    from datetime import timedelta

    now = datetime.now(timezone.utc)
    time_min = (now + timedelta(days=day_offset)).replace(hour=0, minute=0, second=0, microsecond=0)
    time_max = time_min + timedelta(days=num_days)

    try:
        result = (
            service.events()
            .list(
                calendarId="primary",
                timeMin=time_min.isoformat(),
                timeMax=time_max.isoformat(),
                singleEvents=True,
                orderBy="startTime",
                maxResults=50,
            )
            .execute()
        )
        events = result.get("items", [])
        _store_calendar_events_context(events)
        return {"events": events}
    except Exception as exc:
        err_str = str(exc).lower()
        if "invalid_grant" in err_str or "token" in err_str or "401" in err_str:
            # Token expired and refresh failed — force re-auth
            raise HTTPException(
                status_code=401,
                detail={"status": "unauthenticated", "authorization_url": None},
            )
        logger.error("Calendar fetch failed for uid=%s: %s", uid, exc)
        raise HTTPException(status_code=502, detail="Failed to fetch calendar events")


def _store_calendar_events_context(events: list) -> None:
    """Write calendar events into meeting_context so event IDs can be resolved later."""
    today = cache_today()
    for ev in events:
        meeting_id = ev.get("id")
        client_name = ev.get("summary", "").strip()
        if not meeting_id or not client_name:
            continue
        if get_meeting_context(meeting_id, today):
            continue
        put_meeting_context({
            "meeting_id": meeting_id,
            "date": today,
            "client_id": "",
            "client_name": client_name,
            "source": "calendar_fetch",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })



def _is_calendar_event_id(value: str) -> bool:
    """Calendar event IDs are long alphanumeric strings, not client names."""
    return len(value) > 20 and bool(re.match(r'^[a-zA-Z0-9_]+$', value))


def _resolve_client_name_from_event(uid: str, event_id: str) -> Optional[str]:
    """Resolve client name from event ID — checks BQ meeting_context first, then Google Calendar API."""
    # 1. Check BQ — already stored at calendar fetch time
    ctx = get_meeting_context(event_id, cache_today())
    if ctx and ctx.get("client_name"):
        return ctx["client_name"]
    # 2. Fall back to live Google Calendar API call
    service = _build_calendar_service(uid)
    if service is None:
        return None
    try:
        event = service.events().get(calendarId="primary", eventId=event_id).execute()
        return event.get("summary") or None
    except Exception as exc:
        logger.warning("Could not resolve calendar event %s: %s", event_id, exc)
        return None


@router.post("/client-prep-direct")
async def client_prep_direct(req: ClientPrepDirectRequest, uid: str = Depends(verify_token)):
    """On-demand meeting prep. Passes free-form task to wa-mcp for name resolution.

    UI contract: {"result":"meeting_prep_complete","task_id":"...","meetings":[...]}
    """
    today = cache_today()
    client_name = req.client_name.strip()

    # If frontend sent a calendar event ID instead of a name, resolve it first
    if _is_calendar_event_id(client_name):
        resolved = _resolve_client_name_from_event(uid, client_name)
        if resolved:
            logger.info("[client-prep-direct] resolved event_id=%s to client_name=%r", client_name, resolved)
            client_name = resolved
        else:
            logger.warning("[client-prep-direct] could not resolve event_id=%s, using as-is", client_name)

    task = f"Generate full meeting brief for {client_name}"
    logger.info("[client-prep-direct] task=%r mcp_url=%s", task, _MCP_URL)

    # Call wa-mcp — MCP resolves client id from the name in the task
    result = await _call_mcp_tool("get_meeting_brief", {"task": task})
    logger.info("[client-prep-direct] mcp_status=%s mcp_keys=%s", result.get("status"), list(result.get("data", {}).keys()))

    status = result.get("status")
    if status == "needs_input":
        raise HTTPException(status_code=422, detail=result.get("question", "More input required"))
    if status not in ("ok", "partial"):
        raise HTTPException(status_code=502, detail=result.get("data", {}).get("message", "Meeting prep failed"))

    data = result.get("data", {})
    # MCP returns client_id and meeting_id at top of data; structured brief is in data.result
    meeting_id = data.get("meeting_id") or f"direct_{uuid.uuid4().hex[:8]}"
    client_id = data.get("client_id", "")
    brief = data.get("result", data)  # structured fields (client, holdings, risk, …) the UI reads
    cache_key = f"cockpit#{meeting_id}"

    if not req.force_refresh or not get_cached(cache_key, today):
        _ensure_meeting_context(client_id, meeting_id, today)
        put_cached(cache_key, today, brief)

    return {
        "result": "meeting_prep_complete",
        "task_id": meeting_id,
        "meetings": [{"type": "meeting_prep", "data": brief, "meeting_id": meeting_id}],
    }


# ── 6–9. Step-level MCP endpoints ────────────────────────────────────────────

def _mcp_args(task: str, meeting_id: Optional[str]) -> dict:
    args = {"task": task}
    if meeting_id:
        args["meeting_id"] = meeting_id
    return args


def _unwrap_mcp(result: dict) -> dict:
    """Raise on error/needs_input; return data payload on ok/partial."""
    status = result.get("status")
    if status in ("ok", "partial"):
        return result.get("data", {})
    if status == "needs_input":
        raise HTTPException(status_code=422, detail=result.get("question", "More input required"))
    raise HTTPException(status_code=502, detail=result.get("data", {}).get("message", "MCP step failed"))


@router.get("/snapshot")
async def get_snapshot(
    client_name: str = Query(...),
    meeting_id: Optional[str] = Query(None),
    uid: str = Depends(verify_token),
):
    """Step 1 — Portfolio Snapshot via wa-mcp."""
    result = await _call_mcp_tool("get_portfolio_snapshot", _mcp_args(f"Portfolio snapshot for {client_name}", meeting_id))
    return _unwrap_mcp(result)


@router.get("/risks")
async def get_risks(
    client_name: str = Query(...),
    meeting_id: Optional[str] = Query(None),
    uid: str = Depends(verify_token),
):
    """Step 2 — Risks & Opportunities via wa-mcp."""
    result = await _call_mcp_tool("get_risks_and_opportunities", _mcp_args(f"Risks and opportunities for {client_name}", meeting_id))
    return _unwrap_mcp(result)


@router.get("/angles")
async def get_angles(
    client_name: str = Query(...),
    meeting_id: Optional[str] = Query(None),
    uid: str = Depends(verify_token),
):
    """Step 3 — Discussion Angles via wa-mcp."""
    result = await _call_mcp_tool("get_discussion_angles", _mcp_args(f"Discussion angles for {client_name}", meeting_id))
    return _unwrap_mcp(result)


@router.get("/activity")
async def get_activity(
    client_name: str = Query(...),
    meeting_id: Optional[str] = Query(None),
    uid: str = Depends(verify_token),
):
    """Step 4 — Recent Activity via wa-mcp."""
    result = await _call_mcp_tool("get_recent_activity", _mcp_args(f"Recent activity for {client_name}", meeting_id))
    return _unwrap_mcp(result)


# ── 10. download-pptx ────────────────────────────────────────────────────────

@router.get("/download-pptx/{meeting_id}")
def download_pptx(meeting_id: str, uid: str = Depends(verify_token)):
    """Fetch cached brief from BQ and generate PPTX on the fly."""
    today = cache_today()
    cache_key = f"cockpit#{meeting_id}"
    brief = get_cached(cache_key, today)

    if not brief:
        raise HTTPException(status_code=404, detail=f"No cached brief found for meeting_id: {meeting_id}")

    try:
        pptx_bytes = _build_pptx(brief, meeting_id)
    except Exception as exc:
        logger.error("PPTX generation failed for %s: %s", meeting_id, exc)
        raise HTTPException(status_code=500, detail="PPTX generation failed")

    filename = f"Meeting_Prep_{meeting_id}.pptx"
    return StreamingResponse(
        io.BytesIO(pptx_bytes),
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _build_pptx(brief: dict, meeting_id: str) -> bytes:
    """Build PPTX from brief dict — same structure as pptx_utils.html_to_pptx."""
    from pptx import Presentation
    from pptx.util import Inches, Pt
    from pptx.dml.color import RGBColor

    prs = Presentation()
    prs.slide_width = Inches(13.33)
    prs.slide_height = Inches(7.5)

    def _title_slide(title: str, subtitle: str):
        slide = prs.slides.add_slide(prs.slide_layouts[0])
        slide.shapes.title.text = title
        slide.shapes.title.text_frame.paragraphs[0].runs[0].font.color.rgb = RGBColor(0x44, 0x44, 0x44)
        slide.placeholders[1].text = subtitle

    def _content_slide(title: str, bullets: list):
        slide = prs.slides.add_slide(prs.slide_layouts[1])
        slide.shapes.title.text = title
        tf = slide.placeholders[1].text_frame
        tf.clear()
        for i, bullet in enumerate(bullets[:20]):
            p = tf.add_paragraph() if i > 0 else tf.paragraphs[0]
            p.text = str(bullet)
            p.level = 0
            p.font.size = Pt(13)

    client = brief.get("client", {})
    holdings = brief.get("holdings", {})
    risk = brief.get("risk", {})

    _title_slide(
        client.get("name", meeting_id),
        f"Meeting Preparation Brief  |  {cache_today()}",
    )

    # Holdings
    perf = holdings.get("performance", [])
    h_bullets = (
        ["Fund  |  Type  |  Weight  |  2024  |  2025  |  Trend"] +
        [f"{f.get('fund','')}  |  {f.get('type','')}  |  {f.get('weight','')}%  |  "
         f"{f.get('y2024','')}  |  {f.get('y2025','')}  |  {f.get('trend','')}" for f in perf]
    ) if perf else ["No holdings data"]
    _content_slide("Holdings Snapshot", h_bullets)

    # Risks
    r_bullets = []
    for section in risk.get("skillSections", []):
        if not isinstance(section, dict):
            continue
        for s in section.get("signals", []):
            if isinstance(s, dict):
                r_bullets.append(
                    f"[{(s.get('assessment') or {}).get('materiality','').upper()}] "
                    f"{s.get('signal_type','').replace('_',' ')}: "
                    f"{(s.get('observation') or {}).get('summary','')}"
                )
    _content_slide("Risks & Opportunities", r_bullets or ["No data"])

    # Activity
    _content_slide("Interaction History", [
        f"{a.get('date','')} — {a.get('summary','')}  →  {a.get('decision','')}"
        for a in brief.get("activity", [])
    ] or ["No data"])

    # Discussion Angles
    _content_slide("Discussion Angles", [
        f"{d.get('title','')}: {d.get('desc','')}"
        for d in brief.get("discussionAngles", [])
    ] or ["No data"])

    # Next Best Actions
    _content_slide("Next Best Actions", [
        f"{a.get('label','')}: {a.get('desc','')}"
        for a in brief.get("nextBestActions", [])
    ] or ["No data"])

    buf = io.BytesIO()
    prs.save(buf)
    return buf.getvalue()
