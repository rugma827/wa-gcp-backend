import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import ReactFlow, { Background, Controls, MarkerType, applyNodeChanges } from 'reactflow';
import 'reactflow/dist/style.css';
import './GraphModal.css';

const MONITOR_API = `${import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'}/monitor`;

const COLORS = {
  Client:            { bg: '#1e1b4b', border: '#6366f1', text: '#a5b4fc' },
  Account:           { bg: '#1a2744', border: '#3b82f6', text: '#93c5fd' },
  Holding:           { bg: '#0f2a1a', border: '#22c55e', text: '#86efac' },
  Instrument:        { bg: '#1a1a2e', border: '#8b5cf6', text: '#c4b5fd' },
  Interaction:       { bg: '#1c1917', border: '#f59e0b', text: '#fcd34d' },
  Decision:          { bg: '#1c1917', border: '#d97706', text: '#fbbf24' },
  Goal:              { bg: '#0f1f2e', border: '#0ea5e9', text: '#7dd3fc' },
  LifeEvent:         { bg: '#1a1a2e', border: '#a78bfa', text: '#ddd6fe' },
  LifeContext:       { bg: '#1a1a2e', border: '#7c3aed', text: '#c4b5fd' },
  InvestmentPolicyStatement: { bg: '#0f1f2e', border: '#0284c7', text: '#7dd3fc' },
  BehaviouralProfile:{ bg: '#1c1917', border: '#f59e0b', text: '#fbbf24' },
  Risk:              { bg: '#2a0a2e', border: '#d946ef', text: '#f0abfc' },
  NBA:               { bg: '#0a1f1a', border: '#10b981', text: '#6ee7b7' },
  ActionExecution:   { bg: '#1a0a2e', border: '#7c3aed', text: '#c4b5fd' },
  Household:         { bg: '#1a1200', border: '#f59e0b', text: '#fde68a' },
  PeerGroup:         { bg: '#0a1a2e', border: '#38bdf8', text: '#7dd3fc' },
  Sector:            { bg: '#0f1a00', border: '#a3e635', text: '#d9f99d' },
  Issuer:            { bg: '#0a1a1a', border: '#22d3ee', text: '#67e8f9' },
  MarketEvent:       { bg: '#1a0810', border: '#f43f5e', text: '#fda4af' },
  MarketImpact:      { bg: '#1a0818', border: '#e879f9', text: '#f5d0fe' },
  SimulationResult:  { bg: '#0a1628', border: '#60a5fa', text: '#bfdbfe' },
  GoalImpactAssessment: { bg: '#0a1628', border: '#60a5fa', text: '#bfdbfe' },

};
const DEFAULT_COLOR = { bg: '#1a1d2e', border: '#334155', text: '#94a3b8' };
const WARNING_COLOR = { bg: '#2d0a0a', border: '#ef4444', text: '#fca5a5' };
const NIL_COLOR    = { bg: '#111318', border: '#2a2d3a', text: '#3a3f52' };


const EDGE_COLORS = {
  OWNS: '#3b82f6', HOLDS: '#22c55e', IS_INSTRUMENT_OF: '#8b5cf6',
  HAD: '#f59e0b', LED_TO: '#d97706', HAS_GOAL: '#0ea5e9',
  HAS_PROFILE: '#f59e0b', EXPERIENCED: '#a78bfa', HAS_CONTEXT: '#7c3aed',
  HAS_NBA: '#10b981', RECOMMENDS: '#10b981', SURFACES: '#d946ef',
};

const LEGEND = [
  ['#6366f1','Client'], ['#3b82f6','Account'], ['#22c55e','Holding'],
  ['#8b5cf6','Instrument'], ['#f59e0b','Interaction'], ['#d97706','Decision'],
  ['#0ea5e9','Goal/IPS'], ['#a78bfa','LifeEvent'], ['#d946ef','Risk'],
  ['#10b981','NBA'], ['#7c3aed','Action'], ['#38bdf8','PeerGroup'],
  ['#a3e635','Sector'], ['#22d3ee','Issuer'], ['#f43f5e','MarketEvent'], ['#e879f9','MarketImpact'], ['#60a5fa','Simulation/Goal'],
];

const TYPE_LAYOUT = {
  Client: { col: 3, row: 0 }, Goal: { col: 5, row: 0 },
  Account: { col: 3, row: 1 }, BehaviouralProfile: { col: 1, row: 1 },
  InvestmentPolicyStatement: { col: 5, row: 1 },
  LifeEvent: { col: 7, row: 1 }, LifeContext: { col: 7, row: 2 },
  Employer: { col: 0, row: 1 }, Holding: { col: 2, row: 2 },
  Instrument: { col: 2, row: 3 }, Sector: { col: 1, row: 5 }, Issuer: { col: 1, row: 6 },
  MarketEvent: { col: 11, row: 1 }, MarketImpact: { col: 12, row: 1 },
  SimulationResult: { col: 10, row: 2 }, GoalImpactAssessment: { col: 11, row: 2 },
  Interaction: { col: 5, row: 2 }, Decision: { col: 7, row: 3 },
  Household: { col: 9, row: 0 },
  PeerGroup: { col: 9, row: 1 },
  NBA: { col: 4, row: 5 }, ActionExecution: { col: 7, row: 5 },
};
const COL_W = 220, ROW_H = 160;
const NBA_Y = TYPE_LAYOUT.NBA.row * ROW_H;

const RISK_SOURCE_TYPE = {
  behavioural_anomaly:       'BehaviouralProfile',
  ips_breach:                'InvestmentPolicyStatement',
  severe_cash_drag:          'Client',
  cash_drag:                 'Client',
  kyc_expired:               'Client',
  interaction_silence:       'Interaction',
  sentiment_trend_negative:  'Interaction',
  critical_credit_score:     'Client',
  low_credit_score:          'Client',
  goal_proximity_near_term:  'InvestmentObjective',
  goal_proximity_target_gap: 'InvestmentObjective',
  market_exposure_risk:      'Holding',
  goal_at_risk:              'InvestmentObjective',
  concentration_risk:        'Holding',
};

function assignPositions(nodes) {
  // First pass: place all non-Risk nodes
  const counters = {};
  const placed = nodes.map(n => {
    if (n.node_type === 'Risk') return { ...n, x: 0, y: 0 };
    const base = TYPE_LAYOUT[n.node_type] || { col: 8, row: 3 };
    counters[n.node_type] = counters[n.node_type] || 0;
    const offset = counters[n.node_type]++;
    return { ...n, x: (base.col + (offset % 3)) * COL_W, y: (base.row + Math.floor(offset / 3)) * ROW_H };
  });

  // Second pass: place each Risk node at its source node's x, midpoint Y to NBA
  // If multiple risks share the same source type, spread them horizontally by ±40px
  const risksBySource = {};
  placed.forEach(n => {
    if (n.node_type !== 'Risk') return;
    const srcType = RISK_SOURCE_TYPE[n.attrs?.type || ''] || 'Client';
    risksBySource[srcType] = risksBySource[srcType] || [];
    risksBySource[srcType].push(n.id);
  });

  return placed.map(n => {
    if (n.node_type !== 'Risk') return n;
    const riskType = n.attrs?.type || '';
    const srcType = RISK_SOURCE_TYPE[riskType] || 'Client';
    const srcNode = placed.find(p => p.node_type === srcType);
    const srcX = srcNode ? srcNode.x : TYPE_LAYOUT.NBA.col * COL_W;
    const srcY = srcNode ? srcNode.y : 0;
    const siblings = risksBySource[srcType] || [];
    const idx = siblings.indexOf(n.id);
    const spread = (idx - (siblings.length - 1) / 2) * 50;
    return { ...n, x: srcX + spread, y: (srcY + NBA_Y) / 2 };
  });
}

function NodeBox({ nodeType, label, isNew, isWarning, color, onClick }) {
  return (
    <div onClick={onClick} style={{
      background: color.bg,
      border: `1.5px solid ${isNew ? '#34d399' : color.border}`,
      borderRadius: 8, padding: '7px 11px', minWidth: 160,
      boxShadow: isNew ? `0 0 14px ${color.border}55` : isWarning ? '0 0 12px #ef444455' : 'none',
      position: 'relative', cursor: 'pointer',
    }}>
      {isNew && (
        <div style={{ position: 'absolute', top: -8, right: 6, background: '#34d399', color: '#052e16',
          fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3 }}>NEW</div>
      )}
      {isWarning && (
        <div style={{ position: 'absolute', top: -8, right: 6, background: '#ef4444', color: '#fff',
          fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3 }}>⚠</div>
      )}
      <div style={{ fontSize: 10, fontWeight: 700, color: color.border, letterSpacing: 0.8,
        textTransform: 'uppercase', marginBottom: 3 }}>{nodeType}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: color.text }}>
        {label.length > 22 ? label.slice(0, 22) + '…' : label}
      </div>
    </div>
  );
}

function apiToFlow(graphData, onNodeClick, isDemo, clientId) {
  if (!graphData) return { nodes: [], edges: [] };
  const positioned = assignPositions(graphData.nodes);

  const clientNode  = graphData.nodes.find(n => n.node_type === 'Client');
  const clientNeoId = clientNode ? String(clientNode.id) : null;

  // Derive warning node types from NBA.attrs.risk_sources (set by backend per open risks).
  // These are the node types whose instances should be highlighted red.
  const nbaNode = graphData.nodes.find(n => n.node_type === 'NBA');
  const riskSources = nbaNode?.attrs?.risk_sources || [];
  const warningTypes = new Set(riskSources);

  // Build a set of node ids that are warning nodes (matched by type)
  const warningNodeIds = new Set(
    positioned
      .filter(n => warningTypes.has(n.node_type))
      .map(n => String(n.id))
  );

  const nodes = positioned.map(n => {
    const isWarning = warningNodeIds.has(String(n.id));
    const isNil = n.label === 'NIL';
    const color = isWarning ? WARNING_COLOR : isNil ? NIL_COLOR : (COLORS[n.node_type] || DEFAULT_COLOR);
    return {
      id: String(n.id),
      type: 'default',
      position: { x: n.x, y: n.y },
      data: {
        label: <NodeBox nodeType={n.node_type} label={n.label} isNew={n.is_new} isWarning={isWarning} color={color} onClick={() => onNodeClick(n)} />,
        _raw: n,
      },
      style: { background: 'transparent', border: 'none', padding: 0, width: 'auto' },
    };
  });

  // Remove the generic Client->NBA edge; warning nodes connect via Risk->NBA (SURFACES)
  // which is already in the edge list from the backend.
  let edges = graphData.edges
    .filter(e => !(e.source === clientNeoId && e.target === 'NBA_node' && e.rel_type === 'HAS_NBA' && warningNodeIds.size > 0))
    .map(e => {
      const isNew = e.is_new;
      const isSurfaces = e.rel_type === 'SURFACES';
      const stroke = isNew ? '#34d399' : isSurfaces ? '#d946ef' : (EDGE_COLORS[e.rel_type] || '#2d3148');
      return {
        id: String(e.id), source: String(e.source), target: String(e.target),
        label: e.rel_type, animated: isNew || isSurfaces,
        style: { stroke, strokeWidth: isNew || isSurfaces ? 2 : 1.5 },
        labelStyle: { fill: isSurfaces ? '#d946ef' : '#64748b', fontSize: 10 },
        labelBgStyle: { fill: '#0f1117' },
        markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
        data: { _raw: { rel_type: e.rel_type, props: e.props || {} } },
      };
    });

  // Add red TRIGGERS edges from each warning source node to its Risk node.
  // The Risk nodes already have SURFACES -> NBA edges from the backend.
  // We wire: warningNode -> Risk (TRIGGERS) so the full chain is visible:
  //   SourceNode -[TRIGGERS]-> Risk -[SURFACES]-> NBA -[RECOMMENDS]-> ActionExecution
  const riskNodes = graphData.nodes.filter(n => n.node_type === 'Risk');
  const ts = '#ef4444';
  const addedTriggers = new Set();
  riskNodes.forEach(riskNode => {
    const riskType = riskNode.attrs?.type || '';
    const sourceNodeType = RISK_SOURCE_TYPE[riskType];
    if (!sourceNodeType) return;
    // Find the first graph node of that type
    const sourceNode = positioned.find(n => n.node_type === sourceNodeType);
    if (!sourceNode) return;
    const edgeKey = `${String(sourceNode.id)}_${String(riskNode.id)}`;
    if (addedTriggers.has(edgeKey)) return;
    addedTriggers.add(edgeKey);
    edges.push({
      id: `trigger_${edgeKey}`,
      source: String(sourceNode.id),
      target: String(riskNode.id),
      label: 'TRIGGERS', animated: true,
      style: { stroke: ts, strokeWidth: 2 },
      labelStyle: { fill: ts, fontSize: 10 },
      labelBgStyle: { fill: '#0f1117' },
      markerEnd: { type: MarkerType.ArrowClosed, color: ts },
    });
  });

  return { nodes, edges };
}

function DetailPanel({ node }) {
  const isEdge = node?._isEdge;
  const edgeColor = isEdge ? (EDGE_COLORS[node.rel_type] || '#64748b') : null;
  const color = !isEdge && node ? (COLORS[node.node_type] || DEFAULT_COLOR) : null;
  const entries = node
    ? isEdge
      ? Object.entries(node.props || {})
      : Object.entries(node.attrs || {}).filter(([k]) => !['source_system', 'source_id', 'synced_at'].includes(k))
    : [];
  return (
    <div className="gm-detail">
      {!node ? (
        <div className="gm-empty">Click a node or edge to inspect</div>
      ) : (
        <>
          <div className="gm-detail__head">
            <span className="gm-detail__type" style={{ color: isEdge ? edgeColor : color.border }}>
              {isEdge ? 'RELATIONSHIP' : node.node_type}
            </span>
            {!isEdge && node.is_new && <span className="gm-detail__new">NEW</span>}
          </div>
          <div className="gm-detail__name">{isEdge ? node.rel_type : node.label}</div>
          <div className="gm-detail__body">
            {entries.length === 0
              ? <div className="gm-empty">No attributes</div>
              : entries.map(([k, v]) => {
                  const isNil = v === 'NIL' || v === null || v === undefined || v === '';
                  const display = isNil ? '—' : (Array.isArray(v) ? v.join(', ') : String(v));
                  return (
                    <div className="gm-detail-row" key={k}>
                      <span className="gm-detail-key">{k}</span>
                      <span className={`gm-detail-val${isNil ? ' gm-detail-val--nil' : ''}`}>{display}</span>
                    </div>
                  );
                })
            }
          </div>
        </>
      )}
    </div>
  );
}

export default function GraphModal({ clientId, clientName, isDemo, onClose }) {
  const [graphData, setGraphData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);

  useEffect(() => {
    if (!clientId) return;
    setLoading(true);
    setSelectedNode(null);
    const url = isDemo
      ? `${MONITOR_API}/graph/${clientId}/demo`
      : `${MONITOR_API}/graph/${clientId}`;
    fetch(url)
      .then(r => r.json())
      .then(data => {
        setGraphData(data);
        const { nodes: n, edges: e } = apiToFlow(data, setSelectedNode, isDemo, clientId);
        setNodes(n);
        setEdges(e);
      })
      .catch(err => { console.error('GraphModal fetch error:', err); setGraphData(null); })
      .finally(() => setLoading(false));
  }, [clientId, isDemo]);

  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const onNodesChange = useCallback(changes => setNodes(n => applyNodeChanges(changes, n)), []);
  const onEdgeClick = useCallback((_, edge) => {
    const raw = edge.data?._raw;
    if (raw) setSelectedNode({ ...raw, _isEdge: true });
  }, []);

  return createPortal(
    <div className="gm-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="gm-modal">
        <div className="gm-header">
          <div>
            <div className="gm-header__title">{clientName}</div>
            <div className="gm-header__sub">
              knowledge graph · id: {clientId}
            </div>
          </div>
          <button className="gm-close" onClick={onClose}>×</button>
        </div>
        <div className="gm-body">
          <div className="gm-graph">
            {loading && <div className="gm-loading">Loading graph…</div>}
            {!loading && graphData && (
              <div style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}>
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  onNodesChange={onNodesChange}
                  onEdgeClick={onEdgeClick}
                  fitView
                  fitViewOptions={{ padding: 0.15 }}
                  nodesDraggable
                  nodesConnectable={false}
                  minZoom={0.3}
                  maxZoom={2}
                >
                  <Background color="#1e2235" gap={20} size={1} />
                  <Controls style={{ background: '#1a1d2e', border: '1px solid #2d3148' }} />
                </ReactFlow>
              </div>
            )}
            {!loading && !graphData && (
              <div className="gm-loading">No graph data available</div>
            )}
            <div className="gm-legend">
              {LEGEND.map(([c, l]) => (
                <div className="gm-legend__item" key={l}>
                  <div className="gm-legend__dot" style={{ background: c }} />{l}
                </div>
              ))}
            </div>
          </div>
          <DetailPanel node={selectedNode} />
        </div>
      </div>
    </div>
  , document.body);
}
