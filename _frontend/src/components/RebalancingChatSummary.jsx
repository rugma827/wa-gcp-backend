import { useNavigate } from 'react-router-dom';
import { ArrowRightLeft, ExternalLink } from 'lucide-react';
import './RebalancingChatResult.css';

const Badge = ({ action }) => (
  <span className={`pr-action-badge pr-action-badge--${action?.toLowerCase()}`}>{action}</span>
);

const RebalancingChatSummary = ({ data, clientId, clientName }) => {
  const navigate = useNavigate();
  if (!data) return null;

  // Prefer option_a for summary (always has real totals); fall back to option_b
  const optionA = data.options?.option_a;
  const optionB = data.options?.option_b;
  const option = (optionA?.trade_recommendations?.length > 0) ? optionA : (optionB || optionA);
  const trades = (option?.trade_recommendations || []).slice(0, 3);
  const totals = option?.trade_totals || {};

  return (
    <div className="rcr-root">
      {/* Header */}
      <div className="rcr-header">
        <div className="rcr-header-left">
          <span className="rcr-client-name">{clientName}</span>
          <span className="rcr-reco-title">
            {data.final_recommendation?.title || 'Rebalancing Analysis'}
          </span>
        </div>
        <button
          className="rcr-open-btn"
          onClick={() => navigate(`/client/${clientId}/rebalancing`, { state: { skipFetch: true } })}
        >
          <ExternalLink size={12} />
          View Full Report
        </button>
      </div>

      {/* KPIs */}
      <div className="rcr-kpis">
        <div className="rcr-kpi">
          <span>{data.rebalance_summary?.length || 0}</span>
          <span>Positions</span>
        </div>
        <div className="rcr-kpi rcr-kpi--sell">
          <span>${(totals.total_sells || 0).toLocaleString()}</span>
          <span>Total Sells</span>
        </div>
        <div className="rcr-kpi rcr-kpi--buy">
          <span>${(totals.total_buys || 0).toLocaleString()}</span>
          <span>Total Buys</span>
        </div>
      </div>

      {/* Recommendation summary */}
      {data.final_recommendation?.reasons?.[0] && (
        <div className="rcr-reasons">
          <p>{data.final_recommendation.reasons[0]}</p>
        </div>
      )}

      {/* Top 3 trades */}
      {trades.length > 0 && (
        <div className="rcr-table-wrap">
          <table className="rcr-table">
            <thead>
              <tr>
                <th>Action</th><th>Ticker</th><th>Fund</th><th>Amount</th>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer link */}
      <button
        className="rcr-open-btn"
        style={{ alignSelf: 'flex-start', marginTop: 2 }}
        onClick={() => navigate(`/client/${clientId}/rebalancing`, { state: { skipFetch: true } })}
      >
        <ArrowRightLeft size={12} />
        Open full rebalancing report →
      </button>
    </div>
  );
};

export default RebalancingChatSummary;
