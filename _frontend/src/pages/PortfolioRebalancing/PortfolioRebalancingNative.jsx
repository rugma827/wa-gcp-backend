import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { ArrowRightLeft, BarChart3, CheckCircle, TrendingUp, ChevronDown, ChevronUp, Loader } from 'lucide-react';
import { motion } from 'framer-motion';
import clientDataService from '../../services/clientDataService';
import { getApiUrl } from '../../config/api';
import { getCognitoToken, getSessionId } from '../../utils/authCookies';
import './PortfolioRebalancingNative.css';
import '../ClientDetail.css';

// ── Auth headers ──────────────────────────────────────────────────────────────
function _authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  const token = getCognitoToken();
  if (token) h['Authorization'] = `Bearer ${token}`;
  const sid = getSessionId();
  if (sid) h['X-Session-ID'] = sid;
  return h;
}

// ── Phase panels ──────────────────────────────────────────────────────────────

const GatePanel = () => (
  <div className="pr-gate-panel">
    <Loader size={22} className="pr-gate-spin" />
    <p className="pr-gate-title">Running pre-flight assessment…</p>
    <p className="pr-gate-sub">Checking drift, risk, sentiment and compliance</p>
  </div>
);

const NoRebalancePanel = ({ verdict, justification, onDismiss }) => (
  <div className="pr-no-rebalance-panel">
    <div className="pr-no-rebalance-icon">✓</div>
    <h3 className="pr-no-rebalance-title">No rebalance needed</h3>
    {verdict && <p className="pr-no-rebalance-verdict">{verdict}</p>}
    {justification && <p className="pr-no-rebalance-justification">{justification}</p>}
    {onDismiss && (
      <button className="pr-no-rebalance-dismiss" onClick={onDismiss}>Dismiss</button>
    )}
  </div>
);

const ConfirmPanel = ({ verdict, justification, onProceed, onCancel }) => (
  <div className="pr-confirm-panel">
    <h3 className="pr-confirm-title">Rebalance signals detected</h3>
    {verdict && <p className="pr-confirm-verdict">{verdict}</p>}
    {justification && <p className="pr-confirm-justification">{justification}</p>}
    <div className="pr-confirm-actions">
      <button className="pr-confirm-yes" onClick={onProceed}>Yes, proceed</button>
      <button className="pr-confirm-no" onClick={onCancel}>No, cancel</button>
    </div>
  </div>
);

const RunningPanel = ({ pct, message, verdict }) => (
  <div className="pr-running-panel">
    {verdict && <p className="pr-running-verdict">{verdict}</p>}
    <div className="pr-running-header">
      <Loader size={16} className="pr-gate-spin" />
      <span>{message || 'Running rebalance analysis…'}</span>
      {pct > 0 && <span className="pr-running-pct">{pct}%</span>}
    </div>
    {pct > 0 && (
      <div className="pr-running-track">
        <div className="pr-running-fill" style={{ width: `${pct}%` }} />
      </div>
    )}
  </div>
);

// ── Main component ────────────────────────────────────────────────────────────

const PortfolioRebalancingNative = () => {
  const { clientId } = useParams();
  const location = useLocation();

  // If navigated from "View Full Report" in assist chat, result data is in location state
  const preloadedData = location.state?.rebalancingData ?? null;

  // phase: "gate" | "no_rebalance" | "confirm" | "running" | "result" | "error"
  const [phase, setPhase] = useState(preloadedData ? 'result' : 'gate');
  const [assessment, setAssessment] = useState(null);
  const [progress, setProgress] = useState({ pct: 0, message: 'Starting…' });
  const [data, setData] = useState(
    preloadedData ? { rebalancing: preloadedData, investment: null } : null
  );
  const [error, setError] = useState(null);

  // If preloaded, fetch investment details in background for the holdings table
  useEffect(() => {
    if (!preloadedData) return;
    clientDataService.getInvestmentDetails(clientId)
      .then(inv => setData(prev => ({ ...prev, investment: inv?.data || inv })))
      .catch(() => {});
  }, [clientId, preloadedData]);

  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
  const [activeOption, setActiveOption] = useState('option_b');
  const [expandedSections, setExpandedSections] = useState({
    section1: true, sectionRebalSummary: true,
    section2: false, section3: false, section4: false, sectionPostTrade: false,
  });
  const [expandedTickers, setExpandedTickers] = useState({});

  // ── SSE subscription ────────────────────────────────────────────────────
  const _sseCtrlRef = useRef(null);
  useEffect(() => () => _sseCtrlRef.current?.abort(), []);

  const _subscribeSSE = useCallback((taskId, verdict) => {
    _sseCtrlRef.current?.abort();
    const url = getApiUrl(`/assist/progress/${taskId}`);
    const ctrl = new AbortController();
    _sseCtrlRef.current = ctrl;
    setPhase('running');
    setProgress({ pct: 5, message: 'Starting rebalance analysis…', verdict });

    fetch(url, { headers: _authHeaders(), signal: ctrl.signal })
      .then(async (res) => {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split('\n\n');
          buf = parts.pop();
          for (const part of parts) {
            const line = part.replace(/^data: /, '').trim();
            if (!line) continue;
            try {
              const ev = JSON.parse(line);
              if (ev.type === 'result') {
                const r = ev.result;
                if (r?.type === 'rebalance' && r.data) {
                  // Fetch investment details then set both atomically before showing result
                  clientDataService.getInvestmentDetails(clientId)
                    .then(inv => setData({ rebalancing: r.data, investment: inv?.data || inv }))
                    .catch(() => setData({ rebalancing: r.data, investment: null }))
                    .finally(() => setPhase('result'));
                } else if (r?.type === 'error') {
                  setError(r.message);
                  setPhase('error');
                }
                ctrl.abort();
                return;
              }
              if (ev.pct !== undefined) {
                setProgress(prev => ({
                  ...prev,
                  pct: Math.max(prev.pct || 0, ev.pct),
                  message: ev.message,
                }));
              }
            } catch { /* ignore */ }
          }
        }
      })
      .catch(() => {});

    return ctrl;
  }, [clientId]);

  // ── Fire full run ───────────────────────────────────────────────────────
  const _fireFullRun = useCallback(async (clientName, verdict) => {
    try {
      const res = await fetch(getApiUrl('/assist/rebalance/confirm'), {
        method: 'POST',
        headers: _authHeaders(),
        body: JSON.stringify({ client_id: clientId, client_name: clientName || clientId }),
      });
      const json = await res.json();
      const r = json?.result || {};
      if (r.type === 'rebalance_pending') {
        _subscribeSSE(r.task_id, verdict);
      } else {
        setError('Failed to start rebalance run.');
        setPhase('error');
      }
    } catch (e) {
      setError('Connection error. Please try again.');
      setPhase('error');
    }
  }, [clientId, _subscribeSSE]);

  // ── Gate: run pre-flight on mount (skip if result already preloaded) ────
  useEffect(() => {
    if (preloadedData) return;  // already have result — skip gate
    let cancelled = false;
    const runGate = async () => {
      try {
        const res = await fetch(getApiUrl(`/rebalance/api/client/${clientId}/assess`), {
          method: 'POST',
          headers: _authHeaders(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const result = await res.json();
        if (cancelled) return;
        setAssessment(result);

        const band = result.band;
        if (band === 'no_rebalance') {
          setPhase('no_rebalance');
        } else if (band === 'ask_user') {
          setPhase('confirm');
        } else {
          // proceed or ips_breach — auto-fire
          _fireFullRun(result.client_name, result.verdict);
        }
      } catch (e) {
        if (!cancelled) { setError(e.message); setPhase('error'); }
      }
    };
    runGate();
    return () => { cancelled = true; };
  }, [clientId]);

  // ── Helpers ─────────────────────────────────────────────────────────────
  const toggleSection = (s) => setExpandedSections(prev => ({ ...prev, [s]: !prev[s] }));
  const handleSort = (key) => setSortConfig({ key, direction: sortConfig.key === key && sortConfig.direction === 'asc' ? 'desc' : 'asc' });

  const sortedHoldings = [...(data?.investment?.current_holdings || [])].sort((a, b) => {
    if (!sortConfig.key) return 0;
    return sortConfig.direction === 'asc'
      ? (a[sortConfig.key] > b[sortConfig.key] ? 1 : -1)
      : (a[sortConfig.key] < b[sortConfig.key] ? 1 : -1);
  });

  // ── Pre-result phases ────────────────────────────────────────────────────
  if (phase === 'gate') return <div className="pr-page"><GatePanel /></div>;

  if (phase === 'no_rebalance') return (
    <div className="pr-page">
      <NoRebalancePanel
        verdict={assessment?.verdict}
        justification={assessment?.justification}
      />
    </div>
  );

  if (phase === 'confirm') return (
    <div className="pr-page">
      <ConfirmPanel
        verdict={assessment?.verdict}
        justification={assessment?.justification}
        onProceed={() => _fireFullRun(assessment?.client_name, assessment?.verdict)}
        onCancel={() => setPhase('no_rebalance')}
      />
    </div>
  );

  if (phase === 'running') return (
    <div className="pr-page">
      <RunningPanel pct={progress.pct} message={progress.message} verdict={progress.verdict} />
    </div>
  );

  if (phase === 'error') return (
    <div className="pr-page">
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--error)' }}>
        {error || 'Something went wrong. Please try again.'}
      </div>
    </div>
  );

  // ── Result phase — existing render (unchanged) ───────────────────────────
  if (!data || !data.rebalancing) return (
    <div className="pr-page">
      <div className="client-detail-loading">
        <div className="client-detail-loading-spinner" />
        <p className="client-detail-loading-text">Loading result…</p>
      </div>
    </div>
  );

  const reco = data.rebalancing;

  return (
    <div className="pr-page">
      <div className="pr-header" />
      <div className="pr-content">

        {/* Recommended Option Summary */}
        {reco && (
          <div className="pr-reco-banner">
            <div className="pr-reco-banner-top">
              <div>
                <span className="pr-reco-label">Recommended Option</span>
                <h2 className="pr-reco-name">{reco.final_recommendation?.title || 'Rebalancing Recommendation'}</h2>
              </div>
              <div className="pr-reco-kpis-inline">
                <div className="pr-reco-kpi-mini"><span>{reco.rebalance_summary?.length || 0}</span><span>Positions</span></div>
                <div className="pr-reco-kpi-mini"><span>{reco.options?.option_a?.trade_recommendations?.length || 0}</span><span>Trades</span></div>
                <div className="pr-reco-kpi-mini pr-reco-kpi-mini--highlight"><span>{reco.cost_analysis?.current_weighted_er || 'N/A'}</span><span>Expense Ratio</span></div>
              </div>
            </div>
            <div className="pr-reco-desc">
              {reco.final_recommendation?.reasons?.map((reason, i) => <p key={i}>{reason}</p>)}
            </div>
            <div className="pr-reco-tags">
              <span className="pr-reco-tag">IPS Compliant</span>
              <span className="pr-reco-tag">Tax Aware</span>
              <span className="pr-reco-tag pr-reco-tag--warn">Approval Required</span>
            </div>
          </div>
        )}

        {/* Section 1: Current Holdings */}
        <motion.section className="pr-section" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <div className="pr-section-header" onClick={() => toggleSection('section1')}>
            <TrendingUp size={22} />
            <h2>Current Holdings</h2>
            {expandedSections.section1 ? <ChevronUp size={20} className="pr-chevron-icon" /> : <ChevronDown size={20} className="pr-chevron-icon" />}
          </div>
          {expandedSections.section1 && (
            <div className="pr-table-container">
              <table className="pr-table">
                <thead>
                  <tr>
                    <th onClick={() => handleSort('ticker')}>Ticker {sortConfig.key === 'ticker' && (sortConfig.direction === 'asc' ? '▲' : '▼')}</th>
                    <th onClick={() => handleSort('name')}>Name {sortConfig.key === 'name' && (sortConfig.direction === 'asc' ? '▲' : '▼')}</th>
                    <th onClick={() => handleSort('current_price')}>Price</th>
                    <th onClick={() => handleSort('total_return_pct')}>Total Return</th>
                    <th onClick={() => handleSort('volatility_pct')}>Volatility</th>
                    <th onClick={() => handleSort('max_drawdown_pct')}>Max Drawdown</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedHoldings.map((h) => (
                    <motion.tr key={h.ticker} initial={{ opacity: 0 }} animate={{ opacity: 1 }} whileHover={{ backgroundColor: 'var(--glass-bg)' }}>
                      <td className="ticker-cell">{h.ticker}</td>
                      <td>{h.name}</td>
                      <td className="price-cell">${h.current_price?.toFixed(2)}</td>
                      <td className={`return-cell ${h.total_return_pct > 0 ? 'positive' : 'negative'}`}>
                        {h.total_return_pct > 0 ? '+' : ''}{h.total_return_pct?.toFixed(2)}%
                      </td>
                      <td className="volatility-cell">{h.volatility_pct}%</td>
                      <td className={`drawdown-cell ${parseFloat(h.max_drawdown_pct) < 0 ? 'negative' : 'positive'}`}>{h.max_drawdown_pct}%</td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </motion.section>

        {/* Section: Rebalance Summary */}
        {reco && (
          <motion.section className="pr-section" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.05 }}>
            <div className="pr-section-header" onClick={() => toggleSection('sectionRebalSummary')}>
              <BarChart3 size={22} />
              <h2>Rebalance Summary</h2>
              {expandedSections.sectionRebalSummary ? <ChevronUp size={20} className="pr-chevron-icon" /> : <ChevronDown size={20} className="pr-chevron-icon" />}
            </div>
            {expandedSections.sectionRebalSummary && (
              <div className="pr-table-container">
                <table className="pr-table">
                  <thead>
                    <tr><th>Asset Class</th><th>Ticker</th><th>Before</th><th>Target</th><th>After</th><th>Change</th><th>Trade Value</th><th>Direction</th></tr>
                  </thead>
                  <tbody>
                    {(reco.rebalance_summary || []).map((row, i) => (
                      <motion.tr key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                        className={row.direction === 'Sell' ? 'pr-trade-row--sell' : row.direction === 'Buy' ? 'pr-trade-row--buy' : 'pr-trade-row--hold'}>
                        <td>{row.asset_class}</td>
                        <td className="ticker-cell">{row.ticker}</td>
                        <td>{row.before}</td><td>{row.target}</td><td>{row.after}</td>
                        <td className={row.change.startsWith('+') ? 'positive' : row.change.startsWith('-') ? 'negative' : ''}>{row.change}</td>
                        <td>{row.trade_value}</td>
                        <td><span className={`pr-action-badge pr-action-badge--${row.direction.toLowerCase()}`}>{row.direction}</span></td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </motion.section>
        )}

        {/* Section: Trade Recommendations */}
        {reco && (
          <motion.section className="pr-section" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.1 }}>
            <div className="pr-section-header" onClick={() => toggleSection('section4')}>
              <ArrowRightLeft size={22} />
              <h2>Trade Recommendations</h2>
              {expandedSections.section4 ? <ChevronUp size={20} className="pr-chevron-icon" /> : <ChevronDown size={20} className="pr-chevron-icon" />}
            </div>
            {expandedSections.section4 && (
              <div className="pr-trade-content">
                <div className="pr-option-tabs">
                  <button className={`pr-option-tab ${activeOption === 'option_a' ? 'active' : ''}`} onClick={() => setActiveOption('option_a')}>
                    Option A: {reco.options?.option_a?.name || 'Rebalance to IPS Targets'}
                  </button>
                  <button className={`pr-option-tab ${activeOption === 'option_b' ? 'active' : ''}`} onClick={() => setActiveOption('option_b')}>
                    Option B: {reco.options?.option_b?.name || 'Optimized Universe'}
                    {reco.options?.option_b?.recommended && <span className="pr-recommended-badge">Recommended</span>}
                  </button>
                </div>
                <div className="pr-narrative-block">
                  <p>{reco.options?.[activeOption]?.description || 'No description available'}</p>
                </div>
                <div className="pr-trade-kpis">
                  <div className="pr-trade-kpi pr-trade-kpi--sell"><span className="pr-trade-kpi-label">Total Sells</span><span className="pr-trade-kpi-value">${(reco.options?.[activeOption]?.trade_totals?.total_sells || 0).toLocaleString()}</span></div>
                  <div className="pr-trade-kpi pr-trade-kpi--buy"><span className="pr-trade-kpi-label">Total Buys</span><span className="pr-trade-kpi-value">${(reco.options?.[activeOption]?.trade_totals?.total_buys || 0).toLocaleString()}</span></div>
                  <div className="pr-trade-kpi pr-trade-kpi--net"><span className="pr-trade-kpi-label">Net Value</span><span className="pr-trade-kpi-value">${(reco.options?.[activeOption]?.trade_totals?.net_value || 0).toLocaleString()}</span></div>
                </div>
                <div className="pr-table-container">
                  <table className="pr-table">
                    <thead><tr><th>Action</th><th>Ticker</th><th>Fund</th><th>Type</th><th>Units</th><th>Amount</th><th>Est. Gain</th><th>Best Lot</th></tr></thead>
                    <tbody>
                      {(reco.options?.[activeOption]?.trade_recommendations || []).map((t, i) => (
                        <tr key={i} className={`pr-trade-row--${t.action.toLowerCase()}`}>
                          <td><span className={`pr-action-badge pr-action-badge--${t.action.toLowerCase()}`}>{t.action}</span></td>
                          <td className="ticker-cell">{t.ticker}</td>
                          <td>{t.fund}</td><td>{t.type}</td><td>{t.units}</td>
                          <td className={`pr-amount-cell ${t.amount > 0 ? 'positive' : t.amount < 0 ? 'negative' : ''}`}>
                            {t.amount !== 0 ? `${t.amount > 0 ? '+' : ''}$${Math.abs(t.amount).toLocaleString()}` : '—'}
                          </td>
                          <td className={t.gain > 0 ? 'positive' : ''}>{t.gain > 0 ? `+$${t.gain.toLocaleString()}` : t.gain < 0 ? `-$${Math.abs(t.gain).toLocaleString()}` : '—'}</td>
                          <td>{t.best_lot || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="pr-narrative-block"><h4>Trade Rationale</h4><p>{reco.trade_rationale || 'No rationale available'}</p></div>
                <div className="pr-two-col">
                  <div className="pr-narrative-block">
                    <h4>Tax Efficiency</h4>
                    <div className="pr-detail-stats">
                      <div className="pr-detail-row"><span>Realized Gains</span><span className="positive">+${(reco.tax_efficiency?.estimated_realized_gains || 0).toLocaleString()}</span></div>
                      <div className="pr-detail-row"><span>Long-Term Gains</span><span>${(reco.tax_efficiency?.long_term_gains || 0).toLocaleString()}</span></div>
                      <div className="pr-detail-row"><span>Tax Rate</span><span>{reco.tax_efficiency?.tax_rate_applied || '20%'}</span></div>
                      <div className="pr-detail-row"><span>Est. Tax Liability</span><span className="negative">${(reco.tax_efficiency?.estimated_tax_liability || 0).toLocaleString()}</span></div>
                    </div>
                    <p className="pr-detail-note">{reco.tax_efficiency?.note || ''}</p>
                    <div className="pr-tax-callout"><span className="pr-tax-callout-label">Est. Tax Liability</span><span className="pr-tax-callout-value">${(reco.tax_efficiency?.estimated_tax_liability || 0).toLocaleString()}</span></div>
                  </div>
                  <div className="pr-narrative-block">
                    <h4>Cost Analysis</h4>
                    <div className="pr-detail-stats">
                      <div className="pr-detail-row"><span>Current Weighted ER</span><span>{reco.cost_analysis?.current_weighted_er || 'N/A'}</span></div>
                      <div className="pr-detail-row"><span>Post-Rebalance ER</span><span className="positive">{reco.cost_analysis?.post_rebalance_er || 'N/A'}</span></div>
                      <div className="pr-detail-row"><span>Annual Savings</span><span className="positive">{reco.cost_analysis?.annual_savings || '$0'}</span></div>
                    </div>
                    <p className="pr-detail-note">{reco.cost_analysis?.note || ''}</p>
                    <div className="pr-savings-callout"><span className="pr-savings-callout-label">Annual Savings</span><span className="pr-savings-callout-value">{reco.cost_analysis?.annual_savings || '$0'}</span></div>
                  </div>
                </div>
                {reco.final_recommendation && (
                  <div className="pr-final-reco">
                    <h4>✅ Final Recommendation: {reco.final_recommendation.option} — {reco.final_recommendation.title}</h4>
                    <ul>{(reco.final_recommendation.reasons || []).map((r, i) => <li key={i}>{r}</li>)}</ul>
                  </div>
                )}
              </div>
            )}
          </motion.section>
        )}

        {/* Section: Post-Trade Impact */}
        {reco && (
          <motion.section className="pr-section" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.15 }}>
            <div className="pr-section-header" onClick={() => toggleSection('sectionPostTrade')}>
              <CheckCircle size={22} />
              <h2>Post-Trade Impact</h2>
              {expandedSections.sectionPostTrade ? <ChevronUp size={20} className="pr-chevron-icon" /> : <ChevronDown size={20} className="pr-chevron-icon" />}
            </div>
            {expandedSections.sectionPostTrade && (
              <div className="pr-trade-content">
                {reco.post_trade_checks?.length > 0 && (
                  <div className="pr-post-trade-checks">
                    <h4>Post-Trade Compliance Checks</h4>
                    <table className="pr-table">
                      <thead><tr><th>Check</th><th>Status</th><th>Result</th></tr></thead>
                      <tbody>
                        {reco.post_trade_checks.map((c, i) => (
                          <tr key={i}>
                            <td>{c.check}</td>
                            <td><span className={`pr-action-badge pr-action-badge--${c.status === 'PASS' ? 'hold' : 'breach'}`}>{c.status}</span></td>
                            <td>{c.result}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {reco.rebalance_summary?.length > 0 && (
                  <div className="pr-narrative-block">
                    <h4>Allocation Shift</h4>
                    <div className="pr-post-alloc-grid">
                      {(() => {
                        const byAsset = {};
                        reco.rebalance_summary.forEach(row => {
                          if (!byAsset[row.asset_class]) byAsset[row.asset_class] = { before: 0, after: 0, target: 0 };
                          byAsset[row.asset_class].before += parseFloat(row.before) || 0;
                          byAsset[row.asset_class].after  += parseFloat(row.after)  || 0;
                          byAsset[row.asset_class].target += parseFloat(row.target) || 0;
                        });
                        return Object.entries(byAsset).map(([cls, vals], i) => (
                          <div key={i} className="pr-post-alloc-row">
                            <span className="pr-post-alloc-label">{cls}</span>
                            <span className="pr-post-alloc-val negative">{vals.before.toFixed(1)}%</span>
                            <span className="pr-post-alloc-arrow">→</span>
                            <span className="pr-post-alloc-val positive">{vals.after.toFixed(1)}%</span>
                            <span className="pr-post-alloc-target">(target {vals.target.toFixed(1)}%)</span>
                          </div>
                        ));
                      })()}
                    </div>
                  </div>
                )}
                {reco.final_recommendation?.reasons?.length > 0 && (
                  <div className="pr-final-reco">
                    <h4>✅ Key Improvements</h4>
                    <ul>{reco.final_recommendation.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                  </div>
                )}
              </div>
            )}
          </motion.section>
        )}

      </div>
    </div>
  );
};

export default PortfolioRebalancingNative;
