import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { useAuth } from './AuthContext';

const MONITOR_API = `${import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'}/monitor`;
const CIA_GRAPH_SYNC = import.meta.env.FLAG_CIA_GRAPH_SYNC === 'true';

const ACTION_LABELS = {
  ACT_CALL_TODAY:       'Call Client Today',
  ACT_SUIT_REVIEW:      'IPS Breach Review',
  ACT_REBALANCE:        'Rebalance to IPS',
  ACT_GOAL_REPLAN:      'Re-run Goal Plan',
  ACT_KYC_REVERIFY:     'Re-verify KYC',
  ACT_SCHEDULE_CHECKIN: 'Schedule Check-in',
  ACT_CREDIT_REVIEW:    'Schedule Credit Review',
  ACT_DEPLOY_CASH:      'Deploy Excess Cash',
  ACT_REASSURANCE_CALL: 'Schedule Reassurance Call',
  ACT_MARKET_REVIEW:    'Review Market Exposure',
};

function calcAge(dob) {
  if (!dob) return null;
  return Math.floor((Date.now() - new Date(dob).getTime()) / (1000 * 60 * 60 * 24 * 365.25));
}

const ACTION_ROUTES = {
  ACT_REBALANCE: (id) => `/client/${id}/rebalancing`,
};

// Actions absorbed into "Call Client Today" as sub-topics when it is present
const CALL_SUBTOPICS = {
  ACT_REASSURANCE_CALL: 'reassurance',
  ACT_CREDIT_REVIEW:    'credit review',
  ACT_SCHEDULE_CHECKIN: 'check-in',
};

function mapClient(c) {
  const rawActions = c.tickets
    .filter(t => t.action)
    .filter((t, i, arr) => arr.findIndex(x => x.action === t.action) === i);

  const hasCallToday = rawActions.some(t => t.action === 'ACT_CALL_TODAY');
  const subtopics = hasCallToday
    ? rawActions.filter(t => CALL_SUBTOPICS[t.action]).map(t => CALL_SUBTOPICS[t.action])
    : [];
  const absorbedKeys = new Set(hasCallToday ? Object.keys(CALL_SUBTOPICS) : []);

  const actions = rawActions
    .filter(t => !absorbedKeys.has(t.action))
    .map(t => ({
      label: t.action === 'ACT_CALL_TODAY' && subtopics.length
        ? `Call Client Today  (${subtopics.join(' · ')})`
        : (ACTION_LABELS[t.action] || t.action),
      route: ACTION_ROUTES[t.action] ? ACTION_ROUTES[t.action](c.client_id) : `/client/${c.client_id}/overview`,
    }));
  const rebalanceReason = actions[0]?.label ?? 'Review Required';
  return {
    id: c.client_id,
    name: c.name,
    aum: c.profile?.net_worth ?? null,
    ret: c.profile?.portfolio_return != null ? c.profile.portfolio_return / 100 : null,
    riskLabel: c.profile?.stated_risk_tolerance ?? null,
    creditScore: c.profile?.credit_score ?? null,
    age: calcAge(c.profile?.dob),
    profession: c.profile?.profession ?? null,
    priority: c.current_state.tier === 'CRITICAL' ? 'Critical'
            : c.current_state.tier === 'HIGH'     ? 'High'
            : c.current_state.tier === 'MEDIUM'   ? 'Medium'
            : c.current_state.tier === 'LOW'       ? 'Low'
            : 'On Track',
    rebalanceReason,
    whyPrioritised: c.why_prioritised ?? null,
    openRisks: c.current_state.open_risks ?? [],
    actions: actions.length ? actions : [{ label: 'Review Client', route: `/client/${c.client_id}/rebalancing` }],
  };
}

// ── Cache helpers (4-hour TTL) ────────────────────────────────────────────────
const CACHE_KEY = 'monitor_profiles_v6';
const CACHE_TTL = 18 * 60 * 60 * 1000;

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) { localStorage.removeItem(CACHE_KEY); return null; }
    return data;
  } catch { return null; }
}

function writeCache(data) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data })); } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────

const MonitorContext = createContext(null);

export function MonitorProvider({ children }) {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isDemo, setIsDemo] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [phase, setPhase] = useState(null);
  const [marketEventsAvailable, setMarketEventsAvailable] = useState(false);
  const [syncingMarket, setSyncingMarket] = useState(false);
  const [marketSynced, setMarketSynced] = useState(false);
  const [marketCleared, setMarketCleared] = useState(false);
  const [clearingMarket, setClearingMarket] = useState(false);
  const mountedRef = useRef(false);
  const pendingMarketSyncRef = useRef(false);
  const loadingRef = useRef(false);
  const marketSyncedRef = useRef(false);

  const flash = useCallback((msg) => {
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(''), 2500);
  }, []);

  const notifyMarketEventsReadyRef = useRef(null);

  const doResync = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    localStorage.removeItem(CACHE_KEY); // always bypass cache on manual resync
    setLoading(true); setPhase('resync'); setStatusMsg('syncing...');
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 900000);
      const res = await fetch(`${MONITOR_API}/run-demo`, { method: 'POST', signal: controller.signal });
      clearTimeout(timeout);
      const data = await res.json();
      const mapped = (data.priority_clients || []).map(mapClient);
      setProfiles(mapped);
      setIsDemo(true);
      writeCache(mapped);
      flash('synced');
      return mapped;
    } catch {
      flash('unavailable');
      return [];
    } finally {
      loadingRef.current = false;
      setLoading(false);
      setPhase(null);
      // If CIA notified while we were loading, auto-trigger market sync now
      if (pendingMarketSyncRef.current) {
        pendingMarketSyncRef.current = false;
        setTimeout(() => notifyMarketEventsReadyRef.current?.(), 0);
      }
    }
  }, [flash]); // notifyMarketEventsReady added below via ref

  const syncingMarketRef = useRef(false);
  const doSyncMarketEventsRef = useRef(null);

  const doSyncMarketEvents = useCallback(async () => {
    if (syncingMarketRef.current) return;
    syncingMarketRef.current = true;
    setSyncingMarket(true);
    setStatusMsg('syncing market events...');
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 300000);
      const res = await fetch(`${MONITOR_API}/sync-market-events`, { method: 'POST', signal: controller.signal });
      clearTimeout(timeout);
      const data = await res.json();
      const mapped = (data.priority_clients || []).map(mapClient);
      setProfiles(mapped);
      setIsDemo(true);
      writeCache(mapped);
      setMarketSynced(true);
      marketSyncedRef.current = true;
      setMarketCleared(false);
      flash('market events synced');
      return mapped;
    } catch {
      flash('market sync failed');
      return [];
    } finally {
      syncingMarketRef.current = false;
      setSyncingMarket(false);
    }
  }, [flash]);
  doSyncMarketEventsRef.current = doSyncMarketEvents;

  // Internal: clear existing market layer then sync fresh
  const doClearAndResyncMarket = useCallback(async () => {
    try {
      await fetch(`${MONITOR_API}/clear-market-events`, { method: 'POST' });
    } catch { /* best effort */ }
    await doSyncMarketEventsRef.current();
  }, []);

  // Called by CIA when events exist (fresh run or cache hit).
  // Checks graph date vs CIA event date to decide whether sync is needed.
  const notifyMarketEventsReady = useCallback(async () => {
    setMarketEventsAvailable(true);
    if (loadingRef.current) {
      pendingMarketSyncRef.current = true;
      return;
    }
    if (marketSyncedRef.current) return;
    // Check graph date directly — handles race between CIA fetch and on-mount has-market-events fetch
    try {
      const r = await fetch(`${MONITOR_API}/has-market-events`);
      const d = await r.json();
      if (!d.available) return; // no event today — nothing to sync
      if (d.synced_to_graph === true) {
        setMarketSynced(true);
        marketSyncedRef.current = true;
        return;
      }
    } catch { /* proceed to sync */ }
    await doSyncMarketEventsRef.current();
  }, []);
  notifyMarketEventsReadyRef.current = notifyMarketEventsReady;

    // On app load: use cache if fresh (<4h), else call re-sync API
  const { cockpitReady } = useAuth();

  useEffect(() => {
    if (!cockpitReady) return;
    if (mountedRef.current) return;
    mountedRef.current = true;
    const cached = readCache();
    if (cached && cached.length > 0) {
      setProfiles(cached);
      setIsDemo(true);
      if (CIA_GRAPH_SYNC) {
        // Cache hit + CIA_GRAPH_SYNC: clear any stale graph market event now,
        // then wait for CIAContext to call notifyMarketEventsReady if there's a today event.
        setLoading(true);
        fetch(`${MONITOR_API}/has-market-events`)
          .then(r => r.json())
          .then(async d => {
            if (d.graph_event_date && !d.available) {
              // Stale graph event, no CIA event today — clear it
              await fetch(`${MONITOR_API}/clear-market-events`, { method: 'POST' });
              setMarketSynced(false); marketSyncedRef.current = false;
            } else if (d.available && d.synced_to_graph) {
              setMarketEventsAvailable(true); setMarketSynced(true); marketSyncedRef.current = true;
            } else if (d.available && !d.synced_to_graph) {
              // Event in DDB but not in graph — Neo4j may have been down when CIA ran.
              // CIA won't call notifyMarketEventsReady again (fetchedRef guard). Sync now.
              setMarketEventsAvailable(true);
              doSyncMarketEventsRef.current();
            }
          })
          .catch(() => {})
          .finally(() => setLoading(false));
      }
      return;
    }
    // No cache — always run-demo for base board.
    // After run-demo completes, check if a today event exists in DDB but wasn't synced
    // (e.g. Neo4j was down when CIA ran). CIA won't retry — this is the recovery path.
    doResync().then(() => {
      if (!CIA_GRAPH_SYNC) return;
      fetch(`${MONITOR_API}/has-market-events`)
        .then(r => r.json())
        .then(d => {
          if (d.available && !d.synced_to_graph) {
            setMarketEventsAvailable(true);
            doSyncMarketEventsRef.current();
          } else if (d.available && d.synced_to_graph) {
            setMarketEventsAvailable(true); setMarketSynced(true); marketSyncedRef.current = true;
          }
        })
        .catch(() => {});
    });
  }, [cockpitReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const doClearMarketEvents = useCallback(async () => {
    if (clearingMarket) return;
    setClearingMarket(true);
    setStatusMsg('clearing market events...');
    try {
      const res = await fetch(`${MONITOR_API}/clear-market-events`, { method: 'POST' });
      const data = await res.json();
      if (data.status === 'cleared') {
        await doResync();
        setMarketSynced(false);
        marketSyncedRef.current = false;
        setMarketCleared(true);
        flash('market events cleared');
      }
    } catch {
      flash('clear failed');
    } finally {
      setClearingMarket(false);
    }
  }, [clearingMarket, doResync, flash]);

  return (
    <MonitorContext.Provider value={{
      profiles, loading, isDemo, statusMsg, phase, doResync,
      marketEventsAvailable, syncingMarket, marketSynced, marketCleared, doSyncMarketEvents,
      clearingMarket, doClearMarketEvents, notifyMarketEventsReady,
    }}>
      {children}
    </MonitorContext.Provider>
  );
}

export function useMonitor() {
  return useContext(MonitorContext);
}
