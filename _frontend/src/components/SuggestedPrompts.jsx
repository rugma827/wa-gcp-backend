import { useEffect, useState } from 'react';
import { FileText, ArrowRightLeft, Users, TrendingUp } from 'lucide-react';
import { fetchActivityLog } from '../utils/activityLogHelper';
import { useAuth } from '../contexts/AuthContext';
import './SuggestedPrompts.css';

const MODULES = [
  { label: 'Client Report Generation', icon: FileText,       color: 'green'  },
  { label: 'Portfolio Rebalance',       icon: ArrowRightLeft, color: 'blue'   },
  { label: 'Meeting Prep',              icon: Users,          color: 'purple' },
  { label: 'Market Research',           icon: TrendingUp,     color: 'indigo' },
];

const SuggestedPrompts = ({ onPromptClick, isLoading, refreshKey = 0 }) => {
  const { userId } = useAuth();
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    if (!userId) return;
    fetchActivityLog(userId).then(entries => {
      // Deduplicate by summary — keep most recent (entries already sorted desc by timestamp)
      const seen = new Set();
      const unique = [];
      for (const log of entries) {
        if (!seen.has(log.summary)) {
          seen.add(log.summary);
          unique.push(log);
        }
        if (unique.length === 4) break;
      }
      setLogs(unique);
    });
  }, [userId, refreshKey]);

  return (
    <div className="suggested-prompts suggested-prompts--normal">

      {/* Module cards */}
      <div className="suggested-prompts__modules">
        {MODULES.map(({ label, icon: Icon, color }) => (
          <div key={label} className={`sp-module-card sp-module-card--${color}`}>
            <div className="sp-module-card__icon"><Icon size={15} /></div>
            <span className="sp-module-card__label">{label}</span>
          </div>
        ))}
      </div>

      {/* Activity log quick links */}
      {logs.length > 0 && (
        <div className="suggested-prompts__grid">
          {logs.map((log) => (
            <button
              key={log.log_id}
              className="suggested-prompt suggested-prompts--normal"
              onClick={() => onPromptClick({ text: log.summary, query: log.summary })}
              disabled={isLoading}
            >
              <span className="suggested-prompt__text">{log.summary}</span>
            </button>
          ))}
        </div>
      )}

    </div>
  );
};

export default SuggestedPrompts;
