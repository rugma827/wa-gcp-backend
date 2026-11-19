/**
 * API Configuration — Local Integrated Backend
 *
 * All services run on a single server at http://localhost:8000
 * with different route prefixes:
 *   /research/*        — Market Research
 *   /cia/*             — Client Impact Assessment
 *   /rebalance/*       — Portfolio Rebalancing
 *   /meeting-prep/*    — Meeting Prep
 */

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';

// General API base (used by apiClient.js for /api/* calls)
export const API_BASE_URL = BACKEND;

// Portfolio Rebalancing — all endpoints are under /rebalance
export const REBALANCING_API_URL = `${BACKEND}/rebalance`;

// Meeting Prep — all endpoints are under /meeting-prep
export const MEETING_PREP_API_URL = `${BACKEND}/meeting-prep`;

// Market Research — all endpoints are under /research
export const MARKET_RESEARCH_API_URL = BACKEND;

// CIA — all endpoints are under /cia
export const CIA_API_URL = `${BACKEND}/cia`;

/** Full URL for an API path (e.g. /health) */
export const getApiUrl = (path) => {
  return `${BACKEND}${path.startsWith('/') ? path : '/' + path}`;
};

/**
 * WebSocket base URL — rebalance summary streaming
 */
export const getWsBaseUrl = () => {
  if (import.meta.env.VITE_WS_BASE_URL) {
    return import.meta.env.VITE_WS_BASE_URL;
  }
  return 'ws://localhost:8000/rebalance';
};

/**
 * WebSocket base URL — report chat
 */
export const getReportWsBaseUrl = () => {
  const base = (import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000')
    .replace(/^https/, 'wss')
    .replace(/^http/, 'ws');
  return `${base}/api`;
};
