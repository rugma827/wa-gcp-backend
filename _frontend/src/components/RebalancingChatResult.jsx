import { useState } from 'react';
import { ChevronDown, ChevronUp, ArrowRightLeft, BarChart3, CheckCircle, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import './RebalancingChatResult.css';

const Badge = ({ action }) => (
  <span className={`pr-action-badge pr-action-badge--${action?.toLowerCase()}`}>{action}</span>
);

const Section = ({ icon: Icon, title, accent, defaultOpen = true, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`rcr-section rcr-section--${accent}`}>
      <button className="rcr-section-header" onClick={() => setOpen(o => !o)}>
        <span className="rcr-section-title"><Icon size={13} />{title}</span>
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
      {open && <div className="rcr-section-body">{children}</div>}
    </div>
  );
};

const RebalancingChatResult = ({ data, clientId, clientName }) => {
  const navigate = useNavigate();
  const [activeOption, setActiveOption] = useState('option_b');

  if (!data) return null;

  const reco = data;
  const option = reco.options?.[activeOption];
  const trades = option?.trade_recommendations || [];

  return (
    <div className="rcr-root">
      {/* Header */}
      <div className="rcr-header">
        <div className="rcr-header-left">
          <span className="rcr-client-name">{clientName}</span>
          <span className="rcr-reco-title">{reco.final_recommendation?.title || 'Rebalancing Analysis'}</span>
        </div>
        <button
          className="rcr-open-btn"
          onClick={() => navigate(`/client/${clientId}/rebalancing`)}
          title="Open full view"
        >
          <ExternalLink size={13} />
          Full View
        </button>
      </div>

      {/* KPI row */}
      <div className="rcr-kpis">
        <div className="rcr-kpi">
          <span>{reco.rebalance_summary?.length || 0}</span>
          <span>Positions</span>
        </div>
        <div className="rcr-kpi rcr-kpi--sell">
          <span>${(option?.trade_totals?.total_sells || 0).toLocaleString()}</span>
          <span>Total Sells</span>
        </div>
        <div className="rcr-kpi rcr-kpi--buy">
          <span>${(option?.trade_totals?.total_buys || 0).toLocaleString()}</span>
          <span>Total Buys</span>
        </div>
        <div className="rcr-kpi rcr-kpi--highlight">
          <span>{reco.cost_analysis?.current_weighted_er || '—'}</span>
          <span>Exp. Ratio</span>
        </div>
      </div>

      {/* Recommendation reasons */}
      {reco.final_recommendation?.reasons?.length > 0 && (
        <div className="rcr-reasons">
          {reco.final_recommendation.reasons.map((r, i) => (
            <p key={i}>{r}</p>
          ))}
        </div>
      )}

      {/* Rebalance Summary */}
      {reco.rebalance_summary?.length > 0 && (
        <Section icon={BarChart3} title="Rebalance Summary" accent="summary" defaultOpen={true}>
          <div className="rcr-table-wrap">
            <table className="rcr-table">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Before</th>
                  <th>Target</th>
                  <th>After</th>
                  <th>Trade</th>
                  <th>Dir</th>
                </tr>
              </thead>
              <tbody>
                {reco.rebalance_summary.map((row, i) => (
                  <tr key={i} className={`pr-trade-row--${row.direction?.toLowerCase()}`}>
                    <td className="rcr-ticker">{row.ticker}</td>
                    <td>{row.before}</td>
                    <td>{row.target}</td>
                    <td>{row.after}</td>
                    <td>{row.trade_value}</td>
                    <td><Badge action={row.direction} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Trade Recommendations */}
      {(reco.options?.option_a || reco.options?.option_b) && (
        <Section icon={ArrowRightLeft} title="Trade Recommendations" accent="trades" defaultOpen={false}>
          {/* Option tabs */}
          <div className="rcr-tabs">
            {['option_a', 'option_b'].map(opt => (
              reco.options?.[opt] && (
                <button
                  key={opt}
                  className={`rcr-tab${activeOption === opt ? ' rcr-tab--active' : ''}`}
                  onClick={() => setActiveOption(opt)}
                >
                  {opt === 'option_a' ? 'Option A' : 'Option B'}
                  {reco.options[opt]?.recommended && (
                    <span className="pr-recommended-badge">Rec</span>
                  )}
                </button>
              )
            ))}
          </div>

          {trades.length > 0 && (
            <div className="rcr-table-wrap">
              <table className="rcr-table">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Ticker</th>
                    <th>Fund</th>
                    <th>Amount</th>
                    <th>Est. Gain</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t, i) => (
                    <tr key={i} className={`pr-trade-row--${t.action?.toLowerCase()}`}>
                      <td><Badge action={t.action} /></td>
                      <td className="rcr-ticker">{t.ticker}</td>
                      <td className="rcr-fund-name">{t.fund}</td>
                      <td className={t.amount > 0 ? 'positive' : t.amount < 0 ? 'negative' : ''}>
                        {t.amount !== 0 ? `$${Math.abs(t.amount).toLocaleString()}` : '—'}
                      </td>
                      <td className={t.gain > 0 ? 'positive' : ''}>
                        {t.gain > 0 ? `+$${t.gain.toLocaleString()}` : t.gain < 0 ? `-$${Math.abs(t.gain).toLocaleString()}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      {/* Post-trade checks */}
      {reco.post_trade_checks?.length > 0 && (
        <Section icon={CheckCircle} title="Post-Trade Checks" accent="checks" defaultOpen={false}>
          <div className="rcr-table-wrap">
            <table className="rcr-table">
              <thead>
                <tr><th>Check</th><th>Status</th><th>Result</th></tr>
              </thead>
              <tbody>
                {reco.post_trade_checks.map((c, i) => (
                  <tr key={i}>
                    <td>{c.check}</td>
                    <td><Badge action={c.status === 'PASS' ? 'hold' : 'breach'} /></td>
                    <td>{c.result}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Tags */}
      <div className="rcr-tags">
        <span className="pr-reco-tag">IPS Compliant</span>
        <span className="pr-reco-tag">Tax Aware</span>
        <span className="pr-reco-tag pr-reco-tag--warn">Approval Required</span>
      </div>
    </div>
  );
};

export default RebalancingChatResult;
