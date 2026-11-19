import { useState, useRef, useEffect } from 'react';
import { getUpcomingEvents } from '../services/meetingPrepService';

export function useCalendar({ userId, googleConnected, setGoogleConnected, setSessionExpiredBanner }) {
  const [calendarEvents, setCalendarEvents] = useState(() => {
    const cached = sessionStorage.getItem('calendarEvents_today');
    const cachedDate = sessionStorage.getItem('calendarEvents_date');
    if (cached && cachedDate === new Date().toDateString()) return JSON.parse(cached);
    return null;
  });
  const [calendarLoading, setCalendarLoading] = useState(
    () => localStorage.getItem('googleCalConnected') === 'true' && !sessionStorage.getItem('calendarEvents_today')
  );
  const [calendarError, setCalendarError] = useState('');

  const [upcomingEvents, setUpcomingEvents] = useState(() => {
    const cached = sessionStorage.getItem('upcomingEvents_cache');
    const cachedDate = sessionStorage.getItem('upcomingEvents_date');
    if (cached && cachedDate === new Date().toDateString()) return JSON.parse(cached);
    return null;
  });
  const [upcomingLoading, setUpcomingLoading] = useState(false);
  const [upcomingError, setUpcomingError] = useState('');

  const calendarFetchedRef = useRef(
    () => sessionStorage.getItem('calendarEvents_today') && sessionStorage.getItem('calendarEvents_date') === new Date().toDateString()
  );
  const upcomingFetchedRef = useRef(
    () => sessionStorage.getItem('upcomingEvents_cache') && sessionStorage.getItem('upcomingEvents_date') === new Date().toDateString()
  );

  useEffect(() => {
    if (googleConnected && !calendarFetchedRef.current) {
      const cachedDate = sessionStorage.getItem('calendarEvents_date');
      const today = new Date().toDateString();
      if (cachedDate && cachedDate !== today) {
        sessionStorage.removeItem('calendarEvents_today');
        sessionStorage.removeItem('calendarEvents_date');
        sessionStorage.removeItem('upcomingEvents_cache');
        sessionStorage.removeItem('upcomingEvents_date');
        setCalendarEvents(null);
        setUpcomingEvents(null);
      }
      calendarFetchedRef.current = true;
      upcomingFetchedRef.current = true;
      fetchBoth();
    }
    if (!googleConnected) {
      calendarFetchedRef.current = false;
      upcomingFetchedRef.current = false;
    }
  }, [googleConnected]);

  // Single AgentCore call — fetches today + tomorrow, splits by date
  async function fetchBoth() {
    const today = new Date().toDateString();
    const todayDate = new Date().toISOString().slice(0, 10);

    setCalendarLoading(true);
    setUpcomingLoading(true);
    setCalendarError('');
    setUpcomingError('');

    const res = await getUpcomingEvents(userId, 0, 2);

    setCalendarLoading(false);
    setUpcomingLoading(false);

    if (!res.ok) {
      if (res.authRequired || res.status === 401) {
        setGoogleConnected(false);
        if (googleConnected) setSessionExpiredBanner(true);
      } else {
        setCalendarError(res.error);
        setUpcomingError(res.error);
      }
      return;
    }

    const allEvents = res.data?.events || [];
    const todayEvents = allEvents.filter(ev => (ev.start?.dateTime || ev.start?.date || '').startsWith(todayDate));
    const tomorrowEvents = allEvents.filter(ev => !(ev.start?.dateTime || ev.start?.date || '').startsWith(todayDate));

    setCalendarEvents(todayEvents);
    setUpcomingEvents(tomorrowEvents);
    sessionStorage.setItem('calendarEvents_today', JSON.stringify(todayEvents));
    sessionStorage.setItem('calendarEvents_date', today);
    sessionStorage.setItem('upcomingEvents_cache', JSON.stringify(tomorrowEvents));
    sessionStorage.setItem('upcomingEvents_date', today);
  }

  async function fetchCalendarEvents() { return fetchBoth(); }
  async function fetchUpcomingEvents() { return fetchBoth(); }

  function clearCalendarCache() {
    calendarFetchedRef.current = false;
    upcomingFetchedRef.current = false;
    setCalendarEvents(null);
    setCalendarError('');
    setUpcomingEvents(null);
    setUpcomingError('');
    sessionStorage.removeItem('calendarEvents_today');
    sessionStorage.removeItem('calendarEvents_date');
    sessionStorage.removeItem('upcomingEvents_cache');
    sessionStorage.removeItem('upcomingEvents_date');
  }

  async function refreshBoth() {
    clearCalendarCache();
    calendarFetchedRef.current = true;
    upcomingFetchedRef.current = true;
    await fetchBoth();
  }

  return {
    calendarEvents, setCalendarEvents,
    calendarLoading, calendarError,
    upcomingEvents, upcomingLoading, upcomingError,
    calendarFetchedRef, upcomingFetchedRef,
    fetchCalendarEvents, fetchUpcomingEvents,
    clearCalendarCache,
    refreshBoth,
  };
}
