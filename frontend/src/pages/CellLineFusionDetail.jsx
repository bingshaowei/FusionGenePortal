// src/pages/CellLineFusionDetail.jsx
// Cell Line 专属融合详情页 — 完整基于 FusionDetail.jsx 重新构建
// 改动：
//   1. 数据源：/api/cellfusion/by-name/:fusionName
//   2. 变体 ID 格式：{fusionName}_1 / {fusionName}_2 ...（按 fq 降序）
//      → 对应 Arriba PDF 缓存：arriba/cellfusion_cache/{fusionName}_N.pdf
//   3. 去掉三个顶部分析卡片（转录组 / 临床 / 药敏）
//   4. 去掉 Co-occurring Fusion Analysis（UpSet）
//   5. Fusion Information 新增 Cell Line / Tissue / Disease 可展开行
//   6. 顶栏样本总数分母 = 1019
//   7. Arriba apiPrefix = '/api/arriba/cellfusion'
//   其余 UI / 交互 / 图表与 FusionDetail.jsx 完全一致

import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Database, Download, Info, AlertCircle,
  ChevronDown, ChevronUp, X,
  Dna, FileImage, BarChart3, HelpCircle, FlaskConical, ExternalLink, BookOpen, Activity
} from 'lucide-react';
import * as d3 from 'd3';

import ArribaFusionDiagram from '../components/ArribaFusionDiagram';
import FusionProteinPredictor from '../components/FusionProteinPredictor';
import { useLanguage } from '../contexts/LanguageContext';

// ─── 认证辅助（与 FusionDetail.jsx 完全一致）──────────────────────────────
async function ensureToken() {
  let token = localStorage.getItem('token');
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && (payload.exp - now < 300)) token = null;
    } catch { token = null; }
  }
  if (!token) {
    try {
      const resp = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin' })
      });
      const data = await resp.json();
      token = data?.access_token;
      if (token) localStorage.setItem('token', token);
    } catch {}
  }
  return token;
}

async function fetchWithAuth(url, options = {}, retries = 1) {
  const token = await ensureToken();
  const response = await fetch(url, {
    ...options,
    headers: { ...options.headers, 'Authorization': `Bearer ${token}` }
  });
  if (response.status === 401 && retries > 0) {
    localStorage.removeItem('token');
    return fetchWithAuth(url, options, retries - 1);
  }
  return response;
}

// 全库平均参考值（固定常量）
const DB_AVG_JC = 1.92;
const DB_AVG_SP = 0.68;

const getSignificance = (fusionVal, dbAvg) => {
  if (dbAvg <= 0 || fusionVal <= 0) return 'ns';
  const ratio = fusionVal / dbAvg;
  if (ratio >= 3) return '***';
  if (ratio >= 2) return '**';
  if (ratio >= 1.3) return '*';
  return 'ns';
};

// ─── 括号感知分割（供 ExpandableInfoField 使用）─────────────────────────
const smartSplit = (str) => {
  if (!str || String(str).trim() === '' || String(str).trim().toLowerCase() === 'n/a') return [];
  const items = []; let depth = 0, current = '';
  for (const ch of String(str)) {
    if (ch === '(') { depth++; current += ch; }
    else if (ch === ')') { depth--; current += ch; }
    else if ((ch === ',' || ch === ';') && depth === 0) {
      const t = current.trim(); if (t) items.push(t); current = '';
    } else current += ch;
  }
  const t = current.trim(); if (t) items.push(t);
  return items;
};

// ─── Cell Line / Tissue / Disease 可点击展开行 ──────────────────────────
// 显示策略：
//   1. 只显示第一个条目（单行），用 CSS truncate 截断溢出
//   2. 如果有多项，右侧加 "+N" 圆形徽章，点击展开完整列表
//   3. 下拉面板宽度 w-72（288px），不超出 col-span-1 的容器边界
// ★ fqMap: 可选，{item_name: count}，传入后下拉表头增加 FQ 列，每行显示计数
const ExpandableInfoField = ({ label, value, color = 'orange', fqMap }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const fn = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [open]);

  // ★ 如果有 fqMap 且非空，优先用 fqMap 的 key 作为条目（已按 FQ 降序排列）
  const hasFqMap = fqMap && typeof fqMap === 'object' && Object.keys(fqMap).length > 0;
  const items = hasFqMap
    ? Object.entries(fqMap).sort((a, b) => b[1] - a[1]).map(([name]) => name)
    : smartSplit(value);

  const empty = items.length === 0 && (!value || !String(value).trim() || String(value).toLowerCase() === 'n/a');
  const hasMany = items.length > 1;
  const colorMap = { red: 'text-red-700', orange: 'text-orange-700', purple: 'text-purple-700' };
  const textColor = colorMap[color] || colorMap.orange;

  if (empty) return (
    <tr className="hover:bg-slate-50">
      <td className="py-2 pr-3 text-slate-500 font-medium whitespace-nowrap">{label}</td>
      <td className="py-2 text-slate-400">N/A</td>
    </tr>
  );

  // 只显示第一条，多条时旁边放 "+N" 徽章
  const firstItem = items[0] || '';
  const firstFq = hasFqMap ? (fqMap[firstItem] ?? '') : '';

  return (
    <tr className="hover:bg-slate-50">
      <td className="py-2 pr-3 text-slate-500 font-medium whitespace-nowrap align-middle">{label}</td>
      <td className="py-2 relative max-w-0" ref={ref}>
        <button
          onClick={() => (hasMany || hasFqMap) && setOpen(o => !o)}
          className={`w-full text-left flex items-center gap-1.5 ${(hasMany || hasFqMap) ? 'cursor-pointer' : 'cursor-default'}`}
          title={hasMany ? value : undefined}
        >
          <span
            className={`text-xs min-w-0 flex-1 truncate ${textColor} ${(hasMany || hasFqMap) ? 'underline decoration-dotted' : ''}`}
          >
            {firstItem}
          </span>
          {/* ★ 有 fqMap 时在折叠态也显示第一条的 FQ */}
          {hasFqMap && firstFq !== '' && (
            <span className="flex-shrink-0 px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-[10px] font-bold">
              {firstFq}
            </span>
          )}
          {hasMany && (
            <span className="flex-shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full text-[10px] font-semibold">
              +{items.length - 1} {open ? <ChevronUp size={8}/> : <ChevronDown size={8}/>}
            </span>
          )}
        </button>
        {open && (
          <div
            className="absolute left-0 top-full mt-1 z-50 w-80 max-w-[92vw] max-h-56 overflow-y-auto bg-gray-900 text-white text-xs rounded-lg py-2 px-3 shadow-2xl"
          >
            {/* ★ 表头：有 fqMap 时右侧加 FQ 列头 */}
            <div className="mb-1.5 text-gray-300 font-semibold border-b border-gray-700 pb-1.5 flex items-center justify-between sticky top-0 bg-gray-900">
              <span>{label} ({items.length})</span>
              <div className="flex items-center gap-2">
                {hasFqMap && <span className="text-green-400 text-[10px]">FQ</span>}
                <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-gray-300"><X size={12}/></button>
              </div>
            </div>
            {color === 'red'
              ? <div className="flex flex-wrap gap-1 py-1">
                  {items.map((item, i) =>
                    <span key={i} className="px-1.5 py-0.5 bg-gray-700 rounded text-[10px] break-all">{item.trim()}</span>)}
                </div>
              : items.map((item, i) => (
                  <div key={i} className="py-1 border-b border-gray-700 last:border-0 leading-snug break-words flex items-center justify-between gap-2">
                    <span className="min-w-0 flex-1">{item}</span>
                    {/* ★ 每行右侧显示 FQ 计数 */}
                    {hasFqMap && fqMap[item] !== undefined && (
                      <span className="flex-shrink-0 px-1.5 py-0.5 bg-green-900/50 text-green-400 rounded text-[10px] font-bold">
                        {fqMap[item]}
                      </span>
                    )}
                  </div>
                ))
            }
          </div>
        )}
      </td>
    </tr>
  );
};

// ─── 基因名清理函数 ─────────────────────────────────
const cleanGene = (g) => (g || '').split('^')[0] || 'N/A';
const extractEnsg = (g) => { if (!g) return 'N/A'; const p = g.split('^'); return p.length > 1 ? p[1] : p[0]; };

// ─── 基因功能查询组件 ─────────────────────────────────
const GeneFunctionCard = ({ geneName, side }) => {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { t } = useLanguage();
  const GF = t.geneFunction;

  useEffect(() => {
    if (!geneName || geneName === 'N/A') return;
    const name = geneName.split('^')[0].replace(/\.\d+$/, '');
    setLoading(true); setError(null); setInfo(null);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`https://mygene.info/v3/query?q=symbol:${encodeURIComponent(name)}&species=human&fields=name,summary,type_of_gene,genomic_pos,alias,pathway.kegg&size=1`);
        if (!res.ok) throw new Error('API error');
        const data = await res.json();
        const hit = data?.hits?.[0];
        if (hit) setInfo(hit);
        else setError(GF.notFound);
      } catch (e) { setError(GF.queryFailed); }
      finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(timer);
  }, [geneName]);

  const bgColor = side === 'left' ? 'bg-blue-50 border-blue-200' : 'bg-purple-50 border-purple-200';
  const textColor = side === 'left' ? 'text-blue-700' : 'text-purple-700';

  if (loading) return <div className={`rounded-lg p-3 border ${bgColor} text-xs text-slate-500 animate-pulse`}>{GF.loading(cleanGene(geneName))}</div>;
  if (error || !info) return null;

  return (
    <div className={`rounded-lg p-3 border ${bgColor}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <BookOpen size={14} className={textColor} />
        <span className={`text-xs font-bold ${textColor}`}>{GF.title(cleanGene(geneName))}</span>
        <a href={`https://www.ncbi.nlm.nih.gov/gene/?term=${encodeURIComponent(cleanGene(geneName))}+AND+human`}
          target="_blank" rel="noopener noreferrer" className="ml-auto text-xs text-slate-400 hover:text-blue-500 flex items-center gap-0.5">
          NCBI <ExternalLink size={10} />
        </a>
      </div>
      {info.name && <div className="text-xs text-slate-700 mb-1"><span className="font-semibold">{GF.fullName}</span>{info.name}</div>}
      {info.type_of_gene && <div className="text-xs text-slate-600 mb-1"><span className="font-semibold">{GF.type}</span>{info.type_of_gene}</div>}
      {info.summary && <div className="text-xs text-slate-600 leading-relaxed"><span className="font-semibold">{GF.summary}</span>{info.summary}</div>}
      {info.alias && <div className="text-xs text-slate-500 mt-1"><span className="font-semibold">{GF.alias}</span>{Array.isArray(info.alias) ? info.alias.slice(0, 5).join(', ') : info.alias}</div>}
    </div>
  );
};

// ════════════════════════════════════════════════════════════════════════════
// MiniJunctionSpanningChart（与 FusionDetail.jsx 完全一致，使用细胞系全库均值）
// ════════════════════════════════════════════════════════════════════════════
const MiniJunctionSpanningChart = ({ data, fusionName, dbAvgJunction, dbAvgSpanning }) => {
  const svgRef = useRef();
  const containerRef = useRef();
  const [tooltip, setTooltip] = useState(null);
  const { t } = useLanguage();
  const FD = t.fusionDetail;

  // 使用传入的细胞系全库均值，若未传入则使用默认值
  const CL_AVG_JC = (dbAvgJunction != null && !isNaN(dbAvgJunction)) ? dbAvgJunction : DB_AVG_JC;
  const CL_AVG_SP = (dbAvgSpanning != null && !isNaN(dbAvgSpanning)) ? dbAvgSpanning : DB_AVG_SP;

  useEffect(() => {
    if (!data || data.length === 0) return;

    d3.select(svgRef.current).selectAll('*').remove();

    const svgW = 350, svgH = 260;
    const margin = { top: 42, right: 12, bottom: 78, left: 58 };
    const W = svgW - margin.left - margin.right;
    const H = svgH - margin.top - margin.bottom;

    const svg = d3.select(svgRef.current)
      .attr('width', svgW)
      .attr('height', svgH)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const avgJunction = d3.mean(data, d => d.avg_junction_read_count || 0) || 0;
    const avgSpanning = d3.mean(data, d => d.avg_spanning_frag_count || 0) || 0;

    // 四根柱子等宽，根据可用宽度自动计算（与 FusionDetail 完全一致）
    const innerGap = 8, outerGap = 28;
    const totalGaps = innerGap * 2 + outerGap;
    const barW = Math.floor((W - totalGaps - 8) / 4);
    const jcDbX = 4;
    const jcFuX = jcDbX + barW + innerGap;
    const spDbX = jcFuX + barW + outerGap;
    const spFuX = spDbX + barW + innerGap;

    const shortName = fusionName
      ? (fusionName.length > 14 ? fusionName.slice(0, 12) + '..' : fusionName)
      : 'this';

    const bars = [
      { x: jcDbX,  value: CL_AVG_JC,  color: '#94a3b8', desc: FD.dbAvgJunction(CL_AVG_JC) },
      { x: jcFuX,  value: avgJunction, color: '#3b82f6', desc: FD.fusionJunctionAvg(avgJunction.toFixed(2)) },
      { x: spDbX,  value: CL_AVG_SP,  color: '#94a3b8', desc: FD.dbAvgSpanning(CL_AVG_SP) },
      { x: spFuX,  value: avgSpanning, color: '#10b981', desc: FD.fusionSpanningAvg(avgSpanning.toFixed(2)) },
    ];

    const maxVal = Math.max(d3.max(bars, b => b.value) || 1, 0.5);
    const y = d3.scaleLinear().domain([0, maxVal * 1.2]).range([H, 0]);

    // Y 轴
    svg.append('g')
      .call(d3.axisLeft(y).ticks(5))
      .selectAll('text').style('font-size', '9px');

    // Y 轴标签
    svg.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('y', -42).attr('x', -H / 2)
      .attr('text-anchor', 'middle')
      .style('font-size', '9px').style('fill', '#6b7280')
      .text('Count');

    // X 轴基线
    svg.append('line')
      .attr('x1', 0).attr('y1', H).attr('x2', W).attr('y2', H)
      .attr('stroke', '#d1d5db').attr('stroke-width', 1);

    // 柱子
    bars.forEach(b => {
      svg.append('rect')
        .attr('x', b.x).attr('y', y(b.value))
        .attr('width', barW).attr('height', Math.max(0, H - y(b.value)))
        .attr('fill', b.color).attr('opacity', 0.85).attr('rx', 2)
        .style('cursor', 'pointer')
        .on('mouseenter', function(event) {
          const rect = containerRef.current.getBoundingClientRect();
          setTooltip({ x: event.clientX - rect.left, y: event.clientY - rect.top - 40, content: b.desc });
        })
        .on('mouseleave', () => setTooltip(null));

      // 柱顶数值
      svg.append('text')
        .attr('x', b.x + barW / 2).attr('y', y(b.value) - 5)
        .attr('text-anchor', 'middle').attr('fill', '#374151')
        .style('font-size', '9px').style('font-weight', 'bold')
        .text(b.value.toFixed(2));
    });

    // X 轴标签
    const xLabels = [
      { x: jcDbX  + barW / 2, text: 'avg', italic: false },
      { x: jcFuX  + barW / 2, text: shortName,    italic: true  },
      { x: spDbX  + barW / 2, text: 'avg', italic: false },
      { x: spFuX  + barW / 2, text: shortName,    italic: true  },
    ];
    xLabels.forEach(l => {
      svg.append('text')
        .attr('transform', `translate(${l.x},${H + 6}) rotate(-40)`)
        .attr('text-anchor', 'end')
        .style('font-size', l.italic ? '7px' : '9px')
        .style('font-style', l.italic ? 'italic' : 'normal')
        .style('fill', l.italic ? '#6366f1' : '#374151')
        .text(l.text);
    });

    // 组标签
    const jcGroupCenterX = (jcDbX + barW / 2 + jcFuX + barW / 2) / 2;
    const spGroupCenterX = (spDbX + barW / 2 + spFuX + barW / 2) / 2;
    svg.append('text')
      .attr('x', jcGroupCenterX).attr('y', H + 55)
      .attr('text-anchor', 'middle')
      .style('font-size', '9px').style('font-weight', 'bold').style('fill', '#3b82f6')
      .text('Junction Reads');
    svg.append('text')
      .attr('x', spGroupCenterX).attr('y', H + 55)
      .attr('text-anchor', 'middle')
      .style('font-size', '9px').style('font-weight', 'bold').style('fill', '#10b981')
      .text('Spanning Frag');

    // 组间虚线分隔
    const sepX = jcFuX + barW + outerGap / 2;
    svg.append('line')
      .attr('x1', sepX).attr('y1', -8).attr('x2', sepX).attr('y2', H)
      .attr('stroke', '#e2e8f0').attr('stroke-width', 1).attr('stroke-dasharray', '3,3');

    // 显著性标注（星号放在融合柱子正上方，非显著标注NS）
    const drawSig = (fuBar, sigText) => {
      const starX = fuBar.x + barW / 2;
      const starY = y(fuBar.value) - 16;
      const isNs = !sigText || sigText === 'ns';
      const sigColor = isNs ? '#9ca3b8' : (sigText === '***' ? '#dc2626' : sigText === '**' ? '#ea580c' : '#ca8a04');
      svg.append('text')
        .attr('x', starX).attr('y', starY)
        .attr('text-anchor', 'middle')
        .style('font-size', isNs ? '8px' : '11px').style('font-weight', 'bold').style('fill', sigColor)
        .text(isNs ? 'NS' : sigText);
    };

    drawSig(bars[1], getSignificance(avgJunction, CL_AVG_JC));
    drawSig(bars[3], getSignificance(avgSpanning, CL_AVG_SP));

  }, [data, fusionName, dbAvgJunction, dbAvgSpanning]);

  if (!data || data.length === 0) {
    return <div className="w-[350px] h-[260px] flex items-center justify-center text-slate-400 text-xs">{FD.chartNoData}</div>;
  }

  return (
    <div ref={containerRef} className="relative">
      <svg ref={svgRef}></svg>
      {tooltip && (
        <div
          className="absolute z-50 px-2 py-1 bg-slate-800 text-white text-xs rounded shadow-lg whitespace-nowrap pointer-events-none"
          style={{ left: tooltip.x, top: tooltip.y, transform: 'translateX(-50%)' }}
        >
          {tooltip.content}
        </div>
      )}
    </div>
  );
};

// ════════════════════════════════════════════════════════════════════════════
// MiniNetworkView（与 FusionDetail.jsx 完全一致）
// ════════════════════════════════════════════════════════════════════════════
const MiniNetworkView = ({ data, reverseData = [], fusionName, onEdgeClick }) => {
  const svgRef = useRef();
  const containerRef = useRef();
  const [tooltip, setTooltip] = useState(null);
  const { t } = useLanguage();
  const FD = t.fusionDetail;
  const forwardLabel = FD.forwardFusion;
  const clickJump = FD.clickToJump;

  useEffect(() => {
    if (!data || data.length === 0) return;
    d3.select(svgRef.current).selectAll('*').remove();

    const width = 340;
    const height = 240;

    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height);

    const defs = svg.append('defs');
    defs.append('marker')
      .attr('id', 'mini-arrowhead')
      .attr('viewBox', '0 -2 4 4')
      .attr('refX', 4).attr('refY', 0)
      .attr('markerWidth', 3).attr('markerHeight', 3)
      .attr('orient', 'auto')
      .append('path').attr('d', 'M0,-2L4,0L0,2').attr('fill', '#6366f1');

    defs.append('marker')
      .attr('id', 'mini-arrowhead-reverse')
      .attr('viewBox', '0 -2 4 4')
      .attr('refX', 4).attr('refY', 0)
      .attr('markerWidth', 3).attr('markerHeight', 3)
      .attr('orient', 'auto')
      .append('path').attr('d', 'M0,-2L4,0L0,2').attr('fill', '#f59e0b');

    const g = svg.append('g');

    const cleanGeneName = (gene) => {
      if (!gene) return '';
      let cleaned = gene.split('^')[0];
      cleaned = cleaned.replace(/ENSG\d+_/g, '');
      cleaned = cleaned.replace(/\^ENS[GT]\d+/g, '');
      cleaned = cleaned.replace(/\.\d+$/, '');
      return cleaned.trim();
    };

    const reverseFusionName = fusionName ? fusionName.split('--').reverse().join('--') : '';

    const leftGenes = new Set();
    const rightGenes = new Set();
    const edgeMap = new Map();

    data.forEach(d => {
      const left = cleanGeneName(d.left_gene || '');
      const right = cleanGeneName(d.right_gene || '');
      if (left && right && left !== right) {
        leftGenes.add(left);
        rightGenes.add(right);
        const key = `${left}->${right}`;
        if (!edgeMap.has(key)) {
          edgeMap.set(key, { source: left, target: right, fq: 0, count: 0, fusionName: fusionName || '', direction: 'forward' });
        }
        const edge = edgeMap.get(key);
        edge.fq += (d.fq || 1);
        edge.count += 1;
      }
    });

    reverseData.forEach(d => {
      const left = cleanGeneName(d.left_gene || '');
      const right = cleanGeneName(d.right_gene || '');
      if (left && right && left !== right) {
        leftGenes.add(left);
        rightGenes.add(right);
        const key = `${left}->${right}`;
        if (!edgeMap.has(key)) {
          edgeMap.set(key, { source: left, target: right, fq: 0, count: 0, fusionName: reverseFusionName, direction: 'reverse' });
        }
        const edge = edgeMap.get(key);
        edge.fq += (d.fq || 1);
        edge.count += 1;
      }
    });

    const edges = Array.from(edgeMap.values());
    const allGenes = new Set([...leftGenes, ...rightGenes]);

    const nodeFqMap = new Map();
    const nodeCountMap = new Map();
    edges.forEach(e => {
      nodeFqMap.set(e.source, (nodeFqMap.get(e.source) || 0) + e.fq);
      nodeFqMap.set(e.target, (nodeFqMap.get(e.target) || 0) + e.fq);
      nodeCountMap.set(e.source, (nodeCountMap.get(e.source) || 0) + e.count);
      nodeCountMap.set(e.target, (nodeCountMap.get(e.target) || 0) + e.count);
    });

    const nodes = Array.from(allGenes).map(id => ({
      id,
      totalFq: nodeFqMap.get(id) || 1,
      variantCount: nodeCountMap.get(id) || 1
    }));

    if (nodes.length === 0) return;

    const maxEdgeFq = Math.max(...edges.map(e => e.fq), 1);
    const strokeScale = d3.scaleLinear().domain([1, maxEdgeFq]).range([1.5, 5]);

    const maxNodeFq = Math.max(...nodes.map(n => n.totalFq), 1);
    const radiusScale = d3.scaleSqrt().domain([1, maxNodeFq]).range([14, 22]);

    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(edges).id(d => d.id).distance(120))
      .force('charge', d3.forceManyBody().strength(-200))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(d => radiusScale(d.totalFq) + 10));

    const linkGroup = g.selectAll('.link-group')
      .data(edges).enter().append('g').attr('class', 'link-group');

    const link = linkGroup.append('path')
      .attr('fill', 'none')
      .attr('stroke', d => d.direction === 'reverse' ? '#f59e0b' : '#6366f1')
      .attr('stroke-width', d => strokeScale(d.fq))
      .attr('stroke-opacity', 0.7)
      .attr('marker-end', d => d.direction === 'reverse' ? 'url(#mini-arrowhead-reverse)' : 'url(#mini-arrowhead)')
      .style('cursor', d => d.fusionName ? 'pointer' : 'default')
      .on('click', function(event, d) { if (d.fusionName && onEdgeClick) onEdgeClick(d.fusionName); })
      .on('mouseenter', function(event, d) {
        d3.select(this).attr('stroke-opacity', 1).attr('stroke-width', strokeScale(d.fq) + 1.5);
        const rect = containerRef.current.getBoundingClientRect();
        setTooltip({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top - 40,
          lines: [
            d.direction === 'reverse' ? FD.reverseFusionLabel(d.fusionName) : forwardLabel,
            FD.variantFqInfo(d.count, d.fq),
            d.direction === 'reverse' ? clickJump : ''
          ].filter(Boolean)
        });
      })
      .on('mouseleave', function(event, d) {
        d3.select(this).attr('stroke-opacity', 0.7).attr('stroke-width', strokeScale(d.fq));
        setTooltip(null);
      });

    const linkLabel = linkGroup.append('text')
      .attr('text-anchor', 'middle').attr('dy', -8)
      .style('font-size', '8px').style('font-weight', 'bold')
      .style('fill', d => d.direction === 'reverse' ? '#d97706' : '#6366f1')
      .style('pointer-events', 'none')
      .text(d => d.fq);

    const node = g.selectAll('.node')
      .data(nodes).enter().append('g')
      .style('cursor', 'pointer')
      .on('mouseenter', function(event, d) {
        const rect = containerRef.current.getBoundingClientRect();
        setTooltip({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top - 40,
          lines: [FD.nodeInfo(d.id, d.variantCount, d.totalFq)]
        });
      })
      .on('mouseleave', () => setTooltip(null));

    node.append('circle')
      .attr('r', d => radiusScale(d.totalFq))
      .attr('fill', d => leftGenes.has(d.id) ? '#3b82f6' : '#10b981')
      .attr('stroke', '#fff').attr('stroke-width', 2);

    node.append('text')
      .attr('text-anchor', 'middle').attr('dy', 4)
      .style('font-size', '9px').style('font-weight', 'bold').style('fill', '#fff')
      .style('pointer-events', 'none')
      .text(d => d.totalFq);

    node.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', d => radiusScale(d.totalFq) + 12)
      .style('font-size', '9px').style('fill', '#374151')
      .style('pointer-events', 'none')
      .text(d => d.id.length > 10 ? d.id.slice(0, 8) + '..' : d.id);

    simulation.on('tick', () => {
      nodes.forEach(d => {
        d.x = Math.max(35, Math.min(width - 35, d.x));
        d.y = Math.max(30, Math.min(height - 35, d.y));
      });

      const curvature = 70;

      link.attr('d', d => {
        const sx = d.source.x, sy = d.source.y;
        const tx = d.target.x, ty = d.target.y;
        const dx = tx - sx, dy = ty - sy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist === 0) return '';
        const targetRadius = radiusScale(d.target.totalFq) + 3;
        const ex = tx - (dx / dist) * targetRadius;
        const ey = ty - (dy / dist) * targetRadius;
        const offset = d.direction === 'reverse' ? curvature : -curvature;
        const mx = (sx + ex) / 2 + (dy / dist) * offset;
        const my = (sy + ey) / 2 - (dx / dist) * offset;
        return `M${sx},${sy} Q${mx},${my} ${ex},${ey}`;
      });

      linkLabel
        .attr('x', d => {
          const sx = d.source.x, sy = d.source.y;
          const tx = d.target.x, ty = d.target.y;
          const dx = tx - sx, dy = ty - sy;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const targetRadius = radiusScale(d.target.totalFq) + 3;
          const ex = tx - (dx / dist) * targetRadius;
          const offset = d.direction === 'reverse' ? curvature : -curvature;
          const mx = (sx + ex) / 2 + (dy / dist) * offset;
          return 0.25 * sx + 0.5 * mx + 0.25 * ex;
        })
        .attr('y', d => {
          const sx = d.source.x, sy = d.source.y;
          const tx = d.target.x, ty = d.target.y;
          const dx = tx - sx, dy = ty - sy;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const targetRadius = radiusScale(d.target.totalFq) + 3;
          const ey = ty - (dy / dist) * targetRadius;
          const offset = d.direction === 'reverse' ? curvature : -curvature;
          const my = (sy + ey) / 2 - (dx / dist) * offset;
          return 0.25 * sy + 0.5 * my + 0.25 * ey - 5;
        });

      node.attr('transform', d => `translate(${d.x},${d.y})`);
    });

    return () => simulation.stop();
  }, [data, reverseData, fusionName, onEdgeClick]);

  if (!data || data.length === 0) {
    return <div className="w-[340px] h-[240px] flex items-center justify-center text-slate-400 text-xs">{FD.networkNoData}</div>;
  }

  return (
    <div ref={containerRef} className="relative">
      <svg ref={svgRef}></svg>
      {tooltip && (
        <div className="absolute z-50 px-2 py-1 bg-slate-800 text-white text-xs rounded shadow-lg whitespace-nowrap pointer-events-none"
          style={{ left: tooltip.x, top: tooltip.y, transform: 'translateX(-50%)' }}>
          {tooltip.lines.map((line, i) => <div key={i}>{line}</div>)}
        </div>
      )}
      <div className="absolute bottom-1 right-1 flex flex-wrap items-center gap-2 text-xs bg-white/80 px-1.5 py-0.5 rounded">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block"></span>{FD.legend5prime}</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block"></span>{FD.legend3prime}</span>
        <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-indigo-500 inline-block"></span>{FD.legendForward}</span>
        <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-amber-400 inline-block"></span>{FD.legendReverse}</span>
      </div>
    </div>
  );
};

// ════════════════════════════════════════════════════════════════════════════
// StatCard（与 FusionDetail.jsx 一致，仅变体条目显示改为 V{variant_num}）
// ════════════════════════════════════════════════════════════════════════════
const StatCard = ({ title, value, color, variants, onVariantClick }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const { t } = useLanguage();
  const FD = t.fusionDetail;

  const colorClasses = {
    blue:   'from-blue-50 to-blue-100 border-blue-200 text-blue-600',
    green:  'from-green-50 to-green-100 border-green-200 text-green-600',
    amber:  'from-amber-50 to-amber-100 border-amber-200 text-amber-600',
    purple: 'from-purple-50 to-purple-100 border-purple-200 text-purple-600'
  };
  const textColors = {
    blue: 'text-blue-700', green: 'text-green-700',
    amber: 'text-amber-700', purple: 'text-purple-700'
  };

  const handleCardClick = (e) => {
    if (e.target.closest('.variant-item')) return;
    setIsExpanded(!isExpanded);
  };

  return (
    <div className="relative">
      <div
        className={`bg-gradient-to-br ${colorClasses[color]} rounded-lg p-3 border cursor-pointer transition hover:shadow-md ${isExpanded ? 'ring-2 ring-offset-1 ring-blue-400' : ''}`}
        onClick={handleCardClick}
      >
        <div className="flex items-center justify-between">
          <div>
            <div className={`text-2xl font-bold ${colorClasses[color].split(' ').pop()}`}>{value}</div>
            <div className={`text-xs ${textColors[color]}`}>{title}</div>
          </div>
          {variants && variants.length > 0 && (
            <div className={`text-xs ${textColors[color]}`}>
              {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </div>
          )}
        </div>
      </div>

      {isExpanded && variants && variants.length > 0 && (
        <div className="absolute z-50 left-0 top-full mt-2 w-80 max-h-80 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-xl">
          <div className="sticky top-0 bg-white text-xs font-bold text-slate-700 p-3 border-b flex items-center justify-between">
            <span>{FD.variantListHeader(title, variants.length)}</span>
            <button onClick={(e) => { e.stopPropagation(); setIsExpanded(false); }} className="text-slate-400 hover:text-slate-600">
              <X size={14} />
            </button>
          </div>
          <div className="p-2 space-y-2">
            {variants.map((v, idx) => (
              <div
                key={v.id || idx}
                className="variant-item text-xs p-2 bg-slate-50 rounded hover:bg-amber-50 cursor-pointer transition border border-transparent hover:border-amber-200"
                onClick={(e) => {
                  e.stopPropagation();
                  onVariantClick && onVariantClick(v);
                  setIsExpanded(false);
                }}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono font-bold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded">
                    {t.arriba && t.arriba.variantLabel
                      ? t.arriba.variantLabel(v.variant_num || (idx + 1))
                      : `Variant ${v.variant_num || (idx + 1)}`}
                  </span>
                  <span className="text-green-600 font-bold">FQ: {v.fq || 0}</span>
                </div>
                <div className="text-slate-600 truncate">
                  {v.left_breakpoint || 'N/A'} → {v.right_breakpoint || 'N/A'}
                </div>
                <div className="text-slate-500 truncate">
                  {FD.fusionTypeLabel} {v.prot_fusion_type || 'N/A'}
                </div>
                {v.cell_line && (
                  <div className="text-slate-500 truncate mt-0.5 text-[10px]">
                    <FlaskConical size={9} className="inline mr-0.5 -mt-0.5" />
                    {v.cell_line}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ════════════════════════════════════════════════════════════════════════════
// InfoTooltip（与 FusionDetail.jsx 完全一致）
// ════════════════════════════════════════════════════════════════════════════
const InfoTooltip = ({ children }) => {
  const [show, setShow] = useState(false);
  return (
    <div className="relative inline-block">
      <HelpCircle
        size={14}
        className="text-slate-400 hover:text-slate-600 cursor-help transition"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
      />
      {show && (
        <div className="absolute z-50 left-6 top-0 w-64 p-3 bg-slate-800 text-white text-xs rounded-lg shadow-lg">
          {children}
          <div className="absolute left-0 top-3 -translate-x-1 w-2 h-2 bg-slate-800 rotate-45"></div>
        </div>
      )}
    </div>
  );
};

// ════════════════════════════════════════════════════════════════════════════
// 主组件
// ════════════════════════════════════════════════════════════════════════════
const CellLineFusionDetail = () => {
  const { fusionName } = useParams();
  const navigate = useNavigate();
  const detailsRef = useRef(null);
  const headerRef = useRef(null);
  const { t } = useLanguage();
  const FD = t.fusionDetail;
  const CL = t.cellLineDetail;
  const GF = t.geneFunction;
  const [columns, setColumns]           = useState([]);
  const [rows, setRows]                 = useState([]);
  const [selectedRow, setSelectedRow]   = useState(null);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState('');
  const [debugInfo, setDebugInfo]       = useState(null);

  // 反向融合
  const [reverseRows, setReverseRows]   = useState([]);

  // 可视化模式（★ 仅保留 Arriba Pro view）
  // const [visualMode] — 已移除，只使用 Arriba
  // const [showBothDiagrams] — 已移除

  // 粘性头部
  const [isSticky, setIsSticky] = useState(false);

  // cellfusion 专属：Cell Line / Tissue / Disease 聚合摘要
  const [aggregated, setAggregated] = useState({});

  // ★ 该融合是否也存在于 PASS Target 库（用于显示切换按钮）
  const [passExists, setPassExists] = useState(false);

  // ★ UniProt IDs for gene structure links (AlphaFold + UniProt)
  const [geneUniprotIds, setGeneUniprotIds] = useState({ left: null, right: null });

  // 粘性头部滚动监听
  useEffect(() => {
    const handleScroll = () => {
      if (headerRef.current) {
        const rect = headerRef.current.getBoundingClientRect();
        setIsSticky(rect.top <= 0);
      }
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // 1. 加载 cellfusion 数据（★ 先检查 PASS 是否也有该融合，有则重定向）
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        setError('');

        // ─── Step 0: 检查 PASS 是否也有该融合 ─────────────────────────────────
        // 不自动跳转，而是设置 passExists 状态，在页面上显示切换按钮
        console.log('[CellFusion] 检查 PASS 是否存在该融合:', fusionName);
        try {
          const passRes = await fetchWithAuth(
            `/api/fusion/by-name/${encodeURIComponent(fusionName)}`
          );
          if (passRes.ok) {
            const passJson = await passRes.json();
            if (passJson?.code === 200 && passJson.data?.items?.length > 0) {
              console.log('[CellFusion] PASS 也存在该融合，显示切换按钮');
              setPassExists(true);
            }
          }
        } catch (e) {
          console.warn('[CellFusion] PASS 检查失败:', e);
        }

        // ─── Step 1: 正式加载 cellfusion 数据 ──────────────────────────────
        console.log('[CellFusion] 请求 cellfusion 数据:', fusionName);

        const res = await fetchWithAuth(
          `/api/cellfusion/by-name/${encodeURIComponent(fusionName)}`
        );

        if (!res.ok) {
          const errorText = await res.text();
          console.error('[CellFusion] 请求失败:', res.status, errorText);
          throw new Error(`API ${res.status}: ${errorText}`);
        }

        const json = await res.json();
        console.log('[CellFusion] 返回数据:', json);

        if (json.code === 200 && json.data) {
          const items = json.data.items || [];
          const cols  = json.data.columns || (items.length > 0 ? Object.keys(items[0]) : []);

          console.log(`[CellFusion] 找到 ${items.length} 个变体`);
          console.log('[CellFusion] ★ aggregated:', json.data.aggregated);
          console.log('[CellFusion] ★ disease_fq:', json.data.aggregated?.disease_fq);

          // 后端已按 fq 降序，这里保险起见再排序一次
          const sortedItems = [...items].sort((a, b) => (b.fq || 0) - (a.fq || 0));

          setRows(sortedItems);
          setColumns(cols);
          setAggregated(json.data.aggregated || {});
          setDebugInfo({
            total: items.length,
            columns: cols.length,
            hasBreakpoints: items.some(r => r.left_breakpoint && r.right_breakpoint),
          });

          if (sortedItems.length > 0) {
            setSelectedRow(sortedItems[0]);
          }
        } else {
          throw new Error(json.message || 'Data format error');
        }
      } catch (err) {
        console.error('[CellFusion] Load failed:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [fusionName]);

  // 2. 加载反向融合（★ Cell Line 页面：仅查 cellfusion 表，不查 PASS）
  useEffect(() => {
    if (!fusionName) return;
    const parts = fusionName.split('--');
    if (parts.length !== 2) return;
    const reverseName = `${parts[1]}--${parts[0]}`;

    const fetchReverse = async () => {
      try {
        const res = await fetchWithAuth(`/api/cellfusion/by-name/${encodeURIComponent(reverseName)}`);
        if (res.ok) {
          const json = await res.json();
          if (json?.code === 200 && json.data?.items?.length > 0) {
            setReverseRows(json.data.items);
            return;
          }
        }
      } catch {}
      setReverseRows([]);
    };
    fetchReverse();
  }, [fusionName]);

  // 3. 查询 UniProt IDs for gene structure links (AlphaFold + UniProt)
  useEffect(() => {
    if (!selectedRow) return;
    const searchUniProt = async (rawGeneName) => {
      const geneName = (rawGeneName || '').split('^')[0].split('(')[0].split(/[,\s\|\;]/)[0].trim();
      if (!geneName) return null;
      try {
        const response = await fetch(`https://rest.uniprot.org/uniprotkb/search?query=gene:${encodeURIComponent(geneName)}+AND+organism_id:9606&format=json&size=1`);
        if (!response.ok) return null;
        const data = await response.json();
        return data.results?.[0]?.primaryAccession || null;
      } catch { return null; }
    };
    const fetchIds = async () => {
      const leftGene = selectedRow.left_gene_full || selectedRow.left_gene;
      const rightGene = selectedRow.right_gene_full || selectedRow.right_gene;
      const [leftId, rightId] = await Promise.all([searchUniProt(leftGene), searchUniProt(rightGene)]);
      setGeneUniprotIds({ left: leftId, right: rightId });
    };
    fetchIds();
  }, [selectedRow?.left_gene, selectedRow?.right_gene]);

  // 选中变体
  const handleSelectVariant = (row) => {
    console.log('[CellFusion] 选中变体:', row.id);
    setSelectedRow(row);
  };

  // 网络图边点击跳转
  const handleNetworkEdgeClick = (targetFusionName) => {
    if (targetFusionName && targetFusionName !== fusionName) {
      navigate(`/cellfusion-detail/${encodeURIComponent(targetFusionName)}`);
    }
  };

  // 汇总数据
  const totalFq            = rows.reduce((sum, r) => sum + (r.fq || 0), 0);
  const highestFqRow       = rows.length > 0 ? rows[0] : null;
  const avgFfpm            = highestFqRow?.avg_ffpm || 0;
  const inframeVariants    = rows.filter(r => (r.prot_fusion_type || '').toUpperCase() === 'INFRAME');
  const frameshiftVariants = rows.filter(r => (r.prot_fusion_type || '').toUpperCase() === 'FRAMESHIFT');
  const highestFq          = Math.max(...rows.map(r => r.fq || 0), 0);
  const highestFqVariants  = rows.filter(r => r.fq === highestFq);

  const extractEnsgId = (geneStr) => {
    if (!geneStr) return 'N/A';
    const match = geneStr.match(/ENSG\d+\.\d+/);
    return match ? match[0] : geneStr;
  };

  // ── Loading ──
  if (loading) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-500 mb-4"></div>
      <p className="text-amber-600">{FD.loading}</p>
      <p className="text-xs text-slate-400 mt-2">{fusionName}</p>
    </div>
  );

  // ── Error ──
  if (error || rows.length === 0) return (
    <div className="min-h-screen p-10 bg-slate-50">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-xl shadow-sm border-2 border-red-200 p-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="text-red-500 mt-1" size={24} />
            <div className="flex-1">
              <h2 className="text-xl font-bold text-red-700 mb-2">{FD.loadFailTitle}</h2>
              <p className="text-red-600 mb-4">{error || FD.loadFailDefault}</p>
              <div className="bg-red-50 rounded-lg p-4 mb-4">
                <p className="text-sm text-red-800 font-bold mb-2">{FD.debugLabel}</p>
                <div className="text-xs text-red-700 space-y-1 font-mono">
                  <div>{FD.debugFusionName}: {fusionName}</div>
                  <div>API: /api/cellfusion/by-name/{fusionName}</div>
                  {debugInfo && (
                    <>
                      <div>{FD.debugRecords}: {debugInfo.total}</div>
                      <div>{FD.debugColumns}: {debugInfo.columns}</div>
                    </>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => navigate(-1)} className="px-4 py-2 bg-blue-100 hover:bg-blue-200 rounded text-blue-700 transition">{FD.backBtn}</button>
                <button onClick={() => window.location.reload()} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded text-slate-700 transition">{FD.reloadBtn}</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // ════════════════════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-slate-50">
      {/* === 粘性头部占位 === */}
      <div ref={headerRef} className="h-0"></div>

      {/* === 粘性顶部栏 === */}
      <div className={`${isSticky ? 'fixed top-0 left-0 right-0 z-50 shadow-md' : ''} bg-white border-b border-slate-200 transition-shadow`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-5">
            {/* Left: Back to list */}
            <div className="flex items-center">
              <button
                onClick={() => navigate(-1)}
                className="flex items-center gap-2 text-slate-600 hover:text-blue-600 px-3 py-1.5 rounded-lg hover:bg-slate-50 transition"
              >
                <ArrowLeft size={18} /> {FD.backToList}
              </button>
            </div>

            {/* Center: Drug Sensitivity button + Fusion name + Cell Line badge */}
            <div className="min-w-0 flex items-center justify-center gap-3">
              <button
                onClick={() => navigate(`/drug-sensitivity/${encodeURIComponent(fusionName)}`)}
                className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-100 hover:bg-emerald-200 text-emerald-700 rounded-lg text-xs font-semibold transition"
                title="Drug Sensitivity Analysis"
              >
                <Activity size={13} />
                Drug Sensitivity Analysis
              </button>
              <h1 className="text-2xl font-bold text-slate-800 truncate">{fusionName}</h1>
              <span className="shrink-0 px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-xs font-bold flex items-center gap-1">
                <FlaskConical size={12} /> Cell Line
              </span>
            </div>

            {/* Right: View Target Data + FQ */}
            <div className="flex items-center gap-3 justify-end">
              {passExists && (
                <button
                  onClick={() => navigate(`/fusion/${encodeURIComponent(fusionName)}`)}
                  className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-xs font-medium transition shadow-sm whitespace-nowrap"
                >
                  <Dna size={13} />
                  <span>{CL.viewTargetData}</span>
                  <ExternalLink size={12} />
                </button>
              )}
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-slate-500">FQ:</span>
                <span className="px-3 py-1 bg-amber-100 text-amber-700 rounded font-bold text-base">{totalFq}</span>
                <span className="text-slate-400">/</span>
                <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded font-bold">{1019}</span>
                <span className="text-slate-400 text-xs">{FD.sampleCount}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* === 主内容区 === */}
      <div className={`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6 ${isSticky ? 'pt-20' : ''}`}>

        {/* ★ 已移除：可选融合分析模块（转录组 / 临床 / 药敏）*/}

        {/* === 融合概览信息区 === */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* 左：Fusion Information */}
            <div className="lg:col-span-1">
              <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                <Database size={16} className="text-blue-500" />
                {FD.fusionInfoTitle}
              </h3>
              <table className="w-full text-xs">
                <tbody className="divide-y divide-slate-100">
                  <tr className="hover:bg-slate-50">
                    <td className="py-2 pr-3 text-slate-500 font-medium whitespace-nowrap">{CL.fusionNameLabel}</td>
                    <td className="py-2 text-slate-800 font-mono">{fusionName}</td>
                  </tr>
                  <tr className="hover:bg-slate-50">
                    <td className="py-2 pr-3 text-slate-500 font-medium whitespace-nowrap">{CL.leftGeneLabel}</td>
                    <td className="py-2 text-slate-800 font-mono">{extractEnsgId(highestFqRow?.left_gene)}</td>
                  </tr>
                  <tr className="hover:bg-slate-50">
                    <td className="py-2 pr-3 text-slate-500 font-medium whitespace-nowrap">{CL.rightGeneLabel}</td>
                    <td className="py-2 text-slate-800 font-mono">{extractEnsgId(highestFqRow?.right_gene)}</td>
                  </tr>
                  <tr className="hover:bg-slate-50">
                    <td className="py-2 pr-3 text-slate-500 font-medium whitespace-nowrap">{CL.functionLeftLabel}</td>
                    <td className="py-2 text-slate-800">{highestFqRow?.result_function_left || 'N/A'}</td>
                  </tr>
                  <tr className="hover:bg-slate-50">
                    <td className="py-2 pr-3 text-slate-500 font-medium whitespace-nowrap">{CL.functionRightLabel}</td>
                    <td className="py-2 text-slate-800">{highestFqRow?.result_function_right || 'N/A'}</td>
                  </tr>
                  <tr className="hover:bg-slate-50">
                    <td className="py-2 pr-3 text-slate-500 font-medium whitespace-nowrap">{CL.avgFfpmLabel}</td>
                    <td className="py-2 text-slate-800 font-bold">{avgFfpm.toFixed(4)}</td>
                  </tr>
                  <tr className="hover:bg-slate-50">
                    <td className="py-2 pr-3 text-slate-500 font-medium whitespace-nowrap">{CL.totalFqLabel}</td>
                    <td className="py-2 text-amber-600 font-bold">{totalFq}</td>
                  </tr>
                  {/* ★ 新增：Cell Line / Tissue / Disease 可展开行 */}
                  <ExpandableInfoField label="Cell Line" value={aggregated.cell_line || ''} color="red" />
                  <ExpandableInfoField label="Tissue"    value={aggregated.tissue    || ''} color="purple" fqMap={aggregated.tissue_fq} />
                  <ExpandableInfoField label="Disease"   value={aggregated.disease   || ''} color="orange" fqMap={aggregated.disease_fq} />
                </tbody>
              </table>
            </div>

            {/* 右：变体统计概览 */}
            <div className="lg:col-span-2">
              <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                <BarChart3 size={16} className="text-teal-500" />
                {FD.variantStatsTitle}
              </h3>

              <div className="grid grid-cols-4 gap-3 mb-4">
                <StatCard title={FD.totalVariants}  value={rows.length}               color="blue"   variants={rows}               onVariantClick={handleSelectVariant} />
                <StatCard title="In-frame"          value={inframeVariants.length}    color="green"  variants={inframeVariants}    onVariantClick={handleSelectVariant} />
                <StatCard title="Frameshift"        value={frameshiftVariants.length} color="amber"  variants={frameshiftVariants} onVariantClick={handleSelectVariant} />
                <StatCard title={FD.highestFQ}      value={highestFq}                 color="purple" variants={highestFqVariants}  onVariantClick={handleSelectVariant} />
              </div>

              {/* 小型图表并排 */}
              <div className="grid grid-cols-2 gap-4">
                <div className="border border-slate-200 rounded-lg p-2 bg-slate-50">
                  <div className="text-xs font-medium text-slate-600 mb-1 text-center">{FD.junctionDistTitle}</div>
                  <MiniJunctionSpanningChart
                    data={rows}
                    fusionName={fusionName}
                    dbAvgJunction={aggregated.global_avg_junction}
                    dbAvgSpanning={aggregated.global_avg_spanning}
                  />
                </div>
                <div className="border border-slate-200 rounded-lg p-2 bg-slate-50">
                  <div className="text-xs font-medium text-slate-600 mb-1 text-center">{FD.geneNetworkTitle}</div>
                  <MiniNetworkView
                    data={rows}
                    reverseData={reverseRows}
                    fusionName={fusionName}
                    onEdgeClick={handleNetworkEdgeClick}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ★ 已移除：Co-occurring Fusion Analysis（UpSet） */}

        {/* === 基因与断点信息 === */}
        {selectedRow && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-4">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <Dna size={18} className="text-blue-500" />
              {CL.geneInfoTitle || CL.geneBreakpointTitle}
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* 左侧基因 */}
              <div className="space-y-3">
                <div className="bg-blue-50 rounded-lg p-4 border border-blue-200 min-h-[120px]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="text-xs text-blue-600 font-bold mb-2">{CL.leftGeneHeader}</div>
                      <div className="space-y-1 text-sm">
                        <div><span className="text-slate-500 inline-block w-20">{CL.geneNameLabel}</span> <span className="font-bold text-blue-700">{cleanGene(selectedRow.left_gene_full || selectedRow.left_gene)}</span></div>
                        <div className="flex items-start"><span className="text-slate-500 inline-block w-20 flex-shrink-0">{CL.breakpointLabel || 'Breakpoint'}</span> <span className="font-mono text-xs break-all">{selectedRow.left_breakpoint || 'N/A'}</span></div>
                        {(selectedRow.left_break_dinuc || selectedRow.LeftBreakDinuc) && (
                          <div><span className="text-slate-500 inline-block w-20">{CL.dinucLabel}</span> <span className="font-mono text-xs">{selectedRow.left_break_dinuc || selectedRow.LeftBreakDinuc}</span></div>
                        )}
                      </div>
                    </div>
                    {/* UniProt & AlphaFold buttons */}
                    <div className="flex flex-col gap-2 flex-shrink-0">
                      <button
                        onClick={() => geneUniprotIds.left && window.open(`https://www.uniprot.org/uniprot/${geneUniprotIds.left}`, '_blank')}
                        disabled={!geneUniprotIds.left}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white hover:bg-blue-100 disabled:bg-slate-50 disabled:opacity-50 border border-blue-300 disabled:border-slate-200 rounded-lg text-xs font-semibold text-blue-700 disabled:text-slate-400 transition whitespace-nowrap"
                        title={geneUniprotIds.left ? `UniProt: ${geneUniprotIds.left}` : 'UniProt ID not found'}
                      >
                        <ExternalLink size={12} /> UniProt
                      </button>
                      <button
                        onClick={() => geneUniprotIds.left && window.open(`https://alphafold.ebi.ac.uk/entry/${geneUniprotIds.left}`, '_blank')}
                        disabled={!geneUniprotIds.left}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white hover:bg-indigo-100 disabled:bg-slate-50 disabled:opacity-50 border border-indigo-300 disabled:border-slate-200 rounded-lg text-xs font-semibold text-indigo-700 disabled:text-slate-400 transition whitespace-nowrap"
                        title={geneUniprotIds.left ? `AlphaFold: ${geneUniprotIds.left}` : 'UniProt ID not found'}
                      >
                        <ExternalLink size={12} /> AlphaFold
                      </button>
                    </div>
                  </div>
                </div>
                <GeneFunctionCard geneName={selectedRow.left_gene_full || selectedRow.left_gene} side="left" />
              </div>
              {/* 右侧基因 */}
              <div className="space-y-3">
                <div className="bg-purple-50 rounded-lg p-4 border border-purple-200 min-h-[120px]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="text-xs text-purple-600 font-bold mb-2">{CL.rightGeneHeader}</div>
                      <div className="space-y-1 text-sm">
                        <div><span className="text-slate-500 inline-block w-20">{CL.geneNameLabel}</span> <span className="font-bold text-purple-700">{cleanGene(selectedRow.right_gene_full || selectedRow.right_gene)}</span></div>
                        <div className="flex items-start"><span className="text-slate-500 inline-block w-20 flex-shrink-0">{CL.breakpointLabel || 'Breakpoint'}</span> <span className="font-mono text-xs break-all">{selectedRow.right_breakpoint || 'N/A'}</span></div>
                        {(selectedRow.right_break_dinuc || selectedRow.RightBreakDinuc) && (
                          <div><span className="text-slate-500 inline-block w-20">{CL.dinucLabel}</span> <span className="font-mono text-xs">{selectedRow.right_break_dinuc || selectedRow.RightBreakDinuc}</span></div>
                        )}
                      </div>
                    </div>
                    {/* UniProt & AlphaFold buttons */}
                    <div className="flex flex-col gap-2 flex-shrink-0">
                      <button
                        onClick={() => geneUniprotIds.right && window.open(`https://www.uniprot.org/uniprot/${geneUniprotIds.right}`, '_blank')}
                        disabled={!geneUniprotIds.right}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white hover:bg-purple-100 disabled:bg-slate-50 disabled:opacity-50 border border-purple-300 disabled:border-slate-200 rounded-lg text-xs font-semibold text-purple-700 disabled:text-slate-400 transition whitespace-nowrap"
                        title={geneUniprotIds.right ? `UniProt: ${geneUniprotIds.right}` : 'UniProt ID not found'}
                      >
                        <ExternalLink size={12} /> UniProt
                      </button>
                      <button
                        onClick={() => geneUniprotIds.right && window.open(`https://alphafold.ebi.ac.uk/entry/${geneUniprotIds.right}`, '_blank')}
                        disabled={!geneUniprotIds.right}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white hover:bg-indigo-100 disabled:bg-slate-50 disabled:opacity-50 border border-indigo-300 disabled:border-slate-200 rounded-lg text-xs font-semibold text-indigo-700 disabled:text-slate-400 transition whitespace-nowrap"
                        title={geneUniprotIds.right ? `AlphaFold: ${geneUniprotIds.right}` : 'UniProt ID not found'}
                      >
                        <ExternalLink size={12} /> AlphaFold
                      </button>
                    </div>
                  </div>
                </div>
                <GeneFunctionCard geneName={selectedRow.right_gene_full || selectedRow.right_gene} side="right" />
              </div>
            </div>
          </div>
        )}

        {/* === 1. 融合断点图（Arriba Pro view only） === */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4 border-b pb-3">
            <div className="flex items-center gap-2">
              <FileImage className="text-indigo-500" size={20} />
              <h2 className="text-lg font-bold text-slate-800">{FD.diagramTitle}</h2>
              <InfoTooltip>
                <p>{FD.diagramTooltip1}</p>
                <p className="mt-2">{FD.diagramTooltip2}</p>
              </InfoTooltip>
            </div>
          </div>

          {/* ★ 仅显示 Arriba Pro view，移除 Interactive 和 Show Both */}
          <div className="w-full">
            <ArribaFusionDiagram
              fusionName={fusionName}
              allRows={rows}
              selectedRow={selectedRow}
              onSelectVariant={handleSelectVariant}
              showVariantSelector={true}
              apiPrefix="/api/arriba/cellfusion"
            />
          </div>
        </div>

        {/* === 2. 融合蛋白结构预测 === */}
        {/* ★ 注意：FusionProteinPredictor 组件内部已有 "Fusion Protein Structure Prediction" 标题，
             所以这里不再加外层标题，避免重复显示。 */}
        {/* ★ leftGene / rightGene 使用含 ENSG ID 的完整字符串（left_gene_full），
             解决 cellfusion 数据只有纯基因名导致 UniProt ID 查找失败的问题 */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          {selectedRow ? (
            <FusionProteinPredictor
              sequence={selectedRow.fusion_transl}
              fusionName={selectedRow.fusion_name}
              leftGene={selectedRow.left_gene_full || selectedRow.left_gene}
              rightGene={selectedRow.right_gene_full || selectedRow.right_gene}
              variantId={selectedRow.id}
              variantPrefix=""
              variantStorageId={`${selectedRow.fusion_name || fusionName}_${selectedRow.variant_num || (rows.findIndex(r => r.id === selectedRow.id) + 1) || 1}`}
              variantDisplayId={t.arriba && t.arriba.variantLabel ? t.arriba.variantLabel(selectedRow.variant_num || (rows.findIndex(r => r.id === selectedRow.id) + 1) || 1) : `Variant ${selectedRow.variant_num || (rows.findIndex(r => r.id === selectedRow.id) + 1) || 1}`}
              cacheSource="cellfusion"
            />
          ) : (
            <div className="p-10 text-center text-slate-400">
              <Info size={40} className="mx-auto mb-2" />
              <p>{FD.selectRecordHint}</p>
            </div>
          )}
        </div>

        {/* === 3. 详细数据表格 === */}
        {/* <div ref={detailsRef} className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4 border-b pb-2">
            <div className="flex items-center gap-2">
              <Database className="text-green-600" size={20} />
              <h2 className="text-lg font-bold text-slate-800">
                {FD.dataTableTitle(
                  selectedRow
                    ? (t.arriba && t.arriba.variantLabel
                        ? t.arriba.variantLabel(selectedRow.variant_num || 1)
                        : `Variant ${selectedRow.variant_num || 1}`)
                    : 'N/A'
                )}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              {selectedRow && (
                <div className="flex items-center gap-2 mr-4">
                  <span className="text-xs text-slate-500">{FD.fqValueLabel}</span>
                  <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded text-xs font-bold">
                    {selectedRow.fq || 0}
                  </span>
                </div>
              )}
              {selectedRow && (
                <button
                  onClick={() => {
                    const blob = new Blob([JSON.stringify(selectedRow, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${selectedRow.id || fusionName}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="flex items-center gap-1 text-xs bg-slate-100 hover:bg-slate-200 px-3 py-1 rounded text-slate-700 transition"
                >
                  <Download size={14} /> {FD.exportJSON}
                </button>
              )}
            </div>
          </div>

          {selectedRow ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-0 border-t border-l border-slate-200">
              {columns.map((key) => {
                if (key === '_parsed' || key === '_disease_set') return null;

                const val = selectedRow[key];
                const isImportant = ['left_breakpoint', 'right_breakpoint', 'prot_fusion_type', 'avg_ffpm', 'fq', 'cell_line', 'tissue', 'disease', 'id', 'variant_num'].includes(key);

                return (
                  <div
                    key={key}
                    className={`flex flex-col p-3 border-r border-b border-slate-200 hover:bg-slate-50 transition break-words ${
                      isImportant ? 'bg-amber-50' : ''
                    }`}
                  >
                    <span className="text-xs font-bold text-slate-500 uppercase mb-1">
                      {key.replace(/_/g, ' ')}
                    </span>
                    <span className="text-sm font-mono text-slate-800 max-h-32 overflow-y-auto">
                      {val === null || val === '' || val === undefined ? (
                        <span className="text-slate-300">-</span>
                      ) : (
                        String(val)
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-10 text-slate-400">{FD.selectRecordHint2}</div>
          )}
        </div> */}

      </div>
    </div>
  );
};

export default CellLineFusionDetail;
