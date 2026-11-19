import { MEETING_PREP_API_URL } from '../config/api';
import { getCognitoToken } from '../utils/authCookies';

const BASE = MEETING_PREP_API_URL;
const TIMEOUT_MS = 300_000;

async function post(path, body) {
  if (body?.user_id !== undefined && !body.user_id) {
    return {
      ok: false,
      status: 401,
      authRequired: true,
      authUrl: null,
      error: 'Not logged in. Please sign in first.',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const token = getCognitoToken();
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.status === 401) {
      const detail = await res.json().catch(() => ({}));
      return {
        ok: false,
        status: 401,
        authRequired: true,
        authUrl: detail?.detail?.authorization_url || null,
        error: 'Google authorization required.',
      };
    }
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      return { ok: false, error: detail?.detail?.message || `Server error ${res.status}`, status: res.status };
    }
    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') return { ok: false, error: 'Request timed out. The agent is taking too long.' };
    return { ok: false, error: 'Cannot reach the Meeting Prep service. Check that it is running.' };
  }
}

/** Check whether the advisor has completed Google OAuth2 consent. */
export async function checkAuth(userId) {
  return post('/check-auth', { user_id: userId });
}

/** Fetch today's Google Calendar events for the advisor. */
export async function getCalendarEvents(userId) {
  return post('/calendar-events', { user_id: userId });
}

/**
 * Fetch upcoming calendar events.
 */
export async function getUpcomingEvents(userId, dayOffset = 0, numDays = 2) {
  return post('/upcoming-events', { user_id: userId, day_offset: dayOffset, num_days: numDays });
}

/**
 * Trigger meeting prep for a client by name.
 */
export async function runMeetingPrepDirect(userId, clientName, forceRefresh = false) {
  return post('/client-prep-direct', { user_id: userId, client_name: clientName, force_refresh: forceRefresh });
}

/** Alias kept for components that still import runMeetingPrepById — maps to /client-prep-direct. */
export async function runMeetingPrepById(userId, meetingId, forceRefresh = false) {
  return post('/client-prep-direct', { user_id: userId, client_name: meetingId, force_refresh: forceRefresh });
}

/** Returns the direct download URL for a generated PPTX. */
export function getPptxDownloadUrl(pptxId) {
  return `${BASE}/download-pptx/${pptxId}`;
}
