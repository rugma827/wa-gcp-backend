import { useState, useEffect, useRef, useCallback } from 'react';
import { getApiUrl } from '../config/api';
import { MORNING_NOTE_DEFAULTS } from '../config/morningNotesDefaults';

const ERROR_PHRASES = [
  'experiencing issues',
  'cannot access',
  'try again later',
  'apologize for the inconvenience',
  'technical issue',
  'tool failure',
  'unable to complete',
];

const isBackendError = (output = '') =>
  ERROR_PHRASES.some((p) => output.toLowerCase().includes(p));

export const parseSections = (output = '') => {
  const lines = output.split('\n');
  const sections = [];
  let current = null;
  let inChecklist = false;

  const KNOWN_SECTIONS = /^(Trade Ideas|Market Recap|Macro Update|Market Tone|Top Picks|Key Risks|Watch List|Action Items|Client Impact|Risk Factors)$/i;

  const cleanLine = (line) =>
    line.replace(/\*\*([^*]+)\*\*:/g, '$1:').replace(/^\*+\s+/, '').replace(/^-\s+/, '').trim();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Stop at checklist markers — but NOT plain --- dividers (used as section separators)
    if (
      trimmed === '***' ||
      /^\*{3,}$/.test(trimmed) ||
      /^\[x\]/i.test(trimmed) ||
      /^\[\s\]/i.test(trimmed) ||
      trimmed.toLowerCase().includes('completeness checklist') ||
      (trimmed.startsWith('**') && trimmed.endsWith('**') && /checklist|skipped:/i.test(trimmed))
    ) {
      inChecklist = true;
      continue;
    }
    if (inChecklist) continue;

    // Detect section headers — handles: **Title**, ### **Title**, # Title
    // Lines starting with - or * bullet prefix are NEVER section headers — always body content
    const isBullet = /^[-*]\s+/.test(trimmed);

    const stripped = trimmed.replace(/^#{1,4}\s+/, '').replace(/^[*\-]\s+/, '');
    const boldCandidate = !isBullet && stripped.startsWith('**') && stripped.endsWith('**') && stripped.length > 4
      ? stripped
      : (!isBullet && stripped.startsWith('**') ? stripped.split('**').slice(0, 3).join('**') + (stripped.endsWith('**') ? '' : '') : null);

    // Also handle plain markdown headings: ### Title (no bold)
    const headingMatch = !isBullet && trimmed.match(/^#{1,4}\s+(.+)$/);
    const rawTitle = boldCandidate
      ? boldCandidate.slice(2, boldCandidate.lastIndexOf('**')).trim()
      : (headingMatch ? headingMatch[1].replace(/\*\*/g, '').trim() : null);

    if (rawTitle) {
      const hasDigits = /\d/.test(rawTitle);
      if (hasDigits) { /* skip date lines */ }
      else if (/^(Coverage|Sector Coverage|Analyst Name|Coverage Universe):/i.test(rawTitle)) { /* skip metadata */ }
      else {
        const SECTOR_WORDS = /^(Macro|Equities|Fixed Income|Tech|Healthcare|Energy|Crypto|Real Estate|Global|US|Europe|Asia|Bonds|Commodities)(,\s*(Macro|Equities|Fixed Income|Tech|Healthcare|Energy|Crypto|Real Estate|Global|US|Europe|Asia|Bonds|Commodities))*$/i;
        if (!SECTOR_WORDS.test(rawTitle)) {
          const wordCount = rawTitle.split(/\s+/).length;
          const isSection = /^[A-Z]/.test(rawTitle) &&
            (rawTitle.includes(':') || rawTitle.includes('/') || wordCount >= 3 || KNOWN_SECTIONS.test(rawTitle));
          if (isSection) {
            if (current) sections.push(current);
            current = { title: rawTitle.replace(/:$/, '').trim(), impact: '', detail: [] };
            continue;
          }
        }
      }
    }

    if (current) {
      const cleaned = cleanLine(trimmed);
      if (!cleaned) continue;
      if (!current.impact) {
        current.impact = cleaned;
      } else {
        current.detail.push(cleaned);
      }
    }
  }

  if (current) sections.push(current);

  // Always put Top Call first
  const topCallIdx = sections.findIndex(s => s.title.toLowerCase().includes('top call'));
  if (topCallIdx > 0) {
    const [topCall] = sections.splice(topCallIdx, 1);
    sections.unshift(topCall);
  }

  return sections.map(s => ({
    ...s,
    content: [s.impact, ...s.detail].filter(Boolean),
  }));
};

const useMorningNotes = () => {
  const [sections, setSections] = useState([]);
  const [rawOutput, setRawOutput] = useState('');
  const [topics, setTopics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [isStale, setIsStale] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(new Date().toISOString());
  const fetchingRef = useRef(false);

  const getConfig = () => {
    try {
      const stored = localStorage.getItem('mn_config');
      if (stored) return { ...MORNING_NOTE_DEFAULTS, ...JSON.parse(stored) };
    } catch { /* ignore */ }
    return MORNING_NOTE_DEFAULTS;
  };

  const applyData = (data, stale = false) => {
    const output = data?.output || '';
    setRawOutput(output);
    setSections(parseSections(output));
    setTopics(data?.topics_covered || []);
    setLastUpdated(data?.timestamp || new Date().toISOString());
    setIsStale(stale);
    setError(null);
  };

  const fetchMorningNote = useCallback(async (forceRefresh = false) => {
    if (fetchingRef.current && !forceRefresh) return;
    fetchingRef.current = true;
    try {
      applyData({ output: '', timestamp: new Date().toISOString(), topics_covered: [] }, false);
    } finally {
      setLoading(false);
      setRefreshing(false);
      fetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    fetchMorningNote(false);

    // Schedule a refresh at midnight each day
    const scheduleNextMidnight = () => {
      const now = new Date();
      const midnight = new Date();
      midnight.setHours(24, 0, 0, 0);
      const msUntilMidnight = midnight - now;
      return setTimeout(() => {
        fetchMorningNote(true);
        // Re-schedule for the next midnight
        const next = scheduleNextMidnight();
        return next;
      }, msUntilMidnight);
    };

    const timer = scheduleNextMidnight();
    return () => clearTimeout(timer);
  }, [fetchMorningNote]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    fetchMorningNote(true);
  }, [fetchMorningNote]);

  return { sections, rawOutput, topics, loading, refreshing, error, isStale, lastUpdated, refresh };
};

export default useMorningNotes;
