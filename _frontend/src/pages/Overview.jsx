import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import './Overview.css';
import { useOverviewContext } from '../contexts/OverviewContext';
import { useCockpit } from '../contexts/CockpitContext';

import PriorityQueue from '../components/overview/PriorityQueue';
import MeetingIntelligence from '../components/overview/MeetingIntelligence';
import PortfolioMonitor from '../components/overview/PortfolioMonitor';
import MassMailerChat from '../components/overview/MassMailerChat';
import MeetingSettingsModal from '../components/overview/MeetingSettingsModal';

const Overview = ({ isChatExpanded, setIsChatExpanded }) => {
  const [eventData, setEventData] = useState(null);
  const { handleEventAlertClick } = useOverviewContext(setIsChatExpanded, setEventData);
  const navigate = useNavigate();
  const location = useLocation();

  const [showMeetingSettings, setShowMeetingSettings] = useState(false);
  const [scheduleFrequency] = useState('daily');
  const [scheduleMorningTime] = useState('07:30');
  const [scheduleAfternoonTime] = useState('13:00');

  const {
    calendarEvents, setCalendarEvents,
    calendarLoading, calendarError,
    upcomingEvents, upcomingLoading, upcomingError,
    calendarFetchedRef, upcomingFetchedRef,
    fetchCalendarEvents, fetchUpcomingEvents,
    googleConnected, setGoogleConnected,
    googleConnecting, authUrl,
    handleGoogleConnect,
    sessionExpiredBanner, setSessionExpiredBanner,
    refreshing, handleRefresh, handleResetSettings,
  } = useCockpit();

  // Close settings modal automatically when Google connects successfully
  useEffect(() => {
    if (googleConnected && showMeetingSettings) setShowMeetingSettings(false);
  }, [googleConnected]);

  // URL param handlers
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    if (location.pathname === '/chat' || searchParams.get('mode')) setIsChatExpanded(true);
  }, []);

  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    if (searchParams.get('event') === 'mailer') {
      const ciaReport = location.state?.ciaReport || null;
      handleEventAlertClick('market-event', ciaReport);
      navigate('/', { replace: true, state: {} });
    }
  }, [location.search, location.state]);

  useEffect(() => {
    if (!isChatExpanded) setEventData(null);
  }, [isChatExpanded]);

  return (
    <div className={`overview${isChatExpanded ? ' overview--chat-open' : ''}`}>

      {isChatExpanded && (
        <MassMailerChat
          eventData={eventData}
          isChatExpanded={isChatExpanded}
          setIsChatExpanded={setIsChatExpanded}
          setEventData={setEventData}
        />
      )}

      <div className={`overview__content${isChatExpanded ? ' overview__content--hidden' : ''}`}>

        <div className="overview__left">
          <PriorityQueue />
        </div>

        <div className="overview__right">
          <MeetingIntelligence
            googleConnected={googleConnected}
            setGoogleConnected={setGoogleConnected}
            calendarEvents={calendarEvents}
            calendarLoading={calendarLoading}
            calendarError={calendarError}
            upcomingEvents={upcomingEvents}
            upcomingLoading={upcomingLoading}
            upcomingError={upcomingError}
            sessionExpiredBanner={sessionExpiredBanner}
            setSessionExpiredBanner={setSessionExpiredBanner}
            fetchCalendarEvents={fetchCalendarEvents}
            fetchUpcomingEvents={fetchUpcomingEvents}
            googleConnecting={googleConnecting}
            scheduleFrequency={scheduleFrequency}
            scheduleMorningTime={scheduleMorningTime}
            scheduleAfternoonTime={scheduleAfternoonTime}
            onOpenSettings={() => setShowMeetingSettings(true)}
            onRefreshClick={handleRefresh}
            refreshing={refreshing}
            upcomingFetchedRef={upcomingFetchedRef}
            onConnect={handleGoogleConnect}
            authUrlReady={!!authUrl}
          />
          <PortfolioMonitor />
        </div>
      </div>

      {showMeetingSettings && (
        <MeetingSettingsModal
          onClose={() => setShowMeetingSettings(false)}
          googleConnected={googleConnected}
          googleConnecting={googleConnecting}
          onGoogleConnect={handleGoogleConnect}
          onGoogleDisconnect={() => { setGoogleConnected(false); setCalendarEvents(null); }}
          onReset={handleResetSettings}
        />
      )}

    </div>
  );
};

export default Overview;
