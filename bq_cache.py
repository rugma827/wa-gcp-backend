"""BigQuery cache helpers — replaces DynamoDB dynamo_cache.py.

Tables in dataset BQ_MEETING_DATASET (wealth_meeting_prep):
  meeting_prep_cache  — step/brief cache  (cache_key STRING, date STRING, payload JSON STRING)
  meeting_context     — per-meeting rows  (meeting_id STRING, date STRING, ...)
"""

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Optional

from google.cloud import bigquery

logger = logging.getLogger(__name__)

_PROJECT = os.getenv("GCP_PROJECT_ID", "agentic-wealthadvisor")
_DATASET = os.getenv("BQ_MEETING_DATASET", "wealth_meeting_prep")
_CACHE_TABLE = f"{_PROJECT}.{_DATASET}.meeting_prep_cache"
_CONTEXT_TABLE = f"{_PROJECT}.{_DATASET}.meeting_context"

_bq: Optional[bigquery.Client] = None


def _client() -> bigquery.Client:
    global _bq
    if _bq is None:
        _bq = bigquery.Client(project=_PROJECT)
    return _bq


def today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


# ── Cache get/put ─────────────────────────────────────────────────────────────

def get_cached(cache_key: str, date: str) -> Optional[dict]:
    query = f"""
        SELECT payload FROM `{_CACHE_TABLE}`
        WHERE cache_key = @key AND date = @date
        LIMIT 1
    """
    job_config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("key", "STRING", cache_key),
            bigquery.ScalarQueryParameter("date", "STRING", date),
        ]
    )
    try:
        rows = list(_client().query(query, job_config=job_config).result())
        if rows:
            return json.loads(rows[0]["payload"])
    except Exception as exc:
        logger.warning("BQ get_cached failed for %s: %s", cache_key, exc)
    return None


def put_cached(cache_key: str, date: str, data: dict) -> None:
    row = {
        "cache_key": cache_key,
        "date": date,
        "payload": json.dumps(data),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        errors = _client().insert_rows_json(_CACHE_TABLE, [row])
        if errors:
            logger.warning("BQ put_cached insert errors: %s", errors)
    except Exception as exc:
        logger.warning("BQ put_cached failed for %s: %s", cache_key, exc)


# ── Meeting context ───────────────────────────────────────────────────────────

def get_meeting_context(meeting_id: str, date: str) -> Optional[dict]:
    query = f"""
        SELECT * FROM `{_CONTEXT_TABLE}`
        WHERE meeting_id = @mid AND date = @date
        LIMIT 1
    """
    job_config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("mid", "STRING", meeting_id),
            bigquery.ScalarQueryParameter("date", "STRING", date),
        ]
    )
    try:
        rows = list(_client().query(query, job_config=job_config).result())
        return dict(rows[0]) if rows else None
    except Exception as exc:
        logger.warning("BQ get_meeting_context failed for %s: %s", meeting_id, exc)
    return None


def put_meeting_context(row: dict) -> None:
    try:
        errors = _client().insert_rows_json(_CONTEXT_TABLE, [row])
        if errors:
            logger.warning("BQ put_meeting_context insert errors: %s", errors)
    except Exception as exc:
        logger.warning("BQ put_meeting_context failed: %s", exc)
