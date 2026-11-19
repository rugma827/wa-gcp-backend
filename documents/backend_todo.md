# Backend Owner — Full Context & To-Do

## What this project is

Wealth Advisor meeting prep system migrated from AWS to GCP. The core meeting prep logic
stays unchanged — this backend is a new GCP-native wrapper around it.

---

## Full Stack Architecture

```
React UI (Cloud Run)  ←── wa-frontend
    │
    │  HTTPS — authenticated requests (Bearer token)
    ▼
FastAPI Backend (Cloud Run)  ←── wa-backend  ← YOUR REPO
    │
    ├── Google Identity Platform  ← token verification (replaces Cognito)
    │
    ├── MCP Server (Cloud Run)  ←── wa-mcp   ← other person's repo
    │       │
    │       └── Vertex AI Agent Engine
    │               └── agents_meeting_prep (deployed reasoning engine)
    │
    ├── BigQuery                  ← meeting_context, meeting_prep_cache (dataset: wealth_meeting_prep)
    │
    └── Secret Manager            ← Google Calendar OAuth tokens per user

Other MCP clients (Claude Desktop, Cursor, other agents)
    │
    └──────────────────────────────► MCP Server (wa-mcp) directly
```

**3 Cloud Run services:** `wa-frontend` (React UI — out of scope), `wa-backend` (yours), `wa-mcp` (other person).

---

## Your Scope — `wa-backend`

You own `router.py` only. The MCP server (`server.py`), agent (`agent.py`), and tools (`tools.py`) are built and deployed by another person as `wa-mcp`.

Your router is an **MCP client** — it calls `wa-mcp` for all meeting prep intelligence and handles only UI-specific concerns itself.

---

## Endpoints to implement in `router.py`

| Endpoint | What it does |
|---|---|
| `POST /meeting-prep/client-prep-direct` | Main prep trigger — calls `get_meeting_brief` on `wa-mcp`, streams SSE to UI |
| `GET /meeting-prep/snapshot` | Calls `get_portfolio_snapshot` on `wa-mcp`, returns JSON |
| `GET /meeting-prep/risks` | Calls `get_risks_and_opportunities` on `wa-mcp`, returns JSON |
| `GET /meeting-prep/angles` | Calls `get_discussion_angles` on `wa-mcp`, returns JSON |
| `GET /meeting-prep/activity` | Calls `get_recent_activity` on `wa-mcp`, returns JSON |
| `GET /meeting-prep/check-auth` | Check if user has valid Google Calendar token in Secret Manager |
| `GET /meeting-prep/oauth-callback` | Receive Google OAuth code, exchange for tokens, store in Secret Manager |
| `GET /meeting-prep/calendar-events` | Fetch calendar events for user |
| `GET /meeting-prep/download-pptx/{meeting_id}` | Fetch cached brief from BQ, generate PPTX, return file |

---

## Key implementation notes for `router.py`

- `verify_token` — `firebase_admin.auth.verify_id_token(token)` replaces Cognito JWT validation
- `_run_prep` — `mcp_client.call_tool("get_meeting_brief", ...)` replaces `run_meeting_prep` orchestrator
- Calendar auth — Secret Manager replaces AgentCore
- `MCP_SERVER_URL` env var — points to `wa-mcp` Cloud Run service URL (get from other person)
- SSE streaming — same transport as today, no frontend change needed

---

## GCP Project

```
Project ID : agentic-wealthadvisor
Region     : us-west1
```

---

## Service Account

Reusing existing SA: `wealthadvisor@agentic-wealthadvisor.iam.gserviceaccount.com`

Roles already on this SA (relevant ones):
```
roles/aiplatform.editor
roles/bigquery.dataOwner
roles/bigquery.user
roles/logging.logWriter
roles/secretmanager.secretAccessor
roles/storage.admin
```

Added during setup:
```
roles/run.invoker                        ← call wa-mcp Cloud Run service
roles/secretmanager.secretVersionManager ← write refreshed calendar tokens back
```

---

## Secrets in Secret Manager

| Secret name | Value | Purpose |
|---|---|---|
| `google-oauth-credentials` | `{"client_id": "...", "client_secret": "..."}` | Google Calendar OAuth client credentials |
| `calendar-token-{user_id}` | `{"access_token": "...", "refresh_token": "...", "expiry": "..."}` | Per-user calendar tokens (written at runtime) |

---

## BigQuery Tables

Dataset: `wealth_meeting_prep` — `us-west1`

| Table | Purpose |
|---|---|
| `meeting_context` | Per-meeting context rows. PK: `meeting_id` + `date` |
| `meeting_prep_cache` | Step-level and brief cache. PK: `cache_key` + `date` |

---

## Environment Variables needed in `wa-backend` Cloud Run

```
GCP_PROJECT_ID=agentic-wealthadvisor
GCP_LOCATION=us-west1
BQ_DATASET=wealth_advisor
BQ_MEETING_DATASET=wealth_meeting_prep
FIREBASE_PROJECT_ID=agentic-wealthadvisor
MCP_SERVER_URL=<wa-mcp Cloud Run URL — get from other person>
GOOGLE_OAUTH_CLIENT_ID=<pulled from Secret Manager at startup>
GOOGLE_OAUTH_CLIENT_SECRET=<pulled from Secret Manager at startup>
```

---

## OAuth Redirect URI

When `wa-backend` Cloud Run URL is known, add it to the OAuth 2.0 client in GCP Console:
```
https://<wa-backend-url>/meeting-prep/oauth-callback
```

Go to: `https://console.cloud.google.com/apis/credentials?project=agentic-wealthadvisor`
Edit the `wa-backend` OAuth 2.0 client → add the real redirect URI.

---

## Deploy command (when ready)

```bash
gcloud run deploy wa-backend \
  --source . \
  --region=us-west1 \
  --service-account=wealthadvisor@agentic-wealthadvisor.iam.gserviceaccount.com \
  --project=agentic-wealthadvisor
```

---

## To-Do Status

| Step | Status |
|---|---|
| 1. Firebase / Identity Platform enabled | ✅ Done |
| 2. Google OAuth credentials → Secret Manager | ✅ Done |
| 3. SA roles granted (`run.invoker` + `secretVersionManager`) | ✅ Done |
| 4. Artifact Registry | ⏭ Skip — not needed for manual deploy |
| 5. `router.py` | ⏳ Waiting for `wa-mcp` URL from other person |
| 6. Deploy `wa-backend` to Cloud Run | ⏳ Waiting for `router.py` |

--
router.py — implement, the MCP client backend

Firebase JWT verify_token

All 9 endpoints

MCP client calls to wa-mcp

Calendar OAuth + Secret Manager

PPTX download

6. Deploy wa-backend to Cloud Run

gcloud run deploy wa-backend --source . --region=us-west1 --service-account=--

