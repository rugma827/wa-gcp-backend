import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle, Zap, RefreshCw } from 'lucide-react';
import { useCIA } from '../contexts/CIAContext';
import './ImpactAssessmentBar.css';

const SEVERITY_COLOR = {
  CRITICAL: 'var(--error)',
  HIGH:     'var(--warning)',
  MEDIUM:   'var(--info)',
  LOW:      'var(--success)',
};

const ImpactAssessmentBar = () => {
  const navigate = useNavigate();
  const { reports, loading, error, refresh } = useCIA();
  const [refreshing, setRefreshing] = useState(false);
  const [resetTick, setResetTick] = useState(0);

  useEffect(() => {
    const handler = () => setResetTick(t => t + 1);
    window.addEventListener('cia-resolved-reset', handler);
    return () => window.removeEventListener('cia-resolved-reset', handler);
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  // Read per-event completion from localStorage
  const completedEvents = (() => {
    try { return JSON.parse(localStorage.getItem('cia_completed_events') || '{}'); }
    catch { return {}; }
  })();

  const handlePillClick = (report) => {
    if (completedEvents[report.event_id]) return; // don't re-open resolved events
    navigate('/?event=mailer', { state: { ciaReport: report } });
  };

  // Loading skeleton
  if (loading) {
    return (
      <div className="iab-root">
        <div className="iab-label">
          <Zap size={12} className="iab-label__icon" />
          <span className="iab-label__title">Market Customer Impact</span>
        </div>
        <div className="iab-pills">
          <div className="iab-pill iab-pill--loading">Loading events...</div>
        </div>
        <button className="iab-action" disabled>
          <RefreshCw size={11} />
          Refresh
        </button>
      </div>
    );
  }

  // No events today
  if (!reports.length) {
    return (
      <div className="iab-root iab-root--empty">
        <div className="iab-label">
          <Zap size={12} className="iab-label__icon iab-label__icon--muted" />
          <span className="iab-label__title iab-label__title--muted">Market Customer Impact</span>
        </div>
        <span className="iab-empty-text">{error || 'No critical events today'}</span>
        <button className="iab-action" onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw size={11} className={refreshing ? 'iab-spin' : ''} />
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
    );
  }

  return (
    <div className="iab-root">

      {/* Left label */}
      <div className="iab-label">
        <Zap size={12} className="iab-label__icon" />
        <span className="iab-label__title">Market Customer Impact</span>
      </div>

      {/* One pill per event */}
      <div className="iab-pills">
        {reports.map((report) => {
          const severity = report.event_severity || 'MEDIUM';
          const affected = report.portfolio_impact?.clients_affected ?? 0;
          const critical = report.portfolio_impact?.critical ?? 0;
          const isCompleted = !!completedEvents[report.event_id];

          return (
            <div
              key={report.event_id}
              className={`iab-pill${isCompleted ? ' iab-pill--completed' : ''}`}
              style={!isCompleted ? { background: SEVERITY_COLOR[severity] || 'var(--error)' } : undefined}
              onClick={() => handlePillClick(report)}
            >
              {isCompleted
                ? <CheckCircle size={11} className="iab-pill__icon iab-pill__icon--done" />
                : <AlertTriangle size={11} className="iab-pill__icon" />
              }
              <span className="iab-pill__name">{report.event_title}</span>
              <span className="iab-pill__count">
                {isCompleted ? 'Resolved' : `${affected} clients`}
              </span>
              {!isCompleted && critical > 0 && (
                <span className="iab-pill__severity">{critical} critical</span>
              )}
            </div>
          );
        })}
      </div>

      <button className="iab-action" onClick={handleRefresh} disabled={refreshing} style={{ marginLeft: 'auto' }}>
        <RefreshCw size={11} className={refreshing ? 'iab-spin' : ''} />
        {refreshing ? 'Refreshing...' : 'Refresh'}
      </button>

    </div>
  );
};

export default ImpactAssessmentBar;
