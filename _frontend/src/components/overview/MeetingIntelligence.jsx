import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, RefreshCw, SlidersHorizontal, AlertTriangle, Calendar, Sun, CalendarDays } from 'lucide-react';
import { useMeetingPrep } from '../../contexts/MeetingPrepContext';
import { useAuth } from '../../contexts/AuthContext';
import { runMeetingPrepById } from '../../services/meetingPrepService';
import { getCognitoToken, getSessionId } from '../../utils/authCookies';
import { API_BASE_URL } from '../../config/api';
import Spinner from '../Spinner';
import Tooltip from '../Tooltip';
import './OverviewShared.css';
import './MeetingIntelligence.css';

// Static priority clients — always shown in Today tab with View Prep ready
const STATIC_TODAY_MEETINGS = [
  { clientId: '15600001', name: 'Alex Morgan',    topic: 'Portfolio Drift & Rebalancing Review', time: '10:00 AM', sortMinutes: 600 },
  { clientId: 'C012',     name: 'Kevin Smyth',    topic: 'Cash Deployment Review',               time: '2:30 PM',  sortMinutes: 870 },
];

const PROGRESS_PHASES = [
  { until: 20, label: 'Fetching client & portfolio data...' },
  { until: 40, label: 'Analysing risks & opportunities...' },
  { until: 70, label: 'Drafting discussion angles & activity...' },
  { until: 90, label: 'Assembling meeting brief...' },
  { until: 100, label: 'Finalising brief...' },
];

function getPhaseLabel(pct) {
  for (const p of PROGRESS_PHASES) {
    if (pct <= p.until) return p.label;
  }
  return 'Finalising brief...';
}

const MeetingIntelligence = ({
  googleConnected, setGoogleConnected,
  calendarEvents, calendarLoading, calendarError,
  upcomingEvents, upcomingLoading, upcomingError,
  sessionExpiredBanner, setSessionExpiredBanner,
  fetchCalendarEvents, fetchUpcomingEvents,
  googleConnecting,
  scheduleFrequency, scheduleMorningTime, scheduleAfternoonTime,
  onOpenSettings,
  onRefreshClick,
  upcomingFetchedRef,
  refreshing,
  onConnect,
  authUrlReady,
}) => {
  const navigate = useNavigate();
  const { userId } = useAuth();
  const { results, generating, progress, setResult, setGeneratingFor, setProgressFor } = useMeetingPrep();
  const [meetingTab, setMeetingTab] = useState('today');
  const [generateError, setGenerateError] = useState({});
  // meetingId → clientId mapping, persisted in localStorage so it survives remounts
  const RESOLVED_KEY = 'meetingPrepResolvedIds';
  const getResolvedIds = () => { try { return JSON.parse(localStorage.getItem(RESOLVED_KEY) || '{}'); } catch { return {}; } };
  const setResolvedId = (meetingId, clientId) => { try { const m = getResolvedIds(); m[meetingId] = clientId; localStorage.setItem(RESOLVED_KEY, JSON.stringify(m)); } catch {} };

async function handleGenerate(meetingId) {
    setGeneratingFor(meetingId, true);
    setGenerateError(prev => ({ ...prev, [meetingId]: '' }));
    setProgressFor(meetingId, 0);

    let meetingConfig = {};
    try {
      const stored = localStorage.getItem('meeting_prep_config');
      if (stored) meetingConfig = JSON.parse(stored);
    } catch { /* ignore */ }

    const res = await runMeetingPrepById(userId, meetingId, true, meetingConfig);
    if (!res.ok) {
      setGeneratingFor(meetingId, false);
      setProgressFor(meetingId, 0);
      if (res.authRequired) { setGoogleConnected(false); setSessionExpiredBanner(true); }
      else { setGenerateError(prev => ({ ...prev, [meetingId]: res.error })); }
      return;
    }

    // Cached result — navigate immediately
    const cached = res.data?.meetings?.[0];
    if (cached && cached.type !== 'meeting_prep_pending') {
      const rawId = cached.client?.clientId || cached.client?.customerId;
      const clientId = rawId?.startsWith('direct_') ? rawId.slice(7) : rawId;
      const storeKey = clientId || meetingId;
      const navTarget = clientId ? `/meeting-prep/${clientId}` : `/meeting-prep/live-${meetingId}`;
      setProgressFor(meetingId, 100);
      setResult(storeKey, cached);
      if (clientId) setResolvedId(meetingId, clientId);
      setTimeout(() => { setGeneratingFor(meetingId, false); navigate(navTarget); }, 400);
      return;
    }

    // Background task — subscribe to SSE progress
    const taskId = res.data?.task_id;
    if (!taskId) {
      setGeneratingFor(meetingId, false);
      setGenerateError(prev => ({ ...prev, [meetingId]: 'No task ID returned. Try again.' }));
      return;
    }

    try {
      const sseRes = await fetch(`${API_BASE_URL}/assist/progress/${taskId}`, {
        headers: {
          Authorization: `Bearer ${getCognitoToken()}`,
          'X-Session-ID': getSessionId(),
        },
      });
      const reader = sseRes.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.pct !== undefined) setProgressFor(meetingId, evt.pct);
            if (evt.type === 'result') {
              const brief = evt.result?.data;
              if (brief) {
                const rawId = brief.client?.clientId || brief.client?.customerId;
                const clientId = rawId?.startsWith('direct_') ? rawId.slice(7) : rawId;
                const storeKey = clientId || meetingId;
                const navTarget = clientId ? `/meeting-prep/${clientId}` : `/meeting-prep/live-${meetingId}`;
                setResult(storeKey, brief);
                if (clientId) setResolvedId(meetingId, clientId);
                setProgressFor(meetingId, 100);
                setTimeout(() => { setGeneratingFor(meetingId, false); navigate(navTarget); }, 400);
              } else {
                setGeneratingFor(meetingId, false);
                setGenerateError(prev => ({ ...prev, [meetingId]: evt.result?.message || 'Prep failed. Try again.' }));
              }
              return;
            }
          } catch { /* malformed SSE line */ }
        }
      }
    } catch (e) {
      setGeneratingFor(meetingId, false);
      setGenerateError(prev => ({ ...prev, [meetingId]: 'Connection lost. Try again.' }));
    }
  }

  const fmtTime = (t) => {
    const [h, m] = t.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  };

  return (
    <div className="ov-card overview__meetings">
      <div className="ov-card__head">
        <div>
          <span className="ov-card__title">Meeting Intelligence</span>
          <p className="ov-card__subtitle">Today's schedule · AI briefs on demand</p>
        </div>
        <span className="ov-view-all" onClick={() => navigate('/prioritize')}>View More <ChevronRight size={11} /></span>
      </div>

      <div className="ov-meeting-tabs-row">
        <div className="ov-meeting-tabs">
          <button
            className={`ov-meeting-tab${meetingTab === 'today' ? ' ov-meeting-tab--active' : ''}`}
            onClick={() => setMeetingTab('today')}
          >Today</button>
          <button
            className={`ov-meeting-tab${meetingTab === 'upcoming' ? ' ov-meeting-tab--active' : ''}`}
            onClick={() => {
              setMeetingTab('upcoming');
              if (googleConnected && (!upcomingFetchedRef.current || !upcomingEvents?.length)) {
                upcomingFetchedRef.current = true;
                fetchUpcomingEvents();
              }
            }}
          >Upcoming</button>
        </div>
          <div className="ov-meeting-tabs-actions">
            <Tooltip content="Refresh calendar" placement="bottom">
              <button
                className={`ov-refresh-btn${refreshing ? ' ov-refresh-btn--spinning' : ''}`}
                onClick={onRefreshClick}
                disabled={refreshing}
              >
                <RefreshCw size={13} className={refreshing ? 'ov-spin' : ''} />
                {refreshing ? 'Refreshing...' : 'Refresh'}
              </button>
            </Tooltip>
            <Tooltip content="Meeting Prep Settings" placement="bottom">
              <button className="ov-settings-btn" onClick={onOpenSettings}>
                <SlidersHorizontal size={14} />
              </button>
            </Tooltip>
          </div>
      </div>

      <div className="ov-meetings-date-label">
        {meetingTab === 'today'
          ? `Today · ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}`
          : 'Upcoming Meetings'}
      </div>

      <div className="ov-meetings-scroll">
        {refreshing ? (
          <div className="ov-calendar-loading-state">
            <Spinner size={20} />
            <span className="ov-calendar-loading-state__text">Refreshing your calendar...</span>
          </div>
        ) : meetingTab === 'today' ? (
          <>
            {sessionExpiredBanner && (
              <div className="ov-session-expired">
                <AlertTriangle size={13} />
                Your Google Calendar session has expired.
                <button
                  className="ov-session-expired__btn"
                  onClick={() => { setSessionExpiredBanner(false); onConnect(); }}
                  disabled={googleConnecting}
                >
                  {googleConnecting ? 'Connecting...' : 'Reconnect'}
                </button>
              </div>
            )}

            {googleConnected && calendarLoading && (
              <div className="ov-calendar-loading-state">
                <Spinner size={20} />
                <span className="ov-calendar-loading-state__text">Fetching your meetings...</span>
              </div>
            )}

            {googleConnected && !calendarLoading && calendarError && (
              <div className="ov-calendar-error">
                <AlertTriangle size={13} />
                <span>{calendarError}</span>
                <button className="ov-calendar-error__retry" onClick={fetchCalendarEvents}>Retry</button>
              </div>
            )}

            {/* ── Merged static + live rows, sorted by time ── */}
            {(() => {
              // Build live rows with sortMinutes
              const liveRows = (googleConnected && !calendarLoading && !calendarError && calendarEvents?.length > 0)
                ? calendarEvents.map((ev, idx) => {
                    const startRaw = ev.start?.dateTime || ev.start?.date || '';
                    let timeStr = '', sortMinutes = 9999;
                    try {
                      const d = new Date(startRaw);
                      timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                      sortMinutes = d.getHours() * 60 + d.getMinutes();
                    } catch { timeStr = startRaw; }
                    return { type: 'live', ev, idx, timeStr, sortMinutes, meetingId: ev.id || String(idx) };
                  })
                : [];

              // Merge and sort by time
              const allRows = [
                ...STATIC_TODAY_MEETINGS.map(s => ({ type: 'static', ...s })),
                ...liveRows,
              ].sort((a, b) => a.sortMinutes - b.sortMinutes);

              return allRows.map((row, i) => {
                if (row.type === 'static') {
                  const [timePart, period] = row.time.split(' ');
                  return (
                    <div key={`static-${row.clientId}`} className="ov-meeting-row-wrap">
                      <div className="ov-meeting-row">
                        <div className="ov-meeting-row__time">
                          <span>{timePart}</span>
                          <span className="ov-meeting-row__period">{period}</span>
                        </div>
                        <div className="ov-meeting-row__info">
                          <span className="ov-meeting-row__client">{row.name}</span>
                          <span className="ov-meeting-row__topic">{row.topic}</span>
                        </div>
                        <div className="ov-meeting-row__action">
                          <button
                            className="ov-meeting-row__btn ov-meeting-row__btn--ready"
                            onClick={() => navigate(`/meeting-prep/${row.clientId}`)}
                          >View Prep</button>
                        </div>
                      </div>
                    </div>
                  );
                }

                // Live row
                const { ev, idx, timeStr, meetingId } = row;
                const isGen   = generating[meetingId];
                const resolvedCid = getResolvedIds()[meetingId];
                const isReady = resolvedCid ? !!results[resolvedCid] : false;
                const pct     = progress[meetingId] || 0;
                const errMsg  = generateError[meetingId];
                const clientName = ev.summary || 'Meeting';
                const topic      = ev.description || ev.summary || '';
                return (
                  <div key={ev.id || idx} className="ov-meeting-row-wrap">
                    <div className="ov-meeting-row">
                      <div className="ov-meeting-row__time">
                        <span>{timeStr.split(' ')[0]}</span>
                        <span className="ov-meeting-row__period">{timeStr.split(' ')[1] || ''}</span>
                      </div>
                      {isGen ? (
                        <div className="ov-meeting-row__generating">
                          <span className="ov-meeting-row__client">{clientName}</span>
                          <div className="ov-progress-wrap">
                            <div className="ov-progress-bar"><div className="ov-progress-fill" style={{ width: `${pct}%` }} /></div>
                            <span className="ov-progress-label">{getPhaseLabel(pct)}</span>
                          </div>
                        </div>
                      ) : (
                        <div className="ov-meeting-row__info">
                          <span className="ov-meeting-row__client">{clientName}</span>
                          <span className="ov-meeting-row__topic">{topic}</span>
                          {errMsg && <span className="ov-meeting-row__error"><AlertTriangle size={11} /> {errMsg}</span>}
                        </div>
                      )}
                      <div className="ov-meeting-row__action">
                        {isReady ? (
                          <button className="ov-meeting-row__btn ov-meeting-row__btn--ready" onClick={() => navigate(`/meeting-prep/${resolvedCid}`)}>View Prep</button>
                        ) : isGen ? (
                          <span className="ov-progress-pct-badge">{pct}%</span>
                        ) : (
                          <button className="ov-meeting-row__btn ov-meeting-row__btn--generate" onClick={() => handleGenerate(ev.id || String(idx))}>Generate</button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              });
            })()}

            {/* Inline note when calendar not connected */}
            {!googleConnected && !sessionExpiredBanner && (
              <div className="ov-meetings-empty ov-meetings-empty--inline">
                <span className="ov-meetings-empty__sub">Connect Google Calendar to load your other meetings today.</span>
                <button
                  className="ov-meetings-empty__action"
                  onClick={onConnect}
                  disabled={googleConnecting || !authUrlReady}
                >
                  {googleConnecting ? 'Connecting...' : !authUrlReady ? 'Loading...' : 'Connect Google Calendar'}
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            {!googleConnected && (
              <div className="ov-meetings-empty">
                <div className="ov-meetings-empty__icon"><Calendar size={24} /></div>
                <span className="ov-meetings-empty__title">Calendar not connected</span>
                <span className="ov-meetings-empty__sub">Connect your Google Calendar to load upcoming meetings.</span>
                <button
                  className="ov-meetings-empty__action"
                  onClick={onConnect}
                  disabled={googleConnecting || !authUrlReady}
                >
                  {googleConnecting ? 'Connecting...' : !authUrlReady ? 'Loading...' : 'Connect Google Calendar'}
                </button>
              </div>
            )}
            {googleConnected && upcomingLoading && (
              <div className="ov-calendar-loading-state">
                <Spinner size={20} />
                <span className="ov-calendar-loading-state__text">Fetching upcoming meetings...</span>
              </div>
            )}
            {googleConnected && !upcomingLoading && upcomingError && (
              <div className="ov-calendar-error">
                <AlertTriangle size={13} />
                <span>{upcomingError}</span>
                <button className="ov-calendar-error__retry" onClick={() => { upcomingFetchedRef.current = false; fetchUpcomingEvents(); }}>Retry</button>
              </div>
            )}
            {googleConnected && !upcomingLoading && !upcomingError && upcomingEvents && upcomingEvents.length === 0 && (
              <div className="ov-meetings-empty">
                <div className="ov-meetings-empty__icon"><CalendarDays size={24} /></div>
                <span className="ov-meetings-empty__title">No meetings tomorrow</span>
                <span className="ov-meetings-empty__sub">Your calendar looks clear. Upcoming meetings will appear here once scheduled.</span>
              </div>
            )}
            {googleConnected && !upcomingLoading && !upcomingError && upcomingEvents && upcomingEvents.length > 0 && (() => {
              let lastDate = null;
              return upcomingEvents.map((ev, idx) => {
                const startRaw = ev.start?.dateTime || ev.start?.date || '';
                let timeStr = '', dateLabel = '';
                try {
                  const d = new Date(startRaw);
                  timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                  dateLabel = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                } catch { timeStr = startRaw; dateLabel = startRaw; }
                const showDateHeader = dateLabel !== lastDate;
                lastDate = dateLabel;
                const clientName = ev.summary || 'Meeting';
                const topic = ev.description || ev.summary || '';
                const meetingId = ev.id || String(idx);
                const isGen = generating[meetingId];
                const resolvedCidUp = getResolvedIds()[meetingId];
                const isReady = resolvedCidUp ? !!results[resolvedCidUp] : false;
                const pct = progress[meetingId] || 0;
                const errMsg = generateError[meetingId];
                return (
                  <div key={ev.id || idx}>
                    {showDateHeader && <div className="ov-meetings-date-label ov-meetings-date-label--group">{dateLabel}</div>}
                    <div className="ov-meeting-row-wrap">
                      <div className="ov-meeting-row ov-meeting-row--upcoming">
                        <div className="ov-meeting-row__time">
                          <span>{timeStr.split(' ')[0]}</span>
                          <span className="ov-meeting-row__period">{timeStr.split(' ')[1] || ''}</span>
                        </div>
                        {isGen ? (
                          <div className="ov-meeting-row__generating">
                            <span className="ov-meeting-row__client">{clientName}</span>
                            <div className="ov-progress-wrap">
                              <div className="ov-progress-bar"><div className="ov-progress-fill" style={{ width: `${pct}%` }} /></div>
                              <span className="ov-progress-label">{getPhaseLabel(pct)}</span>
                            </div>
                          </div>
                        ) : (
                          <div className="ov-meeting-row__info">
                            <span className="ov-meeting-row__client">{clientName}</span>
                            <span className="ov-meeting-row__topic">{topic}</span>
                            {errMsg && <span className="ov-meeting-row__error"><AlertTriangle size={11} /> {errMsg}</span>}
                          </div>
                        )}
                        <div className="ov-meeting-row__action">
                          {isReady ? (
                            <button className="ov-meeting-row__btn ov-meeting-row__btn--ready" onClick={() => navigate(`/meeting-prep/${resolvedCidUp}`)}>View Prep</button>
                          ) : isGen ? (
                            <span className="ov-progress-pct-badge">{pct}%</span>
                          ) : (
                            <button className="ov-meeting-row__btn ov-meeting-row__btn--generate" onClick={() => handleGenerate(meetingId)}>Generate</button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              });
            })()}
          </>
        )}
      </div>

      <div className="ov-meetings-status">
        <span className="ov-meetings-status__item ov-meetings-status__item--off ov-meetings-status__item--disabled">
          <span className="ov-meetings-status__dot" /> Outlook
        </span>
        <span className={`ov-meetings-status__item${googleConnected ? ' ov-meetings-status__item--connected' : ' ov-meetings-status__item--off'}`}>
          <span className="ov-meetings-status__dot" /> Google
          {googleConnecting && <Spinner size={10} style={{ marginLeft: 4 }} />}
        </span>
        <span className="ov-meetings-status__item ov-meetings-status__item--muted">
          {scheduleFrequency === 'twice'
            ? `${fmtTime(scheduleMorningTime)} & ${fmtTime(scheduleAfternoonTime)}`
            : `Daily · ${fmtTime(scheduleMorningTime)}`}
        </span>
      </div>
    </div>
  );
};

export default MeetingIntelligence;
