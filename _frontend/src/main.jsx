import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ThemeController from './controllers/ThemeController';
import App from './App.jsx';
import { getCognitoToken, getSessionId, getRefreshToken, isAccessTokenExpired, updateAuthTokens, clearAuthCookies, clearLegacyAuthStorage } from './utils/authCookies';
import { refreshCognitoTokens } from './utils/cognito';

let _sessionInvalidating = false;
function handleSessionInvalidated() {
  if (_sessionInvalidating) return;
  _sessionInvalidating = true;
  clearAuthCookies();
  clearLegacyAuthStorage();
  localStorage.removeItem('googleCalConnected');
  window.location.replace('/login?sessionExpired=1');
}

// Patch global fetch to inject auth headers and handle session invalidation
const _originalFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input?.url || '';
  const isBackend = url.includes('localhost:8000') || url.includes('wealth-advisory') || url.includes('.run.app');
  if (isBackend) {
    // Proactively refresh token if expired or expiring within 60s
    if (isAccessTokenExpired()) {
      const refreshToken = getRefreshToken();
      const advisorEmail = localStorage.getItem('advisorUserId') || '';
      if (refreshToken && advisorEmail) {
        const refreshed = await refreshCognitoTokens(advisorEmail, refreshToken);
        if (refreshed) {
          updateAuthTokens(refreshed);
        } else {
          handleSessionInvalidated();
          return new Response(JSON.stringify({ detail: 'Session invalidated' }), { status: 401 });
        }
      }
    }
    const headers = new Headers(init.headers || {});
    const token = getCognitoToken();
    if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
    const sessionId = getSessionId();
    if (sessionId && !headers.has('X-Session-ID')) headers.set('X-Session-ID', sessionId);
    init = { ...init, headers };
  }
  const response = await _originalFetch(input, init);
  if (isBackend && response.status === 401) {
    try {
      const clone = response.clone();
      const body = await clone.json();
      console.warn('[Auth] 401 body:', JSON.stringify(body), 'url:', url);
      if (body?.detail === 'Session invalidated') {
        handleSessionInvalidated();
      }
    } catch { /* non-JSON 401, ignore */ }
  }
  return response;
};

// Apply theme before first render so CSS variables are available immediately
ThemeController.applyTheme();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
