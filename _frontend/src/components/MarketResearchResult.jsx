import { useState } from 'react';
import { TrendingUp, BarChart2, Users, Lightbulb, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import ResearchExportBar from './ResearchExportBar';
import './MarketResearchResult.css';

const fmt = (v, prefix = '', suffix = '', decimals = 2) =>
  v == null ? '—' : `${prefix}${Number(v).toFixed(decimals)}${suffix}`;

const fmtMarketCap = (v) => {
  if (v == null) return '—';
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9)  return `$${(v / 1e9).toFixed(1)}B`;
  return `$${(v / 1e6).toFixed(0)}M`;
};

// ─── Collapsible Section Wrapper ───────────────────────────────────────────────
const Section = ({ icon: Icon, title, accent, defaultOpen = true, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`mr-section mr-section--${accent}`}>
      <button className="mr-section-header" onClick={() => setOpen(o => !o)}>
        <span className="mr-section-title">
          <Icon size={15} />
          {title}
        </span>
        {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
      </button>
      {open && <div className="mr-section-body">{children}</div>}
    </div>
  );
};

// ─── 1. Ideas Shortlist ────────────────────────────────────────────────────────
const IdeasSection = ({ ideas }) => (
  <Section icon={Lightbulb} title="Investment Ideas" accent="ideas" defaultOpen={true}>
    <div className="mr-ideas-grid">
      {ideas.map((idea, i) => (
        <div key={idea.ticker} className="mr-idea-card">
          <div className="mr-idea-header">
            <span className="mr-idea-rank">#{i + 1}</span>
            <span className="mr-idea-ticker">{idea.ticker}</span>
            <span className="mr-idea-company">{idea.company}</span>
          </div>

          <p className="mr-idea-thesis">{idea.thesis}</p>

          <div className="mr-idea-metrics">
            {Object.entries(idea.key_metrics).map(([k, v]) => (
              <div key={k} className="mr-idea-metric">
                <span className="mr-idea-metric-label">{k.replace(/_pct$/, ' %').replace(/_/g, ' ')}</span>
                <span className="mr-idea-metric-val">{v == null ? '—' : v}</span>
              </div>
            ))}
          </div>

          {idea.risks?.length > 0 && (
            <div className="mr-idea-risks">
              {idea.risks.map((r, ri) => (
                <span key={ri} className="mr-risk-pill">
                  <AlertTriangle size={10} /> {r}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  </Section>
);

// ─── 2. Sector Overview ────────────────────────────────────────────────────────
const SectorOverview = ({ overview, sector, angle }) => (
  <Section icon={TrendingUp} title="Sector Overview" accent="sector" defaultOpen={true}>
    <div className="mr-overview-meta">
      <span className="mr-meta-chip">{sector}</span>
      <span className="mr-meta-chip mr-meta-chip--angle">{angle}</span>
    </div>

    {overview.market_size && (
      <div className="mr-overview-block">
        <span className="mr-overview-label">Market Size</span>
        <p className="mr-overview-text">{overview.market_size}</p>
      </div>
    )}

    {overview.why_now && (
      <div className="mr-overview-block mr-overview-block--highlight">
        <span className="mr-overview-label">Why Now</span>
        <p className="mr-overview-text">{overview.why_now}</p>
      </div>
    )}

    {overview.structure && (
      <div className="mr-overview-block">
        <span className="mr-overview-label">Structure</span>
        <p className="mr-overview-text">{overview.structure}</p>
      </div>
    )}

    {overview.key_drivers?.length > 0 && (
      <div className="mr-overview-block">
        <span className="mr-overview-label">Key Drivers</span>
        <ul className="mr-drivers-list">
          {overview.key_drivers.map((d, i) => <li key={i}>{d}</li>)}
        </ul>
      </div>
    )}
  </Section>
);

// ─── 3. Comps Table ────────────────────────────────────────────────────────────
const CompsTable = ({ comps }) => {
  const { companies, statistics, outliers, metrics } = comps;

  const cols = [
    { key: 'ticker',             label: 'Ticker',      fmt: v => v },
    { key: 'market_cap',         label: 'Mkt Cap',     fmt: fmtMarketCap },
    { key: 'ev_revenue',         label: 'EV/Rev',      fmt: v => fmt(v, '', 'x') },
    { key: 'ev_ebitda',          label: 'EV/EBITDA',   fmt: v => fmt(v, '', 'x') },
    { key: 'pe',                 label: 'P/E',         fmt: v => fmt(v, '', 'x') },
    { key: 'revenue_growth_pct', label: 'Rev Grw',     fmt: v => fmt(v, '', '%') },
    { key: 'ebitda_margin_pct',  label: 'EBITDA Mgn',  fmt: v => fmt(v, '', '%') },
    { key: 'gross_margin_pct',   label: 'Gross Mgn',   fmt: v => fmt(v, '', '%') },
    { key: 'fcf_yield_pct',      label: 'FCF Yld',     fmt: v => fmt(v, '', '%') },
  ];

  const statRows = statistics
    ? [
        { label: 'Median',   data: statistics.median },
        { label: '75th %ile', data: statistics.percentile_75 },
        { label: '25th %ile', data: statistics.percentile_25 },
        { label: 'Max',       data: statistics.maximum },
        { label: 'Min',       data: statistics.minimum },
      ]
    : [];

  return (
    <Section icon={BarChart2} title="Comparable Companies" accent="comps" defaultOpen={false}>
      <div className="mr-table-wrap">
        <table className="mr-table">
          <thead>
            <tr>
              {cols.map(c => <th key={c.key}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {companies.map(co => (
              <tr key={co.ticker}>
                {cols.map(c => {
                  const val = co[c.key];
                  const isNeg = typeof val === 'number' && val < 0;
                  return (
                    <td key={c.key} className={c.key === 'ticker' ? 'mr-td-ticker' : isNeg ? 'mr-td-neg' : ''}>
                      {c.fmt(val)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          {statRows.length > 0 && (
            <tfoot>
              {statRows.map(row => (
                <tr key={row.label} className="mr-stat-row">
                  <td className="mr-stat-label">{row.label}</td>
                  {cols.slice(1).map(c => (
                    <td key={c.key}>{c.fmt(row.data?.[c.key])}</td>
                  ))}
                </tr>
              ))}
            </tfoot>
          )}
        </table>
      </div>

      {outliers?.length > 0 && (
        <div className="mr-outliers">
          <span className="mr-overview-label">Outliers</span>
          {outliers.map((o, i) => (
            <div key={i} className="mr-outlier-row">
              <AlertTriangle size={12} className="mr-outlier-icon" />
              <span>{o}</span>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
};

// ─── 4. Competitive Landscape ──────────────────────────────────────────────────
const CompetitiveLandscape = ({ players }) => (
  <Section icon={Users} title="Competitive Landscape" accent="comp" defaultOpen={false}>
    <div className="mr-players-grid">
      {players.map(p => (
        <div key={p.ticker} className="mr-player-card">
          <div className="mr-player-header">
            <span className="mr-idea-ticker">{p.ticker}</span>
            <span className="mr-player-company">{p.company}</span>
          </div>
          {p.market_share && <p className="mr-player-share">{p.market_share}</p>}
          {p.positioning   && <p className="mr-player-pos">{p.positioning}</p>}
        </div>
      ))}
    </div>
  </Section>
);

// ─── Root Component ────────────────────────────────────────────────────────────
const MarketResearchResult = ({ data }) => {
  if (!data) return null;

  const { report_id, sector, angle, ideas_shortlist, sector_overview, competitive_landscape, comps_spread, peer_universe, files } = data;

  return (
    <div className="mr-root">
      {/* Ideas — always first, always open */}
      {ideas_shortlist?.ideas?.length > 0 && (
        <IdeasSection ideas={ideas_shortlist.ideas} />
      )}

      {/* Sector Overview */}
      {sector_overview && (
        <SectorOverview overview={sector_overview} sector={sector} angle={angle} />
      )}

      {/* Comps Table */}
      {comps_spread?.companies?.length > 0 && (
        <CompsTable comps={comps_spread} />
      )}

      {/* Competitive Landscape */}
      {competitive_landscape?.players?.length > 0 && (
        <CompetitiveLandscape players={competitive_landscape.players} />
      )}

      {/* Peer Universe — compact footer */}
      {peer_universe?.length > 0 && (
        <div className="mr-peer-universe">
          <span className="mr-peer-label">Peer Universe</span>
          {peer_universe.map(t => <span key={t} className="mr-peer-chip">{t}</span>)}
        </div>
      )}

      {/* Export bar — only shown when files exist */}
      <ResearchExportBar reportId={report_id} files={files} />
    </div>
  );
};

export default MarketResearchResult;
