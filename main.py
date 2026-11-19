"""wa-backend — GCP-native FastAPI backend for Wealth Advisor.

Modules mounted:
  /meeting-prep/*   — Meeting Prep (MCP client → wa-mcp)

Planned (add include_router calls when ready):
  /morning-notes/*  — Morning Notes
  /cia/*            — Client Impact Assessment
"""

import logging
import os
import sys
from contextlib import asynccontextmanager

from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, stream=sys.stdout)

from fastapi import FastAPI, Request
from fastapi.exceptions import HTTPException
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

_IS_PROD = os.getenv("ENV", "development").lower() == "production"

_ALLOWED_ORIGINS = [
    o.strip()
    for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
    if o.strip()
]

# Allow file:// origin (browsers send "null") in non-production for the test HTML client
if not _IS_PROD:
    _ALLOWED_ORIGINS.append("null")

_CORS_METHODS = "GET, POST, PUT, DELETE, OPTIONS, PATCH"
_CORS_HEADERS = "Authorization, Content-Type, X-Requested-With"


# ── CORS middleware ───────────────────────────────────────────────────────────

class CORSMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        origin = request.headers.get("origin", "")
        if request.method == "OPTIONS":
            if origin in _ALLOWED_ORIGINS:
                return JSONResponse(
                    status_code=200,
                    content={},
                    headers={
                        "Access-Control-Allow-Origin": origin,
                        "Access-Control-Allow-Methods": _CORS_METHODS,
                        "Access-Control-Allow-Headers": _CORS_HEADERS,
                        "Access-Control-Max-Age": "86400",
                    },
                )
            return JSONResponse(status_code=403, content={"detail": "CORS forbidden"})
        response = await call_next(request)
        if origin in _ALLOWED_ORIGINS:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Methods"] = _CORS_METHODS
            response.headers["Access-Control-Allow-Headers"] = _CORS_HEADERS
        return response


# ── Security headers ──────────────────────────────────────────────────────────

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        response.headers["Server"] = "WealthAdvisory"
        if _IS_PROD:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response


# ── App ───────────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Future: start background schedulers (morning notes, etc.)
    yield


app = FastAPI(
    title="wa-backend — Wealth Advisor GCP Backend",
    version="1.0.0",
    lifespan=lifespan,
    docs_url=None if _IS_PROD else "/docs",
    redoc_url=None if _IS_PROD else "/redoc",
    openapi_url=None if _IS_PROD else "/openapi.json",
)

app.add_middleware(CORSMiddleware)
app.add_middleware(SecurityHeadersMiddleware)


# ── Exception handlers ────────────────────────────────────────────────────────

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    safe = exc.detail if exc.status_code < 500 else "An error occurred"
    return JSONResponse(status_code=exc.status_code, content={"detail": safe})


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    logging.getLogger(__name__).error("Unhandled exception: %s", exc, exc_info=True)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


# ── Routers ───────────────────────────────────────────────────────────────────

from meeting_prep.router import router as meeting_prep_router

app.include_router(meeting_prep_router)

# Future modules — uncomment when ready:
# from morning_notes.router import router as morning_notes_router
# app.include_router(morning_notes_router)
#
# from cia.router import router as cia_router
# app.include_router(cia_router)


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status": "healthy",
        "service": "wa-backend",
        "modules": ["meeting_prep"],
    }


# ── Entrypoint ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=not _IS_PROD, server_header=False)
