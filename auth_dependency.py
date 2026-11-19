"""Firebase Identity Platform JWT verification — replaces Cognito auth_dependency."""

import logging
import os

import firebase_admin
from firebase_admin import auth as firebase_auth, credentials
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

logger = logging.getLogger(__name__)
_bearer = HTTPBearer(auto_error=False)

# Initialise Firebase Admin SDK once
# Locally: needs FIREBASE_PROJECT_ID env var since there's no GCP metadata server
# Cloud Run: ADC picks up project automatically
if not firebase_admin._apps:
    project_id = os.getenv("FIREBASE_PROJECT_ID", "")
    options = {"projectId": project_id} if project_id else {}
    firebase_admin.initialize_app(options=options)


def verify_token(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> str:
    """Verify Firebase ID token from Authorization: Bearer header.

    Returns the Firebase uid on success.
    Raises HTTP 401 on missing or invalid token.
    """
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials

    # DEV bypass — set SKIP_AUTH=true locally only, never in Cloud Run
    if os.getenv("SKIP_AUTH", "").lower() == "true":
        logger.warning("SKIP_AUTH enabled — bypassing token verification")
        return "dev-user"

    try:
        decoded = firebase_auth.verify_id_token(token)
        return decoded["uid"]
    except firebase_auth.ExpiredIdTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except firebase_auth.InvalidIdTokenError as exc:
        logger.warning("Invalid Firebase token: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except Exception as exc:
        logger.error("Token verification error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
