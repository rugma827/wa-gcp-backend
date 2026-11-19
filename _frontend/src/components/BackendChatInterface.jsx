import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Sparkles, CheckCircle2, XCircle, ArrowUp, ArrowDown, Loader } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useAssist } from '../contexts/AssistContext';
import { useMeetingPrep } from '../contexts/MeetingPrepContext';
import { getApiUrl } from '../config/api';
import { getCognitoToken, getSessionId } from '../utils/authCookies';
import SuggestedPrompts from './SuggestedPrompts';
import MarketResearchResult from './MarketResearchResult';
import RebalancingChatSummary from './RebalancingChatSummary';
import MeetingPrepChatSummary from './MeetingPrepChatSummary';
import AgentTrace from '../components/AgentTrace';
import SectionResult from '../components/SectionResult';

// ── Auth headers helper ───────────────────────────────────────────────────────
function _authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  const token = getCognitoToken();
  if (token) h['Authorization'] = `Bearer ${token}`;
  const sid = getSessionId();
  if (sid) h['X-Session-ID'] = sid;
  return h;
}

const BackendChatInterface = ({ onClose }) => {
  const { userId } = useAuth();

  // ── State ─────────────────────────────────────────────────────────────────
  const { messages, setMessages, activityRefreshKey, setActivityRefreshKey, pendingParamsRef, pendingIntentRef } = useAssist();
  const { setResult: setMeetingResult } = useMeetingPrep();
  const [isLoading, setIsLoading] = useState(false);

  const messagesRef = useRef(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  // ── Message helpers ───────────────────────────────────────────────────────
  const _addMsg = (msg) => setMessages(prev => [...prev, { id: Date.now() + Math.random(), timestamp: Date.now(), ...msg }]);

  const _replaceMsg = (tempId, msg) =>
    setMessages(prev => prev.map(m => m.id === tempId ? { ...m, ...msg, id: tempId } : m));

  // ── SSE subscription for meeting prep progress ────────────────────────────
  const _subscribeProgress = useCallback((taskId, loadingId, onSuccess) => {
    const url = getApiUrl(`/assist/progress/${taskId}`);
    const token = getCognitoToken();
    const sid = getSessionId();
    // EventSource doesn't support custom headers — use fetch with ReadableStream
    const ctrl = new AbortController();
    fetch(url, {
      headers: {
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...(sid ? { 'X-Session-ID': sid } : {}),
      },
      signal: ctrl.signal,
    }).then(async (res) => {
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
              const result = ev.result;
              if (result?.type === 'meeting_prep' && result.data) {
                const mid = result.meeting_id || '';
                const rawId = result.data?.client?.clientId || result.data?.client?.customerId || mid;
                const clientId = rawId.startsWith('direct_') ? rawId.slice(7) : rawId;
                if (clientId) setMeetingResult(clientId, result.data);
                _replaceMsg(loadingId, { sender: 'assistant', isLoading: false, isMeetingCard: true, meetingData: result.data, meetingId: mid });
                onSuccess?.();
              } else if (result?.type === 'rebalance' && result.data) {
                _replaceMsg(loadingId, { sender: 'assistant', isLoading: false, isRebalancing: true, rebalancingData: result.data, clientId: result.client_id, clientName: result.client_name });
                onSuccess?.();
              } else if (result?.type === 'error') {
                _replaceMsg(loadingId, { sender: 'assistant', isLoading: false, text: result.message });
              }
              ctrl.abort();
              return;
            }
            if (ev.pct !== undefined) {
              setMessages(prev => prev.map(m =>
                m.id === loadingId
                  ? { ...m, isLoading: true, progressPct: Math.max(m.progressPct || 0, ev.pct), progressMsg: ev.message }
                  : m
              ));
            }
          } catch { /* ignore */ }
        }
      }
    }).catch(() => { /* aborted or network error */ });
    return ctrl;
  }, []);

  // ── Core send logic ───────────────────────────────────────────────────────
  const _send = useCallback(async (userText) => {
    if (!userText.trim()) return;

    _addMsg({ sender: 'user', text: userText });
    setIsLoading(true);

    // Only send history for follow-up param gathering (no action word in current message).
    // If the current message has an action word, send empty history — the LLM must classify
    // from the current message alone, not be influenced by previous module results.
    const ACTION_WORDS = /\b(rebalance|rebalancing|report|generate|prepare|brief|research|meeting prep|meeting brief)\b/i;
    const hasActionWord = ACTION_WORDS.test(userText);
    const history = hasActionWord ? [] : messages
      .filter(m => (m.sender === 'user' || m.sender === 'assistant') && m.text && !m.isRebalancing && !m.isMeetingCard && !m.researchData && !m.sections)
      .slice(-4)
      .map(m => ({ role: m.sender === 'user' ? 'user' : 'assistant', content: m.text || '' }));

    // Merge any accumulated params into the message context
    const accumulatedParams = pendingParamsRef.current;

    const loadingId = Date.now() + Math.random();
    _addMsg({ id: loadingId, sender: 'assistant', isLoading: true, progressPct: 0, progressMsg: 'Thinking...' });

    try {
      const res = await fetch(getApiUrl('/assist/chat'), {
        method: 'POST',
        headers: _authHeaders(),
        body: JSON.stringify({
          message: userText,
          session_id: getSessionId() || 'default',
          conversation_history: history,
          user_id: userId || 'default',
          ...(pendingIntentRef.current ? { pending_intent: pendingIntentRef.current } : {}),
          ...(Object.keys(accumulatedParams).length > 0 ? { accumulated_params: accumulatedParams } : {}),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        _replaceMsg(loadingId, { sender: 'assistant', isLoading: false, text: err.detail || 'Something went wrong. Please try again.' });
        return;
      }

      const data = await res.json();
      const { intent, dispatch, reply, missing_params, result } = data;

      // Unknown intent — polite rejection
      if (intent === 'unknown') {
        pendingParamsRef.current = {};
        pendingIntentRef.current = null;
        _replaceMsg(loadingId, { sender: 'assistant', isLoading: false, text: reply });
        return;
      }

      // Missing params — follow-up question, accumulate what we have
      if (!dispatch) {
        pendingIntentRef.current = intent;
        // Merge any params the LLM already extracted
        if (data.params) Object.assign(pendingParamsRef.current, data.params);
        _replaceMsg(loadingId, { sender: 'assistant', isLoading: false, text: reply });
        return;
      }

      // Dispatched — clear accumulated state
      pendingParamsRef.current = {};
      pendingIntentRef.current = null;

      // Handle result by type
      const r = result || {};

      if (r.type === 'error') {
        _replaceMsg(loadingId, { sender: 'assistant', isLoading: false, text: r.message });
        return;
      }

      // Successful dispatch — refresh activity log quick links.
      // Pending types fire setActivityRefreshKey from SSE onSuccess instead.
      if (r.type !== 'meeting_prep_pending' && r.type !== 'rebalance_pending') setActivityRefreshKey(k => k + 1);

      if (r.type === 'no_rebalance') {
        _replaceMsg(loadingId, { sender: 'assistant', isLoading: false, text: r.justification || r.verdict || 'No rebalance needed.' });
        return;
      }

      if (r.type === 'rebalance_confirm') {
        _replaceMsg(loadingId, {
          sender: 'assistant', isLoading: false,
          isRebalanceConfirm: true,
          confirmClientId: r.client_id,
          confirmClientName: r.client_name,
          confirmVerdict: r.verdict,
          confirmJustification: r.justification,
          confirmSignals: r.signals || [],
        });
        return;
      }

      if (r.type === 'rebalance_pending') {
        _subscribeProgress(r.task_id, loadingId, () => setActivityRefreshKey(k => k + 1));
        _replaceMsg(loadingId, {
          sender: 'assistant', isLoading: true, progressPct: 5,
          progressMsg: 'Preparing analysis...',
          progressVerdict: r.verdict || null,
        });
        return;
      }

      if (r.type === 'meeting_prep') {
        const rawId = r.data?.client?.clientId || r.data?.client?.customerId || r.meeting_id || '';
        const clientId = rawId.startsWith('direct_') ? rawId.slice(7) : rawId;
        if (clientId) setMeetingResult(clientId, r.data);
        _replaceMsg(loadingId, { sender: 'assistant', isLoading: false, isMeetingCard: true, meetingData: r.data, meetingId: r.meeting_id || '' });
        setActivityRefreshKey(k => k + 1);
        return;
      }

      if (r.type === 'meeting_prep_pending') {
        _subscribeProgress(r.task_id, loadingId, () => setActivityRefreshKey(k => k + 1));
        _replaceMsg(loadingId, { sender: 'assistant', isLoading: true, progressPct: 10, progressMsg: 'Preparing meeting brief...' });
        return;
      }

      if (r.type === 'research') {
        setActivityRefreshKey(k => k + 1);
        _replaceMsg(loadingId, { sender: 'assistant', isLoading: false, researchData: r.data });
        return;
      }

      if (r.type === 'report') {
        const reportData = r.data;
        setActivityRefreshKey(k => k + 1);
        if (reportData?.sections?.length) {
          // Full report — multiple sections
          _replaceMsg(loadingId, { sender: 'assistant', isLoading: false, sections: reportData.sections, clientName: result?.params?.client_name });
        } else if (reportData?.type === 'result' && reportData?.data) {
          // Single section — render as one section card
          _replaceMsg(loadingId, { sender: 'assistant', isLoading: false, sections: [{ section: reportData.section, title: reportData.message, data: reportData.data }] });
        } else {
          _replaceMsg(loadingId, { sender: 'assistant', isLoading: false, text: reportData?.message || 'Report generated.' });
        }
        return;
      }

      // Fallback — show raw reply if present
      _replaceMsg(loadingId, { sender: 'assistant', isLoading: false, text: reply || 'Done.' });

    } catch (err) {
      console.error('[ASSIST] Chat failed:', err);
      _replaceMsg(loadingId, { sender: 'assistant', isLoading: false, text: 'Connection error. Please try again.' });
    } finally {
      setIsLoading(false);
    }
  }, [messages, userId, _subscribeProgress]);

  // ── Rebalance confirm (borderline ask) ──────────────────────────────────
  const handleRebalanceConfirm = useCallback(async (msg) => {
    const loadingId = Date.now() + Math.random();
    // Replace the confirm bubble with a loading bubble
    setMessages(prev => prev.map(m =>
      m.isRebalanceConfirm && m.confirmClientId === msg.confirmClientId
        ? { ...m, isRebalanceConfirm: false, isLoading: true, progressPct: 10, progressMsg: 'Starting rebalance...' }
        : m
    ));
    try {
      const res = await fetch(getApiUrl('/assist/rebalance/confirm'), {
        method: 'POST',
        headers: _authHeaders(),
        body: JSON.stringify({ client_id: msg.confirmClientId, client_name: msg.confirmClientName, user_id: userId || 'default' }),
      });
      const data = await res.json();
      const r = data?.result || {};
      if (r.type === 'rebalance_pending') {
        // Find the bubble we just updated and subscribe SSE on it
        setMessages(prev => {
          const bubble = prev.find(m => m.confirmClientId === msg.confirmClientId);
          if (bubble) _subscribeProgress(r.task_id, bubble.id, () => setActivityRefreshKey(k => k + 1));
          return prev;
        });
      } else if (r.type === 'error') {
        setMessages(prev => prev.map(m =>
          m.confirmClientId === msg.confirmClientId
            ? { ...m, isLoading: false, text: r.message }
            : m
        ));
      }
    } catch {
      setMessages(prev => prev.map(m =>
        m.confirmClientId === msg.confirmClientId
          ? { ...m, isLoading: false, text: 'Connection error. Please try again.' }
          : m
      ));
    }
  }, [userId, _subscribeProgress]);

  // ── Form submit ───────────────────────────────────────────────────────────
  const handleSubmit = (e) => {
    e.preventDefault();
    const input = e.target.elements.chatInput.value.trim();
    if (!input || isLoading) return;
    e.target.reset();
    _send(input);
  };

  // ── Suggested prompt click ────────────────────────────────────────────────
  const handleSuggestedPromptClick = useCallback((prompt) => {
    const text = typeof prompt === 'string' ? prompt : prompt.query || prompt.summary || '';
    if (text) _send(text);
  }, [_send]);

  // ── Scroll helpers ────────────────────────────────────────────────────────
  const handleMessagesScroll = useCallback(() => {
    const el = messagesRef.current;
    if (!el) return;
    setShowScrollTop(el.scrollTop > 100);
    setShowScrollBottom(el.scrollHeight - el.scrollTop - el.clientHeight > 100);
  }, []);

  const scrollToBottom = useCallback(() =>
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: 'smooth' }), []);
  const scrollToTop = () => messagesRef.current?.scrollTo({ top: 0, behavior: 'smooth' });

  useEffect(() => { if (messages.length > 0) scrollToBottom(); }, [messages.length, scrollToBottom]);

  // ── Markdown renderer (kept from original) ────────────────────────────────
  const parseMarkdownTable = (lines, startIdx) => {
    const tableLines = [];
    let i = startIdx;
    while (i < lines.length && (lines[i].includes('|') || lines[i].trim() === '')) {
      if (lines[i].includes('|')) tableLines.push(lines[i]);
      i++;
    }
    if (tableLines.length < 2) return null;
    const headers = tableLines[0].split('|').map(h => h.trim()).filter(h => h);
    const rows = tableLines.slice(2).map(row => row.split('|').map(cell => cell.trim()).filter(cell => cell !== ''));
    return { headers, rows, endIdx: i };
  };

  const formatMessageWithIcons = (text) => {
    if (!text) return null;
    const hasCompletionItems = /[✅❌]/.test(text);
    if (hasCompletionItems) {
      const lines = text.split('\n');
      let headerText = '';
      const completionItems = [];
      lines.forEach((line, idx) => {
        const t = line.trim();
        if (!t) return;
        if (t.startsWith('✅')) {
          completionItems.push(<div key={`c-${idx}`} className="completion-item success"><CheckCircle2 size={18} strokeWidth={2} /><span>{t.replace('✅', '').trim()}</span></div>);
        } else if (t.startsWith('❌')) {
          completionItems.push(<div key={`e-${idx}`} className="completion-item error"><XCircle size={18} strokeWidth={2} /><span>{t.replace('❌', '').trim()}</span></div>);
        } else if (completionItems.length === 0) {
          headerText += (headerText ? ' ' : '') + t;
        }
      });
      return (<>{headerText && <p className="completion-header">{headerText}</p>}{completionItems.length > 0 && <div className="completion-list">{completionItems}</div>}</>);
    }

    const lines = text.split('\n');
    const elements = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const t = line.trim();
      if (!t) { i++; continue; }
      if (t.includes('|') && i + 1 < lines.length && lines[i + 1].includes('|')) {
        const tableData = parseMarkdownTable(lines, i);
        if (tableData) {
          elements.push(
            <div key={`tbl-${i}`} className="research-table-wrapper">
              <table className="research-table">
                <thead><tr>{tableData.headers.map((h, idx) => <th key={idx} dangerouslySetInnerHTML={{ __html: h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') }} />)}</tr></thead>
                <tbody>{tableData.rows.map((row, ri) => <tr key={ri}>{row.map((cell, ci) => <td key={ci} dangerouslySetInnerHTML={{ __html: cell.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>') }} />)}</tr>)}</tbody>
              </table>
            </div>
          );
          i = tableData.endIdx;
          continue;
        }
      }
      if (t === '---') elements.push(<hr key={`hr-${i}`} className="research-divider" />);
      else if (t.startsWith('# ')) elements.push(<h1 key={i} className="research-h1">{t.substring(2)}</h1>);
      else if (t.startsWith('## ')) elements.push(<h2 key={i} className="research-h2">{t.substring(3)}</h2>);
      else if (t.startsWith('### ')) elements.push(<h3 key={i} className="research-h3">{t.substring(4)}</h3>);
      else if (t.startsWith('#### ')) elements.push(<h4 key={i} className="research-h4">{t.substring(5)}</h4>);
      else if (t.startsWith('- ') || t.startsWith('* ')) elements.push(<li key={i} className="research-li" dangerouslySetInnerHTML={{ __html: t.substring(2).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') }} />);
      else elements.push(<p key={i} className="research-p" dangerouslySetInnerHTML={{ __html: t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>') }} />);
      i++;
    }
    return <div className="research-content">{elements}</div>;
  };

  const formatTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="bci-root">

      {/* Messages */}
      <div className="bci-messages" ref={messagesRef} onScroll={handleMessagesScroll}>
        <div className="bci-messages-inner">
          {messages.length === 0 ? (
            <div className="bci-welcome">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Sparkles size={32} className="welcome-icon" />
                <h3>Client Relationship Assist</h3>
              </div>
              <p>Your intelligent assistant for client management, portfolio analysis, and relationship insights.</p>
              <div className="bci-welcome-input">
                <form className="bci-input-row" onSubmit={handleSubmit}>
                  <input
                    type="text"
                    name="chatInput"
                    placeholder="Ask me anything — reports, rebalancing, meeting prep, research..."
                    disabled={isLoading}
                    className="bci-input"
                  />
                  <button type="submit" className="bci-send" disabled={isLoading}><Send size={18} /></button>
                </form>
                <SuggestedPrompts
                  onPromptClick={handleSuggestedPromptClick}
                  isLoading={isLoading}
                  refreshKey={activityRefreshKey}
                />
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg) => (
                <div key={msg.id} className={`chat-message chat-message--${msg.sender}`}>
                  <div className="message-bubble">
                    {msg.isLoading ? (
                      <div className="bci-progress-bubble">
                        {msg.progressVerdict && (
                          <p className="bci-progress-verdict">{msg.progressVerdict}</p>
                        )}
                        <div className="bci-progress-header">
                          <Loader size={13} className="gc-spin" />
                          <span>{msg.progressMsg || 'Working...'}</span>
                          {msg.progressPct > 0 && <span className="bci-progress-pct">{msg.progressPct}%</span>}
                        </div>
                        {msg.progressPct > 0 && (
                          <div className="bci-progress-bar-track">
                            <div className="bci-progress-bar-fill" style={{ width: `${msg.progressPct}%` }} />
                          </div>
                        )}
                      </div>
                    ) : msg.isRebalanceConfirm ? (
                      <div className="bci-rebalance-confirm">
                        <div className="bci-confirm-header">
                          <span className="bci-confirm-badge">Review needed</span>
                          <span className="bci-confirm-client">{msg.confirmClientName}</span>
                        </div>
                        <p className="bci-confirm-verdict">{msg.confirmVerdict}</p>
                        {msg.confirmSignals?.length > 0 && (
                          <div className="bci-confirm-signals">
                            {msg.confirmSignals.map((s, i) => (
                              <div key={i} className="bci-confirm-signal-row">
                                <span className="bci-confirm-signal-name">{s.name}</span>
                                <span className="bci-confirm-signal-detail">{s.detail}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="bci-confirm-actions">
                          <button className="bci-confirm-yes" onClick={() => handleRebalanceConfirm(msg)}>Proceed</button>
                          <button className="bci-confirm-no" onClick={() => setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, isRebalanceConfirm: false, text: 'Rebalance cancelled.' } : m))}>Cancel</button>
                        </div>
                      </div>
                    ) : msg.researchData ? (
                      <MarketResearchResult data={msg.researchData} />
                    ) : msg.isRebalancing ? (
                      <RebalancingChatSummary data={msg.rebalancingData} clientId={msg.clientId} clientName={msg.clientName} />
                    ) : msg.isMeetingCard ? (
                      <MeetingPrepChatSummary meeting={msg.meetingData} meetingId={msg.meetingId} />
                    ) : msg.sections?.length > 0 ? (
                      <div className="sections-list">
                        {msg.clientName && <div className="report-preview-header">Report Preview for {msg.clientName}</div>}
                        {msg.sections.map((sec, idx) => (
                          <div key={idx} className="section-item"><SectionResult section={sec.section} data={sec.data} /></div>
                        ))}
                      </div>
                    ) : msg.data ? (
                      <SectionResult section={msg.section} data={msg.data} />
                    ) : (
                      formatMessageWithIcons(msg.text)
                    )}
                  </div>
                  <span className="message-timestamp">{formatTime(msg.timestamp)}</span>
                </div>
              ))}
              <AgentTrace statusHistory={[]} isProcessing={isLoading} researchMode={false} />
            </>
          )}
        </div>
      </div>

      {/* Scroll buttons */}
      {messages.length > 0 && (showScrollTop || showScrollBottom) && (
        <div className="bci-scroll-btns">
          {showScrollTop && <button className="bci-scroll-btn" onClick={scrollToTop}><ArrowUp size={14} /></button>}
          {showScrollBottom && <button className="bci-scroll-btn" onClick={scrollToBottom}><ArrowDown size={14} /></button>}
        </div>
      )}

      {/* Bottom input bar — shown when chat has messages */}
      {messages.length > 0 && (
        <div className="bci-bottom">
          <form className="bci-input-row" onSubmit={handleSubmit}>
            <input
              type="text"
              name="chatInput"
              placeholder="Ask me anything — reports, rebalancing, meeting prep, research..."
              disabled={isLoading}
              className="bci-input"
            />
            <button type="submit" className="bci-send" disabled={isLoading}><Send size={18} /></button>
          </form>
        </div>
      )}

    </div>
  );
};

export default BackendChatInterface;
