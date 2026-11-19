/**
 * Activity Log Helper — fetches latest 4 completed task logs for the current user.
 * Replaces the static getSuggestedPromptsForMode() helper.
 */

import { getApiUrl } from '../config/api.js';
import { getCognitoToken, getSessionId } from './authCookies.js';

/**
 * Fetch the latest 4 activity log entries for a user.
 * Returns an array of { log_id, module, summary, params_used, timestamp } objects.
 */
export async function fetchActivityLog(userId) {
  if (!userId) return [];
  try {
    const token = getCognitoToken();
    const sessionId = getSessionId();
    const res = await fetch(getApiUrl(`/assist/activity-log?user_id=${encodeURIComponent(userId)}`), {
      headers: {
        ...(token     ? { Authorization: `Bearer ${token}` } : {}),
        ...(sessionId ? { 'X-Session-ID': sessionId }        : {}),
      },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.logs || [];
  } catch {
    return [];
  }
}
