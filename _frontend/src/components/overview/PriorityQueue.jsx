import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, GitBranch, RefreshCw, Zap, ZapOff } from 'lucide-react';
import Tooltip from '../Tooltip';
import { formatCurrency, formatPercent } from '../../utils/formatters';
import GraphModal from './GraphModal';
import { useMonitor } from '../../contexts/MonitorContext';
import './OverviewShared.css';
import './PriorityQueue.css';

const SkeletonItem = () => (
  <div className="ov-pq-item ov-pq-skel-item">
    <div className="ov-pq-skel ov-pq-skel--avatar" />
    <div className="ov-pq-item__body">
      <div className="ov-pq-item__row1">
        <div className="ov-pq-skel ov-pq-skel--name" />
        <div className="ov-pq-skel ov-pq-skel--pill" />
      </div>
      <div className="ov-pq-skel ov-pq-skel--reason" />
      <div className="ov-pq-skel ov-pq-skel--meta" />
    </div>
  </div>
);

const SkeletonDetail = () => (
  <div className="ov-pq-detail">
    <div className="ov-pq-detail__header">
      <div className="ov-pq-detail__header-info">
        <div className="ov-pq-skel ov-pq-skel--detail-name" />
        <div className="ov-pq-skel ov-pq-skel--detail-meta" />
      </div>
      <div className="ov-pq-skel ov-pq-skel--status" />
    </div>
    <div className="ov-pq-detail__body">
      <div className="ov-pq-metrics">
        {[0,1,2,3].map(i => (
          <div key={i} className="ov-pq-metric">
            <div className="ov-pq-skel ov-pq-skel--metric-label" />
            <div className="ov-pq-skel ov-pq-skel--metric-val" />
          </div>
        ))}
      </div>
      <div className="ov-pq-section">
        <div className="ov-pq-skel ov-pq-skel--section-label" />
        <div className="ov-pq-skel ov-pq-skel--text-line" />
        <div className="ov-pq-skel ov-pq-skel--text-line ov-pq-skel--text-line-short" />
      </div>
      <div className="ov-pq-section">
        <div className="ov-pq-skel ov-pq-skel--section-label" />
        {[0,1].map(i => <div key={i} className="ov-pq-skel ov-pq-skel--action-item" />)}
      </div>
    </div>
  </div>
);

const PriorityQueue = () => {
  const navigate = useNavigate();
  const { profiles, loading, isDemo, statusMsg, phase, doResync,
          marketSynced, syncingMarket, marketCleared, doSyncMarketEvents,
          clearingMarket, doClearMarketEvents } = useMonitor();
  const [selectedId, setSelectedId] = useState(null);
  const [graphModal, setGraphModal] = useState(null);

  const visibleProfiles = useMemo(
    () => profiles.filter(p => p.priority !== 'On Track'),
    [profiles]
  );

  const selectedProfile = useMemo(
    () => visibleProfiles.find(p => p.id === selectedId) ?? visibleProfiles[0] ?? null,
    [visibleProfiles, selectedId]
  );

  return (
    <>
      <div className="ov-card ov-pq-card">
        <div className="ov-pq-split">

          {/* ── Left panel ── */}
          <div className="ov-pq-left">
            <div className="ov-pq-left__head">
              <div className="ov-pq-left__titles">
                <span className="ov-pq-left__title">Client Priority Actions</span>
                <span className="ov-pq-left__sub">AI-ranked · live</span>
              </div>
              <div className="ov-pq-left__actions">
                <Tooltip content={loading ? 'Syncing...' : 'Re-sync'} placement="bottom">
                  <button
                    className="ov-morning-refresh"
                    onClick={doResync}
                    disabled={loading}
                    style={{ color: 'var(--tcs-blue)', opacity: loading ? 0.6 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}
                  >
                    <RefreshCw size={13} className={loading ? 'spin' : ''} />
                  </button>
                </Tooltip>
                {marketCleared && !marketSynced && (
                  <Tooltip content={syncingMarket ? 'Syncing market events...' : 'Re-sync market events'} placement="bottom">
                    <button
                      className="ov-morning-refresh"
                      onClick={doSyncMarketEvents}
                      disabled={syncingMarket}
                      style={{ color: '#f97316', opacity: syncingMarket ? 0.6 : 1, cursor: syncingMarket ? 'not-allowed' : 'pointer' }}
                    >
                      <Zap size={13} className={syncingMarket ? 'spin' : ''} />
                    </button>
                  </Tooltip>
                )}
                {marketSynced && (
                  <Tooltip content={clearingMarket ? 'Clearing...' : 'Remove market event impact'} placement="bottom">
                    <button
                      className="ov-morning-refresh"
                      onClick={doClearMarketEvents}
                      disabled={clearingMarket}
                      style={{
                        color: '#94a3b8',
                        opacity: clearingMarket ? 0.6 : 1,
                        cursor: clearingMarket ? 'not-allowed' : 'pointer',
                      }}
                    >
                      <ZapOff size={13} className={clearingMarket ? 'spin' : ''} />
                    </button>
                  </Tooltip>
                )}
                <button className="ov-view-all" onClick={() => navigate('/worklist/rebalancing')}>View all</button>
              </div>
            </div>

            <div className="ov-pq-list">
              {loading && visibleProfiles.length === 0 && (
                [0,1,2,3].map(i => <SkeletonItem key={i} />)
              )}
              {!loading && visibleProfiles.length === 0 && (
                <div style={{ padding: '20px 14px', color: 'var(--text-tertiary)', fontSize: '0.75rem', textAlign: 'center' }}>
                  Sync to load priority board
                </div>
              )}
              {visibleProfiles.map(p => (
                <div
                  key={p.id}
                  className={`ov-pq-item${selectedProfile?.id === p.id ? ' ov-pq-item--active' : ''}${p.priority === 'Critical' ? ' ov-pq-item--critical' : p.priority === 'High' ? ' ov-pq-item--high' : ''}`}
                  onClick={() => setSelectedId(p.id)}
                >
                  <div className="ov-pq-item__avatar">
                    {p.name.split(' ').map(n => n[0]).join('')}
                  </div>
                  <div className="ov-pq-item__body">
                    <div className="ov-pq-item__row1">
                      <span className="ov-pq-item__name">{p.name}</span>
                      <span className={`ov-pq-item__pill ov-pq-item__pill--${p.priority.toLowerCase().replace(' ', '-')}`}>{p.priority}</span>
                    </div>
                    <span className="ov-pq-item__reason">{p.rebalanceReason}</span>
                    <span className="ov-pq-item__meta">
                      {p.aum != null ? formatCurrency(p.aum, true) : '—'}
                      {p.ret != null && <> · <span className="ov-pq-item__ret">{formatPercent(p.ret * 100)}</span></>}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Right detail pane ── */}
          {selectedProfile && (
            <div className="ov-pq-detail">
              <div className={`ov-pq-detail__header${selectedProfile.priority === 'Critical' ? ' ov-pq-detail__header--critical' : selectedProfile.priority === 'High' ? ' ov-pq-detail__header--high' : ''}`}>
                <div className="ov-pq-detail__header-info">
                  <span
                    className="ov-pq-detail__name"
                    style={{ cursor: 'pointer', textDecoration: 'underline dotted', textUnderlineOffset: 3 }}
                    onClick={() => setGraphModal({ clientId: selectedProfile.id, clientName: selectedProfile.name })}
                    title="View knowledge graph"
                  >
                    {selectedProfile.name}
                  </span>
                  <span className="ov-pq-detail__meta">
                    {selectedProfile.profession && <>{selectedProfile.profession} · </>}
                    {selectedProfile.age && <>Age {selectedProfile.age} · </>}
                    #{selectedProfile.id}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Tooltip content="View graph" placement="bottom">
                    <button
                      className="ov-morning-refresh"
                      onClick={() => setGraphModal({ clientId: selectedProfile.id, clientName: selectedProfile.name })}
                    >
                      <GitBranch size={12} />
                    </button>
                  </Tooltip>
                  <span className={`ov-pq-detail__status${selectedProfile.priority === 'Critical' ? ' ov-pq-detail__status--critical' : selectedProfile.priority === 'High' ? ' ov-pq-detail__status--high' : ''}`}>
                    {selectedProfile.priority}
                  </span>
                </div>
              </div>

              <div className="ov-pq-detail__body">
                <div className="ov-pq-metrics">
                  {[
                    ['AUM',    selectedProfile.aum != null ? formatCurrency(selectedProfile.aum, true) : '—', false],
                    ['Return', selectedProfile.ret != null ? formatPercent(selectedProfile.ret * 100) : '—', true],
                    ['Risk',   selectedProfile.riskLabel ?? '—', false],
                    ['Credit', selectedProfile.creditScore ?? '—', false],
                  ].map(([label, val, green]) => (
                    <div key={label} className="ov-pq-metric">
                      <span className="ov-pq-metric__label">{label}</span>
                      <span className={`ov-pq-metric__val${green ? ' ov-pq-metric__val--green' : ''}`}>{val}</span>
                    </div>
                  ))}
                </div>

                <div className="ov-pq-section">
                  <span className="ov-pq-section__label">Why prioritised</span>
                  <p className="ov-pq-section__text">
                    {selectedProfile.whyPrioritised
                      ?? (selectedProfile.openRisks?.length
                          ? `This client has been flagged for ${selectedProfile.openRisks.join(', ').replace(/_/g, ' ')}.`
                          : 'This client requires attention based on current portfolio analysis.')}
                  </p>
                </div>

                <div className="ov-pq-section">
                  <span className="ov-pq-section__label">Recommended Actions</span>
                  <div className="ov-pq-actions-list">
                    {selectedProfile.actions.map((a, i) => {
                      const mod = a.label.toLowerCase().includes('call') ? 'call'
                        : a.label.toLowerCase().includes('rebalanc') ? 'rebal'
                        : a.label.toLowerCase().includes('kyc') ? 'kyc'
                        : a.label.toLowerCase().includes('goal') ? 'goal'
                        : a.label.toLowerCase().includes('check') ? 'checkin'
                        : 'rebal';
                      return (
                        <div key={i} className={`ov-pq-action-item ov-pq-action-item--${mod}`}>
                          {a.label}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {selectedProfile.actions.some(a => a.label === 'Rebalance to IPS') && (
                  <div className="ov-pq-section">
                    <span className="ov-pq-section__label">AI Assisted Actions</span>
                    <button
                      className="ov-pq-action ov-pq-action--primary"
                      onClick={() => {
                        const a = selectedProfile.actions.find(a => a.label === 'Rebalance to IPS');
                        navigate(a?.route ?? `/client/${selectedProfile.id}/rebalancing`, { state: { runPreflight: true } });
                      }}
                    >
                      Rebalance to IPS <ArrowRight size={12} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Skeleton detail when loading */}
          {loading && visibleProfiles.length === 0 && <SkeletonDetail />}

          {/* Empty state when no profile selected and not loading */}
          {!loading && !selectedProfile && (
            <div className="ov-pq-detail" style={{ alignItems: 'center', justifyContent: 'center', display: 'flex' }}>
              <span style={{ color: 'var(--text-tertiary)', fontSize: '0.8125rem' }}>
                Sync to see priority clients
              </span>
            </div>
          )}

        </div>
      </div>

      {graphModal && (
        <GraphModal
          clientId={graphModal.clientId}
          clientName={graphModal.clientName}
          isDemo={isDemo}
          onClose={() => setGraphModal(null)}
        />
      )}
    </>
  );
};

export default PriorityQueue;
