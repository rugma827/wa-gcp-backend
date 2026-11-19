import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { CIA_API_URL } from '../config/api';
import { useMonitor } from './MonitorContext';
import { useAuth } from './AuthContext';

const CIAContext = createContext(null);

export function CIAProvider({ children }) {
  const [reports, setReports] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const fetchedRef = useRef(false);
  const { notifyMarketEventsReady } = useMonitor();

  const fetchLatest = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${CIA_API_URL}/latest-run`);
      if (!res.ok) throw new Error(`CIA API error: ${res.status}`);
      const data = await res.json();
      if (data.status === 'processing') {
        setError('Pipeline is running. Please wait and refresh.');
        return;
      }
      setEvents(data.events || []);
      setReports(data.reports || []);
      // Always notify when events exist — MonitorContext checks graph state
      // and skips re-sync if already synced. This ensures every user session
      // gets the correct zap button state regardless of cache hit/miss.
      if ((data.events || []).length > 0) {
        notifyMarketEventsReady();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [notifyMarketEventsReady]);

  const { cockpitReady } = useAuth();

  useEffect(() => {
    if (!cockpitReady) return;
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    fetchLatest();
  }, [cockpitReady, fetchLatest]);

  return (
    <CIAContext.Provider value={{ reports, events, loading, error, refresh: fetchLatest }}>
      {children}
    </CIAContext.Provider>
  );
}

export function useCIA() {
  return useContext(CIAContext);
}
