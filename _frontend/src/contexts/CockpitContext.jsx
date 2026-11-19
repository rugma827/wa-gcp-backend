import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './AuthContext';
import { useCalendar } from '../hooks/useCalendar';
import { useGoogleAuth } from '../hooks/useGoogleAuth';

const CockpitContext = createContext(null);

export function CockpitProvider({ children }) {
  const { userId, googleConnected, setGoogleConnected } = useAuth();
  const [sessionExpiredBanner, setSessionExpiredBanner] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const {
    calendarEvents, setCalendarEvents,
    calendarLoading, calendarError,
    upcomingEvents, upcomingLoading, upcomingError,
    calendarFetchedRef, upcomingFetchedRef,
    fetchCalendarEvents, fetchUpcomingEvents,
    clearCalendarCache, refreshBoth,
  } = useCalendar({ userId, googleConnected, setGoogleConnected, setSessionExpiredBanner });

  const { googleConnecting, authUrl, prefetchAuthUrl, handleGoogleConnect } = useGoogleAuth({
    userId,
    setGoogleConnected,
    setSessionExpiredBanner,
    onRefreshBoth: refreshBoth,
  });

  // Pre-fetch auth URL when not connected
  useEffect(() => {
    if (!googleConnected) prefetchAuthUrl();
  }, [googleConnected]);

  // Auto-close session banner when reconnected
  useEffect(() => {
    if (googleConnected) setSessionExpiredBanner(false);
  }, [googleConnected]);

  const handleRefresh = useCallback(async () => {
    if (!googleConnected) { handleGoogleConnect(); return; }
    setRefreshing(true);
    await refreshBoth();
    setRefreshing(false);
  }, [googleConnected, handleGoogleConnect, refreshBoth]);

  const handleResetSettings = useCallback(() => {
    setGoogleConnected(false);
    clearCalendarCache();
    setSessionExpiredBanner(false);
  }, [setGoogleConnected, clearCalendarCache]);

  return (
    <CockpitContext.Provider value={{
      // calendar
      calendarEvents, setCalendarEvents,
      calendarLoading, calendarError,
      upcomingEvents, upcomingLoading, upcomingError,
      calendarFetchedRef, upcomingFetchedRef,
      fetchCalendarEvents, fetchUpcomingEvents,
      refreshBoth,
      // google auth
      googleConnected, setGoogleConnected,
      googleConnecting, authUrl,
      handleGoogleConnect,
      // session
      sessionExpiredBanner, setSessionExpiredBanner,
      refreshing,
      handleRefresh,
      handleResetSettings,
    }}>
      {children}
    </CockpitContext.Provider>
  );
}

export function useCockpit() {
  return useContext(CockpitContext);
}
