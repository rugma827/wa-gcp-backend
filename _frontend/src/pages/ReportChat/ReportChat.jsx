import { useRef, useEffect, useState, Component } from 'react';
import { useReportChat } from '../../hooks/useReportChat';
import { Bot, User, Send, RefreshCw, Download } from 'lucide-react';
import AgentTrace from '../../components/AgentTrace';
import SectionResult from '../../components/SectionResult';
import { FormattedText } from '../../utils/textFormatter.jsx';
import apiService from '../../services/apiService';
import './ReportChat.css';

class SectionErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(e) { return { error: e }; }
  componentDidCatch(e, info) { console.error('[SectionErrorBoundary] crash:', e, info.componentStack); }
  render() {
    if (this.state.error) {
      return <div style={{color:'var(--error-color,#ef4444)',fontSize:'0.8rem',padding:'0.5rem'}}>Section render error: {this.state.error.message}</div>;
    }
    return this.props.children;
  }
}

const ReportChat = () => {
  const {
    isConnected,
    chatMessages,
    statusHistory,
    isProcessing,
    sendChatMessage,
    clearSession
  } = useReportChat();

  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, statusHistory]);

  const handleSend = (e) => {
    e.preventDefault();
    if (!inputValue.trim()) return;
    sendChatMessage(inputValue);
    setInputValue('');
  };

  const formatTime = (timestamp) => {
    return new Date(timestamp).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  return (
    <div className="report-chat-container">
      <div className="report-chat-header">
        <div className="header-left">
          <Bot size={32} strokeWidth={2} />
          <div>
            <h2>AI Relationship Engine</h2>
            <span className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
              {isConnected ? '● Connected' : '○ Disconnected'}
            </span>
          </div>
        </div>
        <button onClick={clearSession} className="clear-session-btn">
          <RefreshCw size={18} />
          New Session
        </button>
      </div>

      <div className="report-chat-content">
        <div className="messages-container">
          {chatMessages.length === 0 && (
            <div className="welcome-message">
              <Bot size={52} strokeWidth={1.5} />
              <h3>AI Relationship Engine</h3>
              <p>I have access to portfolios for Robert Anderson, Sarah Mitchell, David Chen, Emily Rodriguez, James Patterson, and Lisa Thompson.</p>
              <div className="quick-actions">
                <button className="quick-action-btn" onClick={() => { setInputValue('Generate full report for Sarah Mitchell Q4 2025'); }}>Full report for Sarah Mitchell</button>
                <button className="quick-action-btn" onClick={() => { setInputValue('Show asset allocation for David Chen Q4 2025'); }}>David Chen&#39;s asset allocation</button>
                <button className="quick-action-btn" onClick={() => { setInputValue('Show performance for Robert Anderson Q4 2025'); }}>Performance report for Robert Anderson</button>
                <button className="quick-action-btn" onClick={() => { setInputValue('Generate tax-loss harvesting report Q4 2025'); }}>Tax-loss harvesting report</button>
              </div>
            </div>
          )}

          {chatMessages.map((message) => (
            <div 
              key={message.id} 
              className={`message ${message.sender}`}
            >
              {message.sender === 'agent' && (
                <div className="message-avatar">
                  <Bot size={20} />
                </div>
              )}
              
              <div className="message-content">
                <div className="message-bubble">
                  <FormattedText text={message.text} />
                  {message.data && message.data.pdf_path && (
                    <a 
                      href={apiService.getDownloadUrl(message.data.pdf_path.split('/').pop())}
                      download
                      className="pdf-download-btn"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Download size={16} />
                      Download PDF Report
                    </a>
                  )}
                  {message.data && (
                    <SectionErrorBoundary key={message.id}>
                      <SectionResult section={message.section} data={message.data} />
                    </SectionErrorBoundary>
                  )}
                  {message.sections && message.sections.length > 0 && (
                    <div className="sections-list">
                      {message.clientName && (
                        <div className="report-preview-header">
                          Report Preview for {message.clientName}
                        </div>
                      )}
                      {message.sections.map((sec, idx) => (
                        <div key={idx} className="section-item">
                          <SectionErrorBoundary key={idx}>
                            <SectionResult section={sec.section} data={sec.data} />
                          </SectionErrorBoundary>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <span className="message-time">{formatTime(message.timestamp)}</span>
              </div>

              {message.sender === 'user' && (
                <div className="message-avatar user">
                  <User size={20} />
                </div>
              )}
            </div>
          ))}

          <AgentTrace statusHistory={statusHistory} isProcessing={isProcessing} />
          <div ref={messagesEndRef} />
        </div>

        <div className="input-section">
          <form onSubmit={handleSend} className="message-input-form">
            <div className={`input-wrapper ${isProcessing ? 'processing' : ''}`}>
              {(isProcessing || statusHistory.length > 0) && <div className="input-progress-bar" />}
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={isProcessing ? 'Agents are working...' : 'Ask about client portfolios or request reports...'}
                className="message-input"
                disabled={!isConnected || isProcessing}
              />
            </div>
            <button 
              type="submit" 
              className="send-button"
              disabled={!inputValue.trim() || !isConnected || isProcessing}
            >
              <Send size={20} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ReportChat;
