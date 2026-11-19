const AUTH_COOKIE_MAX_AGE_SECONDS = 8 * 60 * 60;

const AUTH_COOKIE_NAMES = {
  accessToken: "access_token",
  idToken: "id_token",
  refreshToken: "refresh_token",
  sessionStart: "session_start",
  isAuthenticated: "is_authenticated",
  sessionId: "session_id",
};

function isSecureContextForCookies() {
  if (typeof window === "undefined") return false;
  return window.location.protocol === "https:";
}

function buildCookieOptions(maxAgeSeconds = AUTH_COOKIE_MAX_AGE_SECONDS) {
  const parts = ["Path=/", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`];
  if (isSecureContextForCookies()) parts.push("Secure");
  return parts.join("; ");
}

function setCookie(name, value, maxAgeSeconds = AUTH_COOKIE_MAX_AGE_SECONDS) {
  // JWT tokens are base64url (URL-safe ASCII) — store raw without encoding to prevent corruption
  document.cookie = `${name}=${value}; ${buildCookieOptions(maxAgeSeconds)}`;
}

function deleteCookie(name) {
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax${isSecureContextForCookies() ? "; Secure" : ""}`;
}

function getCookie(name) {
  const prefix = `${name}=`;
  const cookie = document.cookie.split('; ').find((entry) => entry.startsWith(prefix));
  if (!cookie) return '';
  return cookie.slice(prefix.length);
}

export function persistAuthTokens(tokens) {
  setCookie(AUTH_COOKIE_NAMES.accessToken, tokens.accessToken);
  setCookie(AUTH_COOKIE_NAMES.idToken, tokens.idToken);
  setCookie(AUTH_COOKIE_NAMES.refreshToken, tokens.refreshToken);
  setCookie(AUTH_COOKIE_NAMES.sessionStart, Date.now().toString());
  setCookie(AUTH_COOKIE_NAMES.isAuthenticated, "true");
}

/** Silently update access/id tokens after a refresh without resetting session start. */
export function updateAuthTokens(tokens) {
  setCookie(AUTH_COOKIE_NAMES.accessToken, tokens.accessToken);
  setCookie(AUTH_COOKIE_NAMES.idToken, tokens.idToken);
}

export function clearAuthCookies() {
  Object.values(AUTH_COOKIE_NAMES).forEach(deleteCookie);
}

export function getAuthSessionStart() {
  const raw = getCookie(AUTH_COOKIE_NAMES.sessionStart);
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

export function hasAuthCookies() {
  return Boolean(
    getCookie(AUTH_COOKIE_NAMES.accessToken) &&
    getCookie(AUTH_COOKIE_NAMES.idToken) &&
    getCookie(AUTH_COOKIE_NAMES.refreshToken) &&
    getCookie(AUTH_COOKIE_NAMES.isAuthenticated) === "true"
  );
}

export function touchAuthSessionStart() {
  setCookie(AUTH_COOKIE_NAMES.sessionStart, Date.now().toString());
}

export function clearLegacyAuthStorage() {
  localStorage.removeItem("isAuthenticated");
  sessionStorage.removeItem("access_token");
  sessionStorage.removeItem("id_token");
  sessionStorage.removeItem("refresh_token");
  sessionStorage.removeItem("session_start");
}

export function getCognitoToken() {
  return getCookie(AUTH_COOKIE_NAMES.accessToken) || '';
}

export function getRefreshToken() {
  return getCookie(AUTH_COOKIE_NAMES.refreshToken) || '';
}

/** Returns true if the stored access token is expired or will expire within 60 seconds. */
export function isAccessTokenExpired() {
  const token = getCognitoToken();
  if (!token) return true;
  try {
    const b64 = token.split('.')[1];
    const payload = JSON.parse(atob(b64.replace(/-/g, '+').replace(/_/g, '/')));
    return (payload.exp * 1000) - Date.now() < 60_000;
  } catch {
    return true;
  }
}

export function getSessionId() {
  return getCookie(AUTH_COOKIE_NAMES.sessionId) || '';
}

export function setSessionId(id) {
  setCookie(AUTH_COOKIE_NAMES.sessionId, id, 8 * 60 * 60);
}

export function isAuthSessionExpired(timeoutMs) {
  const sessionStart = getAuthSessionStart();
  if (!sessionStart) return true;
  return Date.now() - sessionStart >= timeoutMs;
}
