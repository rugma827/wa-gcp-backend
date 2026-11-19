import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Send, X, AlertTriangle, CheckCircle } from 'lucide-react';
import BackendChatInterface from '../BackendChatInterface';
import Spinner from '../Spinner';
import { activeMarketEvent, generateMailPreview } from '../../data/marketEventData';
import './MassMailerChat.css';

// ── Adapters ──────────────────────────────────────────────────────────────────

const adaptCIAReport = (report) => {
  if (!report || typeof report !== 'object' || !report.event_id) return null;
  const pi = report.portfolio_impact || {};
  return {
    id:          report.event_id,
    title:       report.event_title || 'Market Event',
    severity:    report.event_severity || 'HIGH',
    subtitle:    `${pi.clients_affected ?? 0} clients impacted, ${pi.critical ?? 0} critical`,
    description: report.summary || '',
    eventBrief:  report.summary || '',
    portfolioImpactExplanation: report.portfolio_impact_narrative || '',
    timestamp:   report.event_date ? `${report.event_date}T00:00:00Z` : new Date().toISOString(),
    impactSummary: {
      totalAffected:         pi.clients_affected ?? 0,
      criticalCount:         pi.critical ?? 0,
      highCount:             pi.high ?? 0,
      mediumCount:           pi.medium ?? 0,
      totalExposure:         pi.total_exposure_aum ?? 0,
      totalProjectedLoss:    Math.abs(pi.total_estimated_loss ?? 0),
      averageLossPercentage: Math.abs(pi.avg_loss_pct ?? 0).toFixed(1),
    },
    affectedClients: (report.clients || []).map(c => ({
      clientId:          c.client_id,
      clientName:        c.client_name,
      severity:          c.severity?.label || 'LOW',
      age:               c.age,
      riskProfile:       c.risk_profile,
      currentValue:      c.total_portfolio_value,
      projectedLoss:     Math.abs(c.scenarios?.moderate?.net_impact_usd ?? 0),
      lossPercentage:    Math.abs(c.scenarios?.moderate?.net_impact_pct ?? 0).toFixed(1),
      reason:            c.impact_narrative || '',
      recommendedAction: c.recommended_action || '',
      exposurePct:       c.exposure?.exposure_pct ?? 0,
      exposedDomains:    c.exposure?.exposed_domains || [],
      allocationDrift:   c.allocation?.drift || {},
      rebalancingNeeded: c.allocation?.rebalancing_needed || false,
      concentrationRisk: c.concentration?.concentration_risk || false,
      scenarios:         c.scenarios || {},
    })),
    emails: (report.emails || []).reduce((acc, e) => {
      acc[e.client_id] = { subject: e.subject, body: e.body };
      return acc;
    }, {}),
    _isCIA: true,
  };
};

const getEmailPreview = (client, event) => {
  if (event._isCIA && event.emails?.[client.clientId]) {
    return event.emails[client.clientId];
  }
  return generateMailPreview(client);
};

// ── Email Preview Modal ───────────────────────────────────────────────────────

const EmailPreviewModal = ({ client, event, onClose, onConfirm }) => {
  const preview = getEmailPreview(client, event);
  const today = new Date().toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-shell modal-shell--wide mail-modal" onClick={e => e.stopPropagation()}>

        {/* Modal chrome header */}
        <div className="modal-header">
          <div className="modal-header__titles">
            <span className="modal-header__title">Email Preview</span>
          </div>
          <button className="modal-close" onClick={onClose}><X size={14} /></button>
        </div>

        {/* Email client body */}
        <div className="modal-body mail-modal__body">

          {/* Email header strip — like an email client */}
          <div className="mail-envelope">
            <div className="mail-envelope__row">
              <span className="mail-envelope__key">From</span>
              <span className="mail-envelope__val">Your Wealth Advisor &lt;advisor@wealthfirm.com&gt;</span>
            </div>
            <div className="mail-envelope__row">
              <span className="mail-envelope__key">To</span>
              <span className="mail-envelope__val">{client.clientName}</span>
            </div>
            <div className="mail-envelope__row">
              <span className="mail-envelope__key">Subject</span>
              <span className="mail-envelope__val mail-envelope__subject">{preview?.subject}</span>
            </div>
            <div className="mail-envelope__row">
              <span className="mail-envelope__key">Date</span>
              <span className="mail-envelope__val mail-envelope__date">{today}</span>
            </div>
            <div className="mail-envelope__row">
              <span className="mail-envelope__key">Priority</span>
              <span className={`severity-badge severity-badge--${client.severity?.toLowerCase()}`}>{client.severity}</span>
            </div>
          </div>

          {/* Email body — rendered as a real email */}
          <div className="mail-content">

            {/* Greeting */}
            <p className="mail-content__greeting">Dear {client.clientName},</p>

            {/* Body paragraphs — for CIA only show the opening context, cards handle the data */}
            {event._isCIA && preview?.body
              ? preview.body
                  .split('\n')
                  .filter(l => l.trim())
                  .filter(l => !l.startsWith('Dear ') && !l.startsWith('Best regards') && !l.startsWith('Your Wealth Advisor'))
                  .filter(l => !/^(Your Portfolio Impact|Recommended Actions?|Proposed Reallocation|Key Affected Holdings?)/i.test(l.trim()))
                  .filter(l => !l.startsWith('•') && !l.startsWith('-'))
                  .filter(l => !/^(Current energy exposure|Portfolio value|Projected loss|Let.s schedule)/i.test(l.trim()))
                  .slice(0, 3)
                  .map((line, i) => (
                    i === 1
                      ? <p key={i} className="mail-content__event-context">{line}</p>
                      : <p key={i} className="mail-content__para">{line}</p>
                  ))
              : (
                <>
                  <p className="mail-content__para">I wanted to reach out urgently regarding a recent market development that is directly impacting your portfolio.</p>
                  <p className="mail-content__event-context">{event.description}</p>
                </>
              )
            }

            {/* Inline impact card — always shown */}
            <div className="mail-content__impact-block">
              <div className="mail-content__impact-header">
                <AlertTriangle size={14} color="var(--error)" />
                <span>Portfolio Impact Summary</span>
              </div>
              <div className="mail-content__impact-grid">
                <div className="mail-content__impact-cell">
                  <span className="mail-content__impact-label">Exposure</span>
                  <span className="mail-content__impact-value">{client.exposurePct?.toFixed(1)}%</span>
                </div>
                <div className="mail-content__impact-cell">
                  <span className="mail-content__impact-label">Portfolio Value</span>
                  <span className="mail-content__impact-value">${(client.currentValue || 0).toLocaleString()}</span>
                </div>
                <div className="mail-content__impact-cell">
                  <span className="mail-content__impact-label">Est. Loss (Moderate)</span>
                  <span className="mail-content__impact-value mail-content__impact-value--loss">
                    −${(client.projectedLoss || 0).toLocaleString()} ({client.lossPercentage}%)
                  </span>
                </div>
              </div>
            </div>

            {/* Recommended action block */}
            {client.recommendedAction && (
              <div className="mail-content__action-block">
                <div className="mail-content__action-header">
                  <CheckCircle size={14} color="var(--success)" />
                  <span>Recommended Action</span>
                </div>
                <p className="mail-content__action-text">{client.recommendedAction}</p>
              </div>
            )}

            {/* Sign-off */}
            <div className="mail-content__signoff">
              <p>Please don't hesitate to reach out to discuss this further. I'm available for an immediate call to implement protective measures.</p>
              <p>Best regards,<br /><strong>Your Wealth Advisor</strong></p>
            </div>

          </div>
        </div>

        <div className="modal-footer">
          <div className="modal-footer__right">
            <button className="modal-btn modal-btn--ghost" onClick={onClose}>Cancel</button>
            <button className="modal-btn modal-btn--primary" onClick={onConfirm}>Confirm & Send</button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

// ── Component ─────────────────────────────────────────────────────────────────

const MassMailerChat = ({ eventData, isChatExpanded, setIsChatExpanded, setEventData }) => {
  const [chatInput, setChatInput] = useState('');
  const [eventChatMessages, setEventChatMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [mailStatus, setMailStatus] = useState({});
  const [selectedMailClient, setSelectedMailClient] = useState(null);
  const [isEntering, setIsEntering] = useState(true);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => setIsEntering(false), 700);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [eventChatMessages, isLoading]);

  const event = (() => {
    if (!eventData) return null;
    if (typeof eventData === 'object' && eventData.event_id) return adaptCIAReport(eventData);
    return { ...activeMarketEvent, _isCIA: false };
  })();

  function handleChatSubmit(e) {
    e.preventDefault();
    if (!chatInput.trim()) return;
    const msg = chatInput.trim();
    if (event) setEventChatMessages(prev => [...prev, { text: msg, sender: 'user' }]);
    setChatInput('');
    if (event && (msg.toLowerCase().includes('yes') || msg.toLowerCase().includes('send'))) {
      setLoadingMessage('Sending personalised emails...');
      setIsLoading(true);
      setTimeout(() => {
        setIsLoading(false);
        setEventChatMessages(prev => [...prev, { type: 'mail-sent', sender: 'ai' }]);
      }, 4000);
    } else if (event && msg.toLowerCase().includes('email')) {
      setLoadingMessage('Preparing communications...');
      setIsLoading(true);
      setTimeout(() => {
        setIsLoading(false);
        setEventChatMessages(prev => [...prev, { type: 'mail-generation', sender: 'ai' }]);
      }, 3000);
    }
  }

  const handleSuggestionClick = (s) => {
    setChatInput(s);
    handleChatSubmit({ preventDefault: () => {} });
  };

  const handleReviewMail = (id) =>
    setSelectedMailClient(event.affectedClients.find(c => c.clientId === id));

  const handleConfirmMail = () => {
    setMailStatus(prev => ({ ...prev, [selectedMailClient.clientId]: 'confirmed' }));
    setSelectedMailClient(null);
  };

  if (!isChatExpanded) return null;

  if (isEntering) return (
    <div className="overview__chat-overlay mm-entering">
      <button className="mm-entry-close" onClick={() => setIsChatExpanded(false)}><X size={16} /></button>
      <div className="mm-entry-loader">
        <Spinner size={36} color="success" />
        <span className="mm-entry-label">Loading {event?.title ?? 'Event Assessment'}…</span>
      </div>
    </div>
  );

  return (
    <>
      {selectedMailClient && event && (
        <EmailPreviewModal
          client={selectedMailClient}
          event={event}
          onClose={() => setSelectedMailClient(null)}
          onConfirm={handleConfirmMail}
        />
      )}

      <div className="overview__chat-overlay">
        {event ? (
          <div className="chat-expanded">
            <div className="chat-expanded__content">
              <div className="chat-expanded__messages">

                <div className="chat-expanded__message chat-expanded__message--ai chat-expanded__message--card">
                  <div className="event-overview-card">
                    <div className="event-overview-card__header">
                      <AlertTriangle size={24} color="var(--warning)" />
                      <div>
                        <h3>{event.title}</h3>
                        <span className="event-overview-card__meta">
                          {event.timestamp?.split('T')[0]} · {event.severity} Severity · {event.subtitle}
                        </span>
                      </div>
                    </div>
                    <div className="event-overview-card__section">
                      <h4>Market Event Summary</h4>
                      <p className="event-overview-card__desc">{event.eventBrief}</p>
                    </div>
                    <div className="event-overview-card__section">
                      <h4>Portfolio Impact</h4>
                      <p className="event-overview-card__desc">{event.portfolioImpactExplanation}</p>
                    </div>

                    {event._isCIA && eventData?.affected_domains?.length > 0 && (
                      <div className="event-overview-card__section">
                        <h4>Affected Domains</h4>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
                          {eventData.affected_domains.map((d, i) => (
                            <span key={i} style={{
                              padding: '3px 10px', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 600,
                              background: d.impact === 'negative' ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)',
                              color: d.impact === 'negative' ? 'var(--error)' : 'var(--success)',
                              border: `1px solid ${d.impact === 'negative' ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.3)'}`,
                            }}>
                              {d.domain} {d.impact === 'negative' ? '↓' : '↑'}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="event-overview-card__stats">
                      <div className="event-stat"><span className="event-stat__value">{event.impactSummary.totalAffected}</span><span className="event-stat__label">Clients Affected</span></div>
                      <div className="event-stat"><span className="event-stat__value">{event.impactSummary.criticalCount}</span><span className="event-stat__label">Critical</span></div>
                      <div className="event-stat"><span className="event-stat__value">{event.impactSummary.highCount}</span><span className="event-stat__label">High</span></div>
                      <div className="event-stat"><span className="event-stat__value">{event.impactSummary.mediumCount}</span><span className="event-stat__label">Medium</span></div>
                      <div className="event-stat"><span className="event-stat__value">~${(event.impactSummary.totalProjectedLoss / 1000).toFixed(0)}K</span><span className="event-stat__label">Est. Loss</span></div>
                      <div className="event-stat"><span className="event-stat__value">${(event.impactSummary.totalExposure / 1000000).toFixed(1)}M</span><span className="event-stat__label">Total Exposure</span></div>
                      <div className="event-stat"><span className="event-stat__value">~{event.impactSummary.averageLossPercentage}%</span><span className="event-stat__label">Avg Loss</span></div>
                    </div>

                    <div className="event-overview-card__section">
                      <h4>Priority Client Actions</h4>
                      <div className="event-clients-table">
                        <table>
                          <thead>
                            <tr><th>#</th><th>Client</th><th>Severity</th><th>Portfolio</th><th>Est. Loss (Moderate)</th><th>Recommended Action</th></tr>
                          </thead>
                          <tbody>
                            {event.affectedClients.map((client, idx) => (
                              <tr key={client.clientId}>
                                <td>{idx + 1}</td>
                                <td>
                                  <strong>{client.clientName}</strong><br />
                                  <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                                    {client.age ? `${client.age}y · ` : ''}{client.riskProfile}
                                  </span>
                                </td>
                                <td><span className={`severity-badge severity-badge--${client.severity.toLowerCase()}`}>{client.severity}</span></td>
                                <td>
                                  ${(client.currentValue / 1000).toFixed(0)}K
                                  {event._isCIA && <><br /><span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>{client.exposurePct?.toFixed(1)}% exposed</span></>}
                                </td>
                                <td style={{ color: 'var(--error)', fontWeight: 600 }}>
                                  ~${Number(client.projectedLoss).toLocaleString()} (~{client.lossPercentage}%)
                                  {event._isCIA && client.rebalancingNeeded && <><br /><span style={{ fontSize: '0.7rem', color: 'var(--warning)' }}>⚠ Rebalancing needed</span></>}
                                </td>
                                <td style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{client.recommendedAction}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="chat-expanded__message chat-expanded__message--ai chat-expanded__message--card">
                  <div className="chat-suggestions">
                    <p className="chat-suggestions__label">What would you like to do?</p>
                    <div className="chat-suggestions__buttons">
                      <button className="chat-suggestion-btn" onClick={() => handleSuggestionClick('Generate personalised emails for affected clients')}>
                        {event._isCIA ? 'Review pre-composed emails for affected clients' : 'Generate personalised emails'}
                      </button>
                      <button className="chat-suggestion-btn" onClick={() => handleSuggestionClick('Review recommended portfolio adjustments')}>Review portfolio adjustments</button>
                    </div>
                  </div>
                </div>

                {eventChatMessages.map((msg, idx) => (
                  <div key={idx} className={`chat-expanded__message chat-expanded__message--${msg.sender}${msg.type === 'mail-generation' || msg.type === 'mail-sent' ? ' chat-expanded__message--card' : ''}`}>
                    {msg.type === 'mail-generation' ? (
                      <>
                        <p>
                          {event._isCIA
                            ? `I've retrieved pre-composed emails for all ${event.affectedClients.length} affected clients. Review each before sending:`
                            : `I've analysed the ${event.title} impact and prepared personalised communications for all ${event.affectedClients.length} affected clients.`}
                        </p>
                        <div className="mail-clients-list">
                          {event.affectedClients.map(client => (
                            <div key={client.clientId} className="mail-client-item">
                              <div className="mail-client-info">
                                <strong>{client.clientName}</strong>
                                <span className={`severity-badge severity-badge--${client.severity.toLowerCase()}`}>{client.severity}</span>
                              </div>
                              <button
                                className={`mail-action-btn ${mailStatus[client.clientId] === 'confirmed' ? 'mail-action-btn--confirmed' : ''}`}
                                onClick={() => handleReviewMail(client.clientId)}
                              >
                                {mailStatus[client.clientId] === 'confirmed' ? '✓ Confirmed' : 'Review Mail'}
                              </button>
                            </div>
                          ))}
                        </div>
                        <p className="mail-question">Would you like to send these emails to all affected clients?</p>
                        <div className="chat-suggestions__buttons">
                          <button className="chat-suggestion-btn" onClick={() => handleSuggestionClick('Yes, send the emails')}>Yes, send the emails</button>
                          <button className="chat-suggestion-btn" onClick={() => handleSuggestionClick('No, I need to review further')}>No, I need to review further</button>
                        </div>
                      </>
                    ) : msg.type === 'mail-sent' ? (
                      <>
                        <p className="success-message"><CheckCircle size={20} /> Emails sent successfully</p>
                        <div className="completion-summary">
                          <h4>Market Event Response — {event.title}</h4>
                          <div className="sent-clients-list">
                            {event.affectedClients.map(client => (
                              <div key={client.clientId} className="sent-client-item">
                                <div className="sent-client-header">
                                  <strong>{client.clientName}</strong>
                                  <span className={`severity-badge severity-badge--${client.severity.toLowerCase()}`}>{client.severity}</span>
                                </div>
                                <div className="sent-client-details">
                                  <span>Est. Impact: ~${Number(client.projectedLoss).toLocaleString()} (~{client.lossPercentage}%)</span>
                                  <span>Action: {client.recommendedAction}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                          <ul>
                            <li>Follow-up tasks created in CRM</li>
                            <li>Client meetings scheduled for next week</li>
                            <li>Event alert will be cleared from dashboard</li>
                          </ul>
                          <button className="back-to-dashboard-btn" onClick={() => {
                            try {
                              const completed = JSON.parse(localStorage.getItem('cia_completed_events') || '{}');
                              completed[event.id] = true;
                              localStorage.setItem('cia_completed_events', JSON.stringify(completed));
                            } catch { /* ignore */ }
                            setEventData(null); setIsChatExpanded(false);
                            setEventChatMessages([]); setMailStatus({}); setChatInput('');
                          }}>
                            Return to Dashboard
                          </button>
                        </div>
                      </>
                    ) : msg.text}
                  </div>
                ))}

                {isLoading && (
                  <div className="chat-expanded__message chat-expanded__message--ai">
                    <div className="chat-loading"><Spinner size={22} /><span>{loadingMessage}</span></div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              <form className="chat-expanded__input" onSubmit={handleChatSubmit}>
                <input type="text" placeholder="Ask AI..." value={chatInput} onChange={e => setChatInput(e.target.value)} />
                <button type="submit" disabled={!chatInput.trim()}><Send size={20} /></button>
              </form>
            </div>
          </div>
        ) : (
          <BackendChatInterface onClose={() => setIsChatExpanded(false)} />
        )}
      </div>
    </>
  );
};

export default MassMailerChat;
