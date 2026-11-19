import { useNavigate } from 'react-router-dom';
import { ExternalLink, AlertTriangle, Rocket, MessageSquare, Shield } from 'lucide-react';
import './MeetingPrepChatSummary.css';

const MeetingPrepChatSummary = ({ meeting, meetingId }) => {
  const navigate = useNavigate();
  if (!meeting) return null;

  const c       = meeting.client       || {};
  // Navigate to /meeting-prep/{clientId} (static route) — not live- prefix
  const navTarget = c.clientId || c.customerId || meetingId;
  const risk    = meeting.risk         || {};
  const actions = meeting.nextBestActions || [];
  const angles  = meeting.discussionAngles || [];
  const topSignal = risk.skillSections?.find(s => s.signals?.length > 0)?.signals?.[0];
  const topAction = actions[0];
  const topAngle  = angles[0];

  return (
    <div className="mpc-root">
      {/* Header */}
      <div className="mpc-header">
        <div className="mpc-header-left">
          <span className="mpc-label">MEETING BRIEF</span>
          <span className="mpc-name">{c.name || 'Client'}</span>
          <div className="mpc-meta">
            {c.tier && <span className="mpc-pill"><Shield size={10} />{c.tier}</span>}
            {c.aum  && <span className="mpc-pill">{typeof c.aum === 'number' ? `$${c.aum.toLocaleString()}` : c.aum} AUM</span>}
            {c.sentiment && <span className="mpc-pill mpc-pill--warn">{c.sentiment}</span>}
          </div>
        </div>
        <button className="mpc-open-btn" onClick={() => navigate(`/meeting-prep/${navTarget}`)}>
          <ExternalLink size={12} /> View Full Brief
        </button>
      </div>

      {/* KPIs */}
      <div className="mpc-kpis">
        {c.meetingGoal && (
          <div className="mpc-kpi">
            <span>{c.meetingGoal}</span>
            <span>Meeting Goal</span>
          </div>
        )}
        {risk.skillSections?.some(s => s.signals?.length > 0) && (
          <div className="mpc-kpi mpc-kpi--warn">
            <span>{(risk.skillSections || []).reduce((n, s) => n + (s.signals?.length || 0), 0)}</span>
            <span>Signals</span>
          </div>
        )}
        {actions.length > 0 && (
          <div className="mpc-kpi mpc-kpi--accent">
            <span>{actions.length}</span>
            <span>Actions</span>
          </div>
        )}
      </div>

      {/* Profile intro */}
      {c.profileIntro && (
        <div className="mpc-intro">{c.profileIntro}</div>
      )}

      {/* Top signal */}
      {topSignal && (
        <div className="mpc-row">
          <AlertTriangle size={12} className="mpc-row-icon mpc-row-icon--warn" />
          <div className="mpc-row-body">
            <span className="mpc-row-label">{topSignal.signal_type?.replace(/_/g, ' ')}</span>
            <span className={`mpc-badge mpc-badge--${topSignal.assessment?.materiality}`}>{topSignal.assessment?.materiality}</span>
            <span className="mpc-row-detail">{topSignal.observation?.summary}</span>
          </div>
        </div>
      )}

      {/* Top action */}
      {topAction && (
        <div className="mpc-row">
          <Rocket size={12} className="mpc-row-icon mpc-row-icon--accent" />
          <div className="mpc-row-body">
            <span className="mpc-row-label">{topAction.label}</span>
            <span className="mpc-row-detail">{topAction.desc}</span>
          </div>
        </div>
      )}

      {/* Top discussion angle */}
      {topAngle && (
        <div className="mpc-row">
          <MessageSquare size={12} className="mpc-row-icon" />
          <div className="mpc-row-body">
            <span className="mpc-row-label">{topAngle.title}</span>
            <span className="mpc-row-detail">{topAngle.desc}</span>
          </div>
        </div>
      )}

      <button className="mpc-open-btn mpc-open-btn--footer" onClick={() => navigate(`/meeting-prep/${navTarget}`)}>
        <ExternalLink size={12} /> View Full Brief →
      </button>
    </div>
  );
};

export default MeetingPrepChatSummary;
