// src/pages/FusionDetail.jsx - 重新设计布局版本
import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, Activity, Database, Download, Info, AlertCircle, 
  ExternalLink, Heart, Eye, EyeOff, ChevronDown, ChevronUp, X,
  Dna, FileImage, BarChart3, HelpCircle, FlaskConical, BookOpen
} from 'lucide-react';
import * as d3 from 'd3';

// === 引入组件 ===
import MultiVariantFusionDiagram from '../components/MultiVariantFusionDiagram'; 
import ArribaFusionDiagram from '../components/ArribaFusionDiagram';
import FusionProteinPredictor from '../components/FusionProteinPredictor'; 
import { useLanguage } from '../contexts/LanguageContext';

// --- 辅助函数 ---
async function ensureToken() {
  let token = localStorage.getItem('token');
  
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && (payload.exp - now < 300)) {
        console.log('[Token] 即将过期，刷新token...');
        token = null;
      }
    } catch (e) {
      console.error('[Token] 解析失败:', e);
      token = null;
    }
  }
  
  if (!token) {
    try {
      console.log('[Auth] 获取新token...');
      const resp = await fetch('/api/auth/login', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'admin',
          password: 'admin'
        })
      });
      const data = await resp.json();
      token = data?.access_token;
      if (token) {
        localStorage.setItem('token', token);
        console.log('[Auth] Token获取成功');
      }
    } catch (error) {
      console.error('[Auth] Token获取失败:', error);
    }
  }
  return token;
}

async function fetchWithAuth(url, options = {}, retries = 1) {
  const token = await ensureToken();
  
  const response = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${token}`
    }
  });
  
  if (response.status === 401 && retries > 0) {
    console.log('[Auth] 401错误，刷新token后重试...');
    localStorage.removeItem('token');
    return fetchWithAuth(url, options, retries - 1);
  }
  
  return response;
}

// 全库平均参考值（固定常量）
const DB_AVG_JC = 1.92;
const DB_AVG_SP = 0.68;

// 显著性计算：基于融合值与数据库均值的比值
const getSignificance = (fusionVal, dbAvg) => {
  if (dbAvg <= 0 || fusionVal <= 0) return 'ns';
  const ratio = fusionVal / dbAvg;
  if (ratio >= 3) return '***';
  if (ratio >= 2) return '**';
  if (ratio >= 1.3) return '*';
  return 'ns';
};

// ─── 括号感知分割（供 ExpandableInfoField 使用） ───────────────────────
// 以 "," 或 ";" 作为分隔符，但括号内的逗号不会分割
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

// ─── Cell Line / Tissue / Disease 可点击展开行（来自 cellfusion 数据）──
// 只显示第一个条目（单行 truncate），多条时右侧带 "+N" 徽章可展开
const ExpandableInfoField = ({ label, value, color = 'orange' }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const fn = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [open]);

  const items = smartSplit(value);
  const empty = !value || !String(value).trim() || String(value).toLowerCase() === 'n/a' || items.length === 0;
  if (empty) return null;

  const hasMany = items.length > 1;
  const colorMap = { red: 'text-red-700', orange: 'text-orange-700', purple: 'text-purple-700' };
  const textColor = colorMap[color] || colorMap.orange;
  // 展示所有项的连接文本，太长则 truncate
  const displayText = items.join(', ');

  return (
    <tr className="hover:bg-slate-50">
      <td className="py-2 pr-3 text-slate-500 font-medium whitespace-nowrap align-middle">{label}</td>
      <td className="py-2 relative max-w-0" ref={ref}>
        <button
          onClick={() => hasMany && setOpen(o => !o)}
          className={`w-full text-left flex items-center gap-1.5 ${hasMany ? 'cursor-pointer' : 'cursor-default'}`}
          title={displayText}
        >
          <span
            className={`text-xs min-w-0 flex-1 truncate ${textColor} ${hasMany ? 'underline decoration-dotted' : ''}`}
          >
            {displayText}
          </span>
          {hasMany && (
            <span className="flex-shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full text-[10px] font-semibold">
              {items.length} {open ? <ChevronUp size={8}/> : <ChevronDown size={8}/>}
            </span>
          )}
        </button>
        {open && (
          <div className="absolute left-0 top-full mt-1 z-50 w-72 max-w-[92vw] max-h-56 overflow-y-auto bg-gray-900 text-white text-xs rounded-lg py-2 px-3 shadow-2xl">
            <div className="mb-1.5 text-gray-300 font-semibold border-b border-gray-700 pb-1.5 flex items-center justify-between sticky top-0 bg-gray-900">
              <span>{label} ({items.length})</span>
              <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-gray-300"><X size={12}/></button>
            </div>
            {color === 'red'
              ? <div className="flex flex-wrap gap-1 py-1">
                  {items.map((item, i) =>
                    <span key={i} className="px-1.5 py-0.5 bg-gray-700 rounded text-[10px] break-all">{item.trim()}</span>)}
                </div>
              : items.map((item, i) =>
                  <div key={i} className="py-1 border-b border-gray-700 last:border-0 leading-snug break-words">{item}</div>)
            }
          </div>
        )}
      </td>
    </tr>
  );
};

// ─── Tissue 可点击展开行（带计数统计，类似 Disease） ──
const CountableInfoField = ({ label, value, color = 'purple' }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const fn = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [open]);

  const items = smartSplit(value);
  const empty = !value || !String(value).trim() || String(value).toLowerCase() === 'n/a' || items.length === 0;
  if (empty) return null;

  // 计数：统计每个唯一条目出现次数
  const countMap = {};
  items.forEach(item => {
    const trimmed = item.trim();
    if (trimmed) countMap[trimmed] = (countMap[trimmed] || 0) + 1;
  });
  const sortedEntries = Object.entries(countMap).sort((a, b) => b[1] - a[1]);
  const uniqueCount = sortedEntries.length;

  const colorMap = { red: 'text-red-700', orange: 'text-orange-700', purple: 'text-purple-700' };
  const textColor = colorMap[color] || colorMap.purple;
  const firstItem = sortedEntries[0]?.[0] || '';
  const hasMany = uniqueCount > 1;

  return (
    <tr className="hover:bg-slate-50">
      <td className="py-2 pr-3 text-slate-500 font-medium whitespace-nowrap align-middle">{label}</td>
      <td className="py-2 relative max-w-0" ref={ref}>
        <button
          onClick={() => setOpen(o => !o)}
          className="w-full text-left flex items-center gap-1.5 cursor-pointer"
          title={value}
        >
          <span className={`text-xs min-w-0 flex-1 truncate ${textColor} underline decoration-dotted`}>
            {firstItem}
          </span>
          <span className="flex-shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full text-[10px] font-semibold">
            {uniqueCount} {open ? <ChevronUp size={8}/> : <ChevronDown size={8}/>}
          </span>
        </button>
        {open && (
          <div className="absolute left-0 top-full mt-1 z-50 w-72 max-w-[92vw] max-h-56 overflow-y-auto bg-gray-900 text-white text-xs rounded-lg py-2 px-3 shadow-2xl">
            <div className="mb-1.5 text-gray-300 font-semibold border-b border-gray-700 pb-1.5 flex items-center justify-between sticky top-0 bg-gray-900">
              <span>{label} ({uniqueCount})</span>
              <div className="flex items-center gap-2">
                <span className="text-gray-500 text-[10px]">fq</span>
                <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-gray-300"><X size={12}/></button>
              </div>
            </div>
            {sortedEntries.map(([name, count], i) => (
              <div key={i} className="flex items-center justify-between py-1 border-b border-gray-700 last:border-0">
                <span className="leading-snug break-words pr-2 flex-1">{name}</span>
                <span className="font-bold text-amber-300 flex-shrink-0">{count}</span>
              </div>
            ))}
          </div>
        )}
      </td>
    </tr>
  );
};

// ─── Disease 展示行（使用后端 disease_fq 计数） ──
const DiseaseWithFqField = ({ label, fqMap, color = 'orange' }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const fn = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [open]);

  if (!fqMap || typeof fqMap !== 'object' || Object.keys(fqMap).length === 0) return null;

  const sortedEntries = Object.entries(fqMap).sort((a, b) => b[1] - a[1]);
  const uniqueCount = sortedEntries.length;
  const colorMap = { red: 'text-red-700', orange: 'text-orange-700', purple: 'text-purple-700' };
  const textColor = colorMap[color] || colorMap.orange;
  const firstItem = sortedEntries[0]?.[0] || '';

  return (
    <tr className="hover:bg-slate-50">
      <td className="py-2 pr-3 text-slate-500 font-medium whitespace-nowrap align-middle">{label}</td>
      <td className="py-2 relative max-w-0" ref={ref}>
        <button
          onClick={() => setOpen(o => !o)}
          className="w-full text-left flex items-center gap-1.5 cursor-pointer"
          title={sortedEntries.map(([n]) => n).join(', ')}
        >
          <span className={`text-xs min-w-0 flex-1 truncate ${textColor} underline decoration-dotted`}>
            {firstItem}
          </span>
          <span className="flex-shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full text-[10px] font-semibold">
            {uniqueCount} {open ? <ChevronUp size={8}/> : <ChevronDown size={8}/>}
          </span>
        </button>
        {open && (
          <div className="absolute left-0 top-full mt-1 z-50 w-80 max-w-[92vw] max-h-56 overflow-y-auto bg-gray-900 text-white text-xs rounded-lg py-2 px-3 shadow-2xl">
            <div className="mb-1.5 text-gray-300 font-semibold border-b border-gray-700 pb-1.5 flex items-center justify-between sticky top-0 bg-gray-900">
              <span>{label} ({uniqueCount})</span>
              <div className="flex items-center gap-2">
                <span className="text-gray-500 text-[10px]">fq</span>
                <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-gray-300"><X size={12}/></button>
              </div>
            </div>
            {sortedEntries.map(([name, count], i) => (
              <div key={i} className="flex items-center justify-between py-1 border-b border-gray-700 last:border-0">
                <span className="leading-snug break-words pr-2 flex-1">{name}</span>
                <span className="font-bold text-amber-300 flex-shrink-0">{count}</span>
              </div>
            ))}
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

// === 小型 JunctionSpanningChart 组件（含数据库均值对比 + 显著性标注） ===
const MiniJunctionSpanningChart = ({ data, fusionName }) => {
  const svgRef = useRef();
  const containerRef = useRef();
  const [tooltip, setTooltip] = useState(null);
  const { t } = useLanguage();
  const FD = t.fusionDetail;

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

    // 四根柱子等宽，根据可用宽度自动计算
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
      { x: jcDbX,  value: DB_AVG_JC,  color: '#94a3b8', desc: FD.dbAvgJunction(DB_AVG_JC) },
      { x: jcFuX,  value: avgJunction, color: '#3b82f6', desc: FD.fusionJunctionAvg(avgJunction.toFixed(2)) },
      { x: spDbX,  value: DB_AVG_SP,  color: '#94a3b8', desc: FD.dbAvgSpanning(DB_AVG_SP) },
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
    const drawSig = (fuBar, dbBar, sigText) => {
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

    drawSig(bars[1], bars[0], getSignificance(avgJunction, DB_AVG_JC));
    drawSig(bars[3], bars[2], getSignificance(avgSpanning, DB_AVG_SP));

  }, [data, fusionName]);

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

// === 小型 NetworkView 组件 ===
// 支持双向融合：正向箭头（靛蓝）+ 反向箭头（橙色），点击边可跳转对应融合详情页
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

    // 正向箭头（靛蓝色）
    defs.append('marker')
      .attr('id', 'mini-arrowhead')
      .attr('viewBox', '0 -2 4 4')
      .attr('refX', 4)
      .attr('refY', 0)
      .attr('markerWidth', 3)
      .attr('markerHeight', 3)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-2L4,0L0,2')
      .attr('fill', '#6366f1');

    // 反向箭头（橙色）
    defs.append('marker')
      .attr('id', 'mini-arrowhead-reverse')
      .attr('viewBox', '0 -2 4 4')
      .attr('refX', 4)
      .attr('refY', 0)
      .attr('markerWidth', 3)
      .attr('markerHeight', 3)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-2L4,0L0,2')
      .attr('fill', '#f59e0b');

    const g = svg.append('g');

    const cleanGeneName = (gene) => {
      if (!gene) return '';
      let cleaned = gene.split('^')[0];
      cleaned = cleaned.replace(/ENSG\d+_/g, '');
      cleaned = cleaned.replace(/\^ENS[GT]\d+/g, '');
      cleaned = cleaned.replace(/\.\d+$/, '');
      return cleaned.trim();
    };

    // 构建反向融合名（A--B → B--A）
    const reverseFusionName = fusionName
      ? fusionName.split('--').reverse().join('--')
      : '';

    const leftGenes = new Set();
    const rightGenes = new Set();
    const edgeMap = new Map();

    // 正向边
    data.forEach(d => {
      const left = cleanGeneName(d.left_gene || '');
      const right = cleanGeneName(d.right_gene || '');
      if (left && right && left !== right) {
        leftGenes.add(left);
        rightGenes.add(right);
        const key = `${left}->${right}`;
        if (!edgeMap.has(key)) {
          edgeMap.set(key, {
            source: left,
            target: right,
            fq: 0,
            count: 0,
            fusionName: fusionName || '',
            direction: 'forward'
          });
        }
        const edge = edgeMap.get(key);
        edge.fq += (d.fq || 1);
        edge.count += 1;
      }
    });

    // 反向边
    reverseData.forEach(d => {
      const left = cleanGeneName(d.left_gene || '');
      const right = cleanGeneName(d.right_gene || '');
      if (left && right && left !== right) {
        leftGenes.add(left);
        rightGenes.add(right);
        const key = `${left}->${right}`;
        if (!edgeMap.has(key)) {
          edgeMap.set(key, {
            source: left,
            target: right,
            fq: 0,
            count: 0,
            fusionName: reverseFusionName,
            direction: 'reverse'
          });
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
    const strokeScale = d3.scaleLinear()
      .domain([1, maxEdgeFq])
      .range([1.5, 5]);

    const maxNodeFq = Math.max(...nodes.map(n => n.totalFq), 1);
    const radiusScale = d3.scaleSqrt()
      .domain([1, maxNodeFq])
      .range([14, 22]);

    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(edges).id(d => d.id).distance(120))
      .force('charge', d3.forceManyBody().strength(-200))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(d => radiusScale(d.totalFq) + 10));

    const linkGroup = g.selectAll('.link-group')
      .data(edges)
      .enter()
      .append('g')
      .attr('class', 'link-group');

    // 连接线：用 path 绘制贝塞尔曲线（正向向上弯靛蓝，反向向下弯橙色，均可点击跳转）
    const link = linkGroup.append('path')
      .attr('fill', 'none')
      .attr('stroke', d => d.direction === 'reverse' ? '#f59e0b' : '#6366f1')
      .attr('stroke-width', d => strokeScale(d.fq))
      .attr('stroke-opacity', 0.7)
      .attr('marker-end', d =>
        d.direction === 'reverse'
          ? 'url(#mini-arrowhead-reverse)'
          : 'url(#mini-arrowhead)'
      )
      .style('cursor', d => d.fusionName ? 'pointer' : 'default')
      .on('click', function(event, d) {
        if (d.fusionName && onEdgeClick) {
          onEdgeClick(d.fusionName);
        }
      })
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

    // 线条上的FQ标签
    const linkLabel = linkGroup.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', -8)
      .style('font-size', '8px')
      .style('font-weight', 'bold')
      .style('fill', d => d.direction === 'reverse' ? '#d97706' : '#6366f1')
      .style('pointer-events', 'none')
      .text(d => d.fq);

    // 节点组
    const node = g.selectAll('.node')
      .data(nodes)
      .enter()
      .append('g')
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
      .attr('stroke', '#fff')
      .attr('stroke-width', 2);

    node.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', 4)
      .style('font-size', '9px')
      .style('font-weight', 'bold')
      .style('fill', '#fff')
      .style('pointer-events', 'none')
      .text(d => d.totalFq);

    node.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', d => radiusScale(d.totalFq) + 12)
      .style('font-size', '9px')
      .style('fill', '#374151')
      .style('pointer-events', 'none')
      .text(d => d.id.length > 10 ? d.id.slice(0, 8) + '..' : d.id);

    simulation.on('tick', () => {
      nodes.forEach(d => {
        d.x = Math.max(35, Math.min(width - 35, d.x));
        d.y = Math.max(30, Math.min(height - 35, d.y));
      });

      // 贝塞尔曲线路径：正向向上弯（靛蓝），反向向下弯（橙色）
      // curvature 值越大弧度越大，两条弧合拢成椭圆形
      const curvature = 70;

      link.attr('d', d => {
        const sx = d.source.x, sy = d.source.y;
        const tx = d.target.x, ty = d.target.y;
        const dx = tx - sx, dy = ty - sy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist === 0) return '';
        // 箭头终点缩进到目标节点边缘
        const targetRadius = radiusScale(d.target.totalFq) + 3;
        const ex = tx - (dx / dist) * targetRadius;
        const ey = ty - (dy / dist) * targetRadius;
        // 控制点：垂直于连线方向偏移，正向往一侧弯，反向往另一侧弯
        const offset = d.direction === 'reverse' ? curvature : -curvature;
        const mx = (sx + ex) / 2 + (dy / dist) * offset;
        const my = (sy + ey) / 2 - (dx / dist) * offset;
        return `M${sx},${sy} Q${mx},${my} ${ex},${ey}`;
      });

      // FQ标签放在贝塞尔曲线的视觉弧顶（t=0.5的二次贝塞尔点）
      // 公式：P(0.5) = 0.25*start + 0.5*control + 0.25*end
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
          // 二次贝塞尔曲线 t=0.5 处的 x 坐标
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
          // 二次贝塞尔曲线 t=0.5 处的 y 坐标，再偏移 -5px 使标签不压线
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
        <div 
          className="absolute z-50 px-2 py-1 bg-slate-800 text-white text-xs rounded shadow-lg whitespace-nowrap pointer-events-none"
          style={{ left: tooltip.x, top: tooltip.y, transform: 'translateX(-50%)' }}
        >
          {tooltip.lines.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}
      {/* 图例 */}
      <div className="absolute bottom-1 right-1 flex flex-wrap items-center gap-2 text-xs bg-white/80 px-1.5 py-0.5 rounded">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block"></span>{FD.legend5prime}</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block"></span>{FD.legend3prime}</span>
        <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-indigo-500 inline-block"></span>{FD.legendForward}</span>
        {/* 反向箭头图例仅在有反向数据时显示 */}
        <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-amber-400 inline-block"></span>{FD.legendReverse}</span>
      </div>
    </div>
  );
};

// === 变体统计卡片组件（点击展开/收起） ===
const StatCard = ({ title, value, color, variants, onVariantClick }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const { t } = useLanguage();
  const FD = t.fusionDetail;
  
  const colorClasses = {
    blue: 'from-blue-50 to-blue-100 border-blue-200 text-blue-600',
    green: 'from-green-50 to-green-100 border-green-200 text-green-600',
    amber: 'from-amber-50 to-amber-100 border-amber-200 text-amber-600',
    purple: 'from-purple-50 to-purple-100 border-purple-200 text-purple-600'
  };
  
  const textColors = {
    blue: 'text-blue-700',
    green: 'text-green-700',
    amber: 'text-amber-700',
    purple: 'text-purple-700'
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
            <button 
              onClick={(e) => { e.stopPropagation(); setIsExpanded(false); }}
              className="text-slate-400 hover:text-slate-600"
            >
              <X size={14} />
            </button>
          </div>
          <div className="p-2 space-y-2">
            {variants.map((v, idx) => (
              <div 
                key={v.id || idx}
                className="variant-item text-xs p-2 bg-slate-50 rounded hover:bg-blue-50 cursor-pointer transition border border-transparent hover:border-blue-200"
                onClick={(e) => {
                  e.stopPropagation();
                  onVariantClick && onVariantClick(v);
                  setIsExpanded(false);
                }}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono font-bold text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded">
                    TP{v.id}
                  </span>
                  <span className="text-green-600 font-bold">FQ: {v.fq || 0}</span>
                </div>
                <div className="text-slate-600 truncate">
                  {v.left_breakpoint || 'N/A'} → {v.right_breakpoint || 'N/A'}
                </div>
                <div className="text-slate-500 truncate">
                  {FD.fusionTypeLabel} {v.prot_fusion_type || 'N/A'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// === 信息提示组件 ===
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


// =====================================================================
// === 经典融合基因列表（用于 UpSet 共存分析筛选） ===
// =====================================================================
const CLASSIC_FUSIONS = new Set([
  // === AML 经典融合 ===
  'RUNX1--RUNX1T1',        // t(8;21), AML 预后良好
  'PML--RARA',             // t(15;17), APL
  'CBFB--MYH11',           // inv(16), AML 预后良好
  'KMT2A--MLLT3',          // t(9;11), MLL-AF9
  'KMT2A--MLLT1',          // t(11;19), MLL-ENL
  'KMT2A--MLLT10',         // t(10;11), MLL-AF10
  'KMT2A--AFF1',           // t(4;11), MLL-AF4
  'KMT2A--ELL',            // t(11;19), MLL-ELL
  'KMT2A--MLLT4',          // t(6;11), MLL-AF6
  'KMT2A--MLLT6',          // t(11;17), MLL-AF17
  'DEK--NUP214',           // t(6;9)
  'NUP98--NSD1',           // t(5;11), 预后不良
  'NUP98--KDM5A',          // t(11;12)
  'NUP98--HOXA9',          // t(7;11)
  'NUP98--HOXA13',
  'RBM15--MRTFA',          // t(1;22), AMKL
  'RBM15--MKL1',           // t(1;22) 别名
  'CBFA2T3--GLIS2',        // inv(16)(p13.3q24.3), 儿童AMKL
  'FUS--ERG',              // t(16;21)
  'MNX1--ETV6',            // t(7;12)
  'ETV6--MNX1',
  'BCR--ABL1',             // t(9;22), Ph+
  'ETV6--RUNX1',           // t(12;21), ALL 预后良好
  'RUNX1--ETV6',

  // === ALL 经典融合 ===
  'TCF3--PBX1',            // t(1;19), pre-B ALL
  'TCF3--HLF',             // t(17;19), 预后极差
  'ETV6--ABL1',            // t(9;12)
  'IGH--MYC',              // t(8;14), Burkitt
  'MYC--IGH',
  'IGH--BCL2',             // t(14;18), FL
  'BCL2--IGH',
  'P2RY8--CRLF2',          // PAR1 缺失, Ph-like ALL
  'CRLF2--P2RY8',
  'PAX5--ETV6',
  'ETV6--PAX5',
  'MEF2D--BCL9',           // t(1;19)(q23;q13)
  'MEF2D--HNRNPUL1',
  'ZNF384--EP300',
  'ZNF384--TCF3',
  'ZNF384--TAF15',
  'DUX4--IGH',             // DUX4r ALL
  'IGH--DUX4',
  'NUTM1--BRD4',           // NUT midline carcinoma
  'BRD4--NUTM1',
  'ABL1--NUP214',

  // === 实体瘤经典融合 ===
  'EML4--ALK',             // NSCLC
  'ALK--EML4',
  'TMPRSS2--ERG',          // 前列腺癌
  'EWSR1--FLI1',           // Ewing 肉瘤
  'EWSR1--ERG',
  'EWSR1--WT1',            // DSRCT
  'EWSR1--ATF1',           // CCS
  'SS18--SSX1',            // 滑膜肉瘤
  'SS18--SSX2',
  'PAX3--FOXO1',           // ARMS
  'PAX7--FOXO1',
  'COL1A1--PDGFB',         // DFSP
  'NAB2--STAT6',           // SFT
  'FGFR3--TACC3',          // GBM / 膀胱癌
  'RET--CCDC6',            // 甲状腺癌
  'CCDC6--RET',
  'RET--NCOA4',
  'NCOA4--RET',
  'NTRK1--TPM3',           // 各类实体瘤
  'TPM3--NTRK1',
  'NTRK3--ETV6',
  'ETV6--NTRK3',
  'ROS1--CD74',            // NSCLC
  'CD74--ROS1',
  'SLC45A3--BRAF',
  'KIAA1549--BRAF',        // 低级别胶质瘤
  'BRAF--KIAA1549',
  'MYB--QKI',              // 弥漫性星形细胞瘤
  'CLDN18--ARHGAP26',      // 胃癌

  // === MPN / MDS 经典融合 ===
  'JAK2--PCM1',            // MPN
  'PCM1--JAK2',
  'PDGFRA--FIP1L1',        // CEL / MPN
  'FIP1L1--PDGFRA',
  'PDGFRB--ETV6',
  'ETV6--PDGFRB',
  'FGFR1--ZMYM2',
  'ZMYM2--FGFR1',
]);

// =====================================================================
// === UpSet Plot 组件：样本共现融合分析 ===
// =====================================================================
const UpsetPlot = ({ fusionName, upsetData, loading, error }) => {
  const svgRef = useRef();
  const containerRef = useRef();
  const [tooltip, setTooltip] = useState(null);
  const [coTableData, setCoTableData] = useState([]);
  const [coTablePage, setCoTablePage] = useState(1);
  const CO_PAGE_SIZE = 50;
  const { t } = useLanguage();
  const FD = t.fusionDetail;
  // Capture for d3 callbacks
  const sampleCountLabel = t.language === 'zh' ? '样本数' : 'Samples';
  const appearsInLabel = t.language === 'zh'
    ? (n) => `出现在 ${n} 个样本中`
    : (n) => `Appears in ${n} samples`;
  const samplesSuffix = t.language === 'zh' ? (n) => `${n} 个样本` : (n) => `${n} samples`;
  const onlyLabel = t.language === 'zh'
    ? (name) => `仅 ${name.length > 18 ? name.slice(0, 16) + '..' : name}`
    : (name) => `Only ${name.length > 18 ? name.slice(0, 16) + '..' : name}`;
  const coOccurLabel = t.language === 'zh' ? '与其他融合共现' : 'Co-occurs with others';

  useEffect(() => {
    if (!upsetData || !fusionName) return;
    d3.select(svgRef.current).selectAll('*').remove();

    const { sampleFusions } = upsetData;
    // sampleFusions: { sampleId: [fusionName1, fusionName2, ...] }

    // ── Step 1: identify samples with current fusion ──
    const currentSamples = new Set(
      Object.entries(sampleFusions)
        .filter(([, fusions]) => fusions.includes(fusionName))
        .map(([s]) => s)
    );
    if (currentSamples.size === 0) return;

    // ── Step 2: count co-occurring CLASSIC fusions only ──
    const coCount = new Map();
    currentSamples.forEach(s => {
      (sampleFusions[s] || []).forEach(f => {
        if (f !== fusionName && CLASSIC_FUSIONS.has(f)) {
          coCount.set(f, (coCount.get(f) || 0) + 1);
        }
      });
    });

    // ── Step 3: top-10 classic co-occurring fusions ──
    const topOthers = [...coCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, sampleCount]) => ({ name, sampleCount }));

    // display order: top classic fusions first (by count), current fusion last (bottom row)
    const displayFusions = [
      ...topOthers,
      { name: fusionName, sampleCount: currentSamples.size }
    ];
    const fusionIndex = Object.fromEntries(displayFusions.map((f, i) => [f.name, i]));
    const nRows = displayFusions.length;

    // ── Step 4: compute intersections ──
    // 计算与所有经典融合共存的样本数（不仅限于 top 10 展示的）
    const allClassicNames = new Set(coCount.keys());  // 所有共存经典融合名
    let samplesWithAnyClassic = 0;
    currentSamples.forEach(s => {
      const sf = new Set(sampleFusions[s] || []);
      const hasAnyClassic = [...allClassicNames].some(cfn => sf.has(cfn));
      if (hasAnyClassic) samplesWithAnyClassic++;
    });

    // solo = 当前融合的样本数 - 与任何经典融合共存的样本数
    const soloCount = currentSamples.size - samplesWithAnyClassic;

    const interMap = new Map();
    currentSamples.forEach(s => {
      const sf = new Set(sampleFusions[s] || []);
      // which display fusions does this sample have?
      const present = displayFusions.map(f => sf.has(f.name));
      const key = present.map(b => b ? '1' : '0').join('');
      interMap.set(key, (interMap.get(key) || 0) + 1);
    });

    // solo key: 只有最后一位(当前融合)为1，其余全0
    const soloKey = '0'.repeat(nRows - 1) + '1';

    const intersections = [...interMap.entries()]
      .map(([key, count]) => ({
        present: key.split('').map(c => c === '1'),
        count: key === soloKey ? soloCount : count,  // solo列用计算值覆盖
        isSolo: key === soloKey
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    // 如果没有 solo 交集行（所有样本都和经典融合共存），手动插入一个
    if (!intersections.some(d => d.isSolo) && soloCount > 0) {
      const soloPresent = Array(nRows).fill(false);
      soloPresent[nRows - 1] = true;
      intersections.unshift({ present: soloPresent, count: soloCount, isSolo: true });
      intersections.sort((a, b) => b.count - a.count);
      if (intersections.length > 20) intersections.length = 20;
    }

    const nCols = intersections.length;

    // ── Layout constants ──
    const colW    = 40;    // width per intersection column
    const rowH    = 30;    // dot matrix row height
    const dotR    = 9;     // dot radius
    const topBarH = 230;   // height of intersection bar chart area
    const xAxisH  = 28;    // gap between bar chart and dot matrix (x-axis space)
    const labelW  = 155;   // fusion name label width (left side)
    const setBarMaxW = 110; // max width of set-size bar
    const setBarGap  = 18;  // gap between dot matrix right edge and set bars
    const rightPad   = 65;  // right padding for set-bar value labels

    const dotMatrixH = nRows * rowH;
    const dotAreaW   = nCols * colW;
    const contentW = labelW + dotAreaW + setBarGap + setBarMaxW + rightPad;
    const legendMinW = labelW + 420; // 确保图例 "Co-occurs with others" 完整显示
    const svgW = Math.max(contentW, legendMinW);
    const svgH = topBarH + xAxisH + dotMatrixH + 30;

    // ── Origins ──
    // dot matrix origin
    const dotOX = labelW;
    const dotOY = topBarH + xAxisH;

    const svg = d3.select(svgRef.current)
      .attr('width', svgW)
      .attr('height', svgH);

    // ── Y-scale for intersection bars (log scale to handle large solo count) ──
    const maxCount = d3.max(intersections, d => d.count) || 1;
    const yBar = d3.scaleLog()
      .domain([1, maxCount * 1.3])
      .range([topBarH, 0])
      .clamp(true);

    // ── Draw intersection bars (top area) ──
    const barG = svg.append('g')
      .attr('transform', `translate(${dotOX}, 0)`);

    // Y-axis for bars (log scale with nice tick values)
    const logTicks = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000].filter(t => t <= maxCount * 1.3);
    const yAxis = d3.axisLeft(yBar)
      .tickValues(logTicks)
      .tickFormat(d => d >= 1000 ? (d / 1000) + 'k' : d);
    barG.append('g')
      .call(yAxis)
      .selectAll('text')
      .style('font-size', '9px')
      .style('fill', '#6b7280');

    barG.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('x', -topBarH / 2).attr('y', -38)
      .attr('text-anchor', 'middle')
      .style('font-size', '9px')
      .style('fill', '#6b7280')
      .text('Intersection Size (log)');

    // Grid lines
    barG.selectAll('.grid-line')
      .data(logTicks)
      .enter().append('line')
      .attr('x1', 0).attr('x2', dotAreaW)
      .attr('y1', d => yBar(d)).attr('y2', d => yBar(d))
      .attr('stroke', '#f1f5f9').attr('stroke-width', 1);

    intersections.forEach((inter, ci) => {
      const bx = ci * colW + colW / 2;
      const barTop = yBar(Math.max(1, inter.count));
      const bh = topBarH - barTop;
      const bw = colW * 0.65;
      const fill = inter.isSolo ? '#a78bfa' : '#9ca3af';

      barG.append('rect')
        .attr('x', bx - bw / 2).attr('y', barTop)
        .attr('width', bw).attr('height', Math.max(0, bh))
        .attr('fill', fill).attr('rx', 2)
        .style('cursor', 'pointer')
        .on('mouseenter', function(event) {
          d3.select(this).attr('fill', inter.isSolo ? '#7c3aed' : '#6b7280');
          const activeFusions = displayFusions
            .filter((_, ri) => inter.present[ri])
            .map(f => f.name.length > 22 ? f.name.slice(0, 20) + '..' : f.name);
          const rect = containerRef.current.getBoundingClientRect();
          setTooltip({
            x: event.clientX - rect.left,
            y: event.clientY - rect.top - 50,
            lines: [`${sampleCountLabel}: ${inter.count}`, ...activeFusions]
          });
        })
        .on('mouseleave', function() {
          d3.select(this).attr('fill', fill);
          setTooltip(null);
        });

      // Count label on bar — 标注真实数值
      barG.append('text')
        .attr('x', bx).attr('y', barTop - 3)
        .attr('text-anchor', 'middle')
        .style('font-size', '8px').style('fill', '#374151').style('font-weight', 'bold')
        .text(inter.count);
    });

    // ── Draw dot matrix ──
    const dotG = svg.append('g')
      .attr('transform', `translate(${dotOX}, ${dotOY})`);

    // Horizontal alternating row backgrounds
    displayFusions.forEach((_, ri) => {
      dotG.append('rect')
        .attr('x', 0).attr('y', ri * rowH)
        .attr('width', dotAreaW).attr('height', rowH)
        .attr('fill', ri % 2 === 0 ? '#f8fafc' : '#ffffff')
        .attr('stroke', 'none');
    });

    // For each column: draw connecting vertical line then dots
    intersections.forEach((inter, ci) => {
      const cx = ci * colW + colW / 2;

      // Find topmost and bottommost active rows for connecting line
      const activeRows = displayFusions
        .map((_, ri) => inter.present[ri] ? ri : null)
        .filter(ri => ri !== null);

      if (activeRows.length > 1) {
        const lineTop = activeRows[0] * rowH + rowH / 2;
        const lineBot = activeRows[activeRows.length - 1] * rowH + rowH / 2;
        dotG.append('line')
          .attr('x1', cx).attr('y1', lineTop)
          .attr('x2', cx).attr('y2', lineBot)
          .attr('stroke', '#374151').attr('stroke-width', 2);
      }

      // Draw all dots
      displayFusions.forEach((f, ri) => {
        const cy = ri * rowH + rowH / 2;
        const isActive = inter.present[ri];
        dotG.append('circle')
          .attr('cx', cx).attr('cy', cy).attr('r', dotR)
          .attr('fill', isActive ? '#374151' : '#e2e8f0')
          .attr('stroke', isActive ? '#374151' : '#d1d5db')
          .attr('stroke-width', 1);
      });
    });

    // ── Fusion name labels (left of dot matrix) ──
    const labelG = svg.append('g')
      .attr('transform', `translate(0, ${dotOY})`);

    displayFusions.forEach((f, ri) => {
      const cy = ri * rowH + rowH / 2;
      const isCurrentFusion = f.name === fusionName;
      const displayName = f.name.length > 22 ? f.name.slice(0, 20) + '..' : f.name;

      labelG.append('text')
        .attr('x', labelW - 10).attr('y', cy + 4)
        .attr('text-anchor', 'end')
        .style('font-size', '10px')
        .style('font-style', 'italic')
        .style('font-weight', isCurrentFusion ? 'bold' : 'normal')
        .style('fill', isCurrentFusion ? '#7c3aed' : '#374151')
        .style('cursor', 'pointer')
        .text(displayName)
        .on('mouseenter', function(event) {
          const rect = containerRef.current.getBoundingClientRect();
          setTooltip({
            x: event.clientX - rect.left,
            y: event.clientY - rect.top - 30,
            lines: [f.name, appearsInLabel(f.sampleCount)]
          });
        })
        .on('mouseleave', () => setTooltip(null));
    });

    // ── Set-size bars (right of dot matrix) ──
    const setBarOX = dotOX + dotAreaW + setBarGap;
    const maxSetSize = d3.max(displayFusions, f => f.sampleCount) || 1;
    const xSetBar = d3.scaleLinear()
      .domain([0, maxSetSize])
      .range([0, setBarMaxW]);

    const setBarG = svg.append('g')
      .attr('transform', `translate(${setBarOX}, ${dotOY})`);

    // Axis at top of set bars
    setBarG.append('g')
      .attr('transform', `translate(0, 0)`)
      .call(d3.axisTop(xSetBar).ticks(3).tickFormat(d => d % 1 === 0 ? d : ''))
      .selectAll('text').style('font-size', '8px').style('fill', '#6b7280');

    setBarG.append('text')
      .attr('x', setBarMaxW / 2).attr('y', -18)
      .attr('text-anchor', 'middle')
      .style('font-size', '9px').style('fill', '#6b7280')
      .text('Set Size');

    displayFusions.forEach((f, ri) => {
      const isCurrentFusion = f.name === fusionName;
      const cy = ri * rowH + rowH / 2;
      const bh = rowH * 0.55;
      const bw = xSetBar(f.sampleCount);

      setBarG.append('rect')
        .attr('x', 0).attr('y', cy - bh / 2)
        .attr('width', bw).attr('height', bh)
        .attr('fill', isCurrentFusion ? '#a78bfa' : '#9ca3af')
        .attr('rx', 2)
        .style('cursor', 'pointer')
        .on('mouseenter', function(event) {
          d3.select(this).attr('fill', isCurrentFusion ? '#7c3aed' : '#6b7280');
          const rect = containerRef.current.getBoundingClientRect();
          setTooltip({
            x: event.clientX - rect.left,
            y: event.clientY - rect.top - 30,
            lines: [f.name, samplesSuffix(f.sampleCount)]
          });
        })
        .on('mouseleave', function() {
          d3.select(this).attr('fill', isCurrentFusion ? '#a78bfa' : '#9ca3af');
          setTooltip(null);
        });

      setBarG.append('text')
        .attr('x', bw + 4).attr('y', cy + 4)
        .style('font-size', '8px').style('fill', '#6b7280')
        .text(f.sampleCount);
    });

    // ── Legend ──
    const legendY = dotOY + dotMatrixH + 12;
    const legendG = svg.append('g').attr('transform', `translate(${dotOX}, ${legendY})`);
    const legItems = [
      { color: '#a78bfa', label: onlyLabel(fusionName) },
      { color: '#9ca3af', label: coOccurLabel },
    ];
    let legX = 0;
    legItems.forEach(it => {
      legendG.append('rect').attr('x', legX).attr('y', 0).attr('width', 10).attr('height', 10).attr('fill', it.color).attr('rx', 2);
      legendG.append('text').attr('x', legX + 13).attr('y', 9).style('font-size', '9px').style('fill', '#6b7280').text(it.label);
      legX += it.label.length * 7 + 28;
    });

  }, [upsetData, fusionName]);

  // ── 计算共现融合数据表（独立于 d3 绑定） ──
  useEffect(() => {
    if (!upsetData || !fusionName) { setCoTableData([]); return; }
    const { sampleFusions } = upsetData;
    const currentSamples = new Set(
      Object.entries(sampleFusions)
        .filter(([, fusions]) => fusions.includes(fusionName))
        .map(([s]) => s)
    );
    if (currentSamples.size === 0) { setCoTableData([]); return; }

    // 按每个样本中共存的经典融合集合分组
    const comboCount = new Map(); // key = 排序后的经典融合组合字符串, value = {fusions: [...], count}
    currentSamples.forEach(s => {
      const sf = sampleFusions[s] || [];
      const classicCoFusions = sf.filter(f => f !== fusionName && CLASSIC_FUSIONS.has(f)).sort();
      if (classicCoFusions.length === 0) return; // 无经典共存
      const key = classicCoFusions.join('|');
      if (!comboCount.has(key)) {
        comboCount.set(key, { fusions: classicCoFusions, count: 0 });
      }
      comboCount.get(key).count += 1;
    });

    const tableRows = [...comboCount.values()]
      .sort((a, b) => b.count - a.count)
      .map(item => ({
        combo: fusionName + ' + ' + item.fusions.join(' + '),
        fq: item.count
      }));
    setCoTableData(tableRows);
    setCoTablePage(1);
  }, [upsetData, fusionName]);

  const coTableTotalPages = Math.max(1, Math.ceil(coTableData.length / CO_PAGE_SIZE));
  const coTablePageData = coTableData.slice((coTablePage - 1) * CO_PAGE_SIZE, coTablePage * CO_PAGE_SIZE);

  const handleDownloadCoTable = () => {
    if (coTableData.length === 0) return;
    const header = 'Co-occurring Fusion,fq\n';
    const csv = header + coTableData.map(r => `"${r.combo}",${r.fq}`).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fusionName}_co_occurring_fusions.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500 mr-3"></div>
        <span className="text-sm">{t.language === 'zh' ? '正在计算共现融合...' : 'Computing co-occurring fusions...'}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-10 text-slate-400 text-sm">
        <AlertCircle size={18} className="mr-2 text-amber-400" />
        {t.language === 'zh' ? '暂无共现数据' : 'No co-occurrence data'}
      </div>
    );
  }

  if (!upsetData) {
    return (
      <div className="flex items-center justify-center py-10 text-slate-400 text-sm">
        {t.language === 'zh' ? '暂无数据' : 'No data'}
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      {/* 左侧 UpSet SVG */}
      <div ref={containerRef} className="relative flex-1">
        <svg ref={svgRef} className="w-full"></svg>
        {tooltip && (
          <div
            className="absolute z-50 px-2 py-1.5 bg-slate-800 text-white text-xs rounded shadow-lg pointer-events-none"
            style={{ left: tooltip.x, top: tooltip.y, transform: 'translateX(-50%)' }}
          >
            {tooltip.lines.map((l, i) => (
              <div key={i} className={i === 0 ? 'font-bold' : ''}>{l}</div>
            ))}
          </div>
        )}
      </div>
      {/* 右侧共现融合数据表 */}
      {coTableData.length > 0 && (
        <div className="lg:w-[420px] flex-shrink-0 border border-slate-200 rounded-lg overflow-hidden">
          <div className="bg-slate-50 px-4 py-2.5 flex items-center justify-between border-b border-slate-200">
            <span className="text-sm font-bold text-slate-800">
              {t.language === 'zh' ? `共现融合组合 (${coTableData.length})` : `Co-occurring Combinations (${coTableData.length})`}
            </span>
            <button
              onClick={handleDownloadCoTable}
              className="flex items-center gap-1 text-xs bg-white hover:bg-slate-100 border border-slate-300 px-2 py-1 rounded text-slate-600 transition"
              title={t.language === 'zh' ? '下载CSV' : 'Download CSV'}
            >
              <Download size={12} /> CSV
            </button>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-100">
              <tr>
                <th className="px-4 py-2 text-left font-bold text-slate-700">{t.language === 'zh' ? '共现融合' : 'Co-occurring Fusion'}</th>
                <th className="px-3 py-2 text-right font-bold text-slate-700">fq</th>
              </tr>
            </thead>
            <tbody>
              {coTablePageData.map((row, i) => (
                <tr key={i} className={`${i % 2 === 0 ? 'bg-white' : 'bg-slate-50'} hover:bg-blue-50`}>
                  <td className="px-4 py-2 text-blue-700 font-mono text-xs font-semibold leading-snug break-words" title={row.combo}>{row.combo}</td>
                  <td className="px-3 py-2 text-right font-bold text-purple-700 whitespace-nowrap text-sm">{row.fq}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* 分页 */}
          {coTableTotalPages > 1 && (
            <div className="flex items-center justify-center gap-2 py-2.5 border-t border-slate-200 bg-slate-50">
              <button
                onClick={() => setCoTablePage(p => Math.max(1, p - 1))}
                disabled={coTablePage === 1}
                className="px-2.5 py-1 text-xs rounded border border-slate-300 bg-white disabled:opacity-40 hover:bg-slate-100"
              >{'<'}</button>
              <span className="text-xs text-slate-600 px-2 font-medium">{coTablePage} / {coTableTotalPages}</span>
              <button
                onClick={() => setCoTablePage(p => Math.min(coTableTotalPages, p + 1))}
                disabled={coTablePage === coTableTotalPages}
                className="px-2.5 py-1 text-xs rounded border border-slate-300 bg-white disabled:opacity-40 hover:bg-slate-100"
              >{'>'}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const FusionDetail = () => {
  const { fusionName } = useParams();
  const navigate = useNavigate();
  const detailsRef = useRef(null);
  const headerRef = useRef(null);
  const { t } = useLanguage();
  const FD = t.fusionDetail;

  // 数据状态
  const [columns, setColumns] = useState([]);
  const [rows, setRows] = useState([]);
  const [selectedRow, setSelectedRow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [debugInfo, setDebugInfo] = useState(null);

  // 反向融合数据
  const [reverseRows, setReverseRows] = useState([]);

  // 可视化模式切换
  const [visualMode, setVisualMode] = useState('arriba');
  const [showBothDiagrams, setShowBothDiagrams] = useState(false);

  // 临床数据可用性状态
  const [clinicalAvailability, setClinicalAvailability] = useState(null);
  const [clinicalLoading, setClinicalLoading] = useState(false);

  // UpSet 共现分析数据
  const [upsetData, setUpsetData] = useState(null);
  const [upsetLoading, setUpsetLoading] = useState(false);
  const [upsetError, setUpsetError] = useState(null);

  // 粘性头部状态
  const [isSticky, setIsSticky] = useState(false);

  // ★ cellfusion 聚合数据（如果该融合也存在于细胞系库，显示三行信息）
  const [cellfusionAggregated, setCellfusionAggregated] = useState(null);

  // ★ UniProt IDs for gene structure links (AlphaFold + UniProt)
  const [geneUniprotIds, setGeneUniprotIds] = useState({ left: null, right: null });

  // 监听滚动实现粘性头部
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

  // ★ 查询 cellfusion 是否也包含该融合，有则展示聚合的 cell_line/tissue/disease
  useEffect(() => {
    if (!fusionName) return;
    const fetchCellfusion = async () => {
      try {
        const res = await fetchWithAuth(
          `/api/cellfusion/by-name/${encodeURIComponent(fusionName)}`
        );
        if (!res.ok) {
          // 404 代表细胞系库无此融合，正常情况
          setCellfusionAggregated(null);
          return;
        }
        const json = await res.json();
        if (json?.code === 200 && json.data?.aggregated) {
          const agg = json.data.aggregated;
          // 只要三项中任意一项非空就显示
          if (agg.cell_line || agg.tissue || agg.disease) {
            console.log('[FusionDetail] cellfusion 也存在该融合，聚合:', agg);
            setCellfusionAggregated(agg);
          } else {
            setCellfusionAggregated(null);
          }
        } else {
          setCellfusionAggregated(null);
        }
      } catch (err) {
        console.warn('[FusionDetail] cellfusion 查询失败:', err);
        setCellfusionAggregated(null);
      }
    };
    fetchCellfusion();
  }, [fusionName]);

  // 1. 加载正向融合数据
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        setError('');
        
        console.log('[API] 请求融合基因数据:', fusionName);
        
        const res = await fetchWithAuth(
          `/api/fusion/by-name/${encodeURIComponent(fusionName)}`
        );
        
        if (!res.ok) {
          const errorText = await res.text();
          console.error('[API] 请求失败:', res.status, errorText);
          throw new Error(`API ${res.status}: ${errorText}`);
        }
        
        const json = await res.json();
        console.log('[API] 返回数据:', json);
        
        if (json.code === 200 && json.data) {
          const items = json.data.items || [];
          const cols = json.data.columns || [];
          
          console.log(`[Data] 找到 ${items.length} 个变体`);
          console.log('[Data] 列名:', cols);
          
          if (items.length > 0) {
            console.log('[Data] 第一条记录示例:', items[0]);
          }
          
          const sortedItems = [...items].sort((a, b) => (b.fq || 0) - (a.fq || 0));
          
          setRows(sortedItems);
          setColumns(cols);
          setDebugInfo({
            total: items.length,
            columns: cols.length,
            hasBreakpoints: items.some(r => r.left_breakpoint && r.right_breakpoint),
            hasSequence: items.some(r => r.fusion_transl)
          });
          
          if (sortedItems.length > 0) {
            setSelectedRow({ ...sortedItems[0], id: Number(sortedItems[0].id) });
          }
        } else {
          throw new Error(json.message || 'Data format error');
        }
      } catch (err) {
        console.error('[Error] 加载失败:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    
    loadData();
  }, [fusionName]);

  // 2. 加载反向融合数据（用于基因关系网络双向显示）
  useEffect(() => {
    if (!fusionName) return;

    const parts = fusionName.split('--');
    if (parts.length !== 2) return;

    const reverseName = `${parts[1]}--${parts[0]}`;
    console.log('[Network] 查询反向融合:', reverseName);

    fetchWithAuth(`/api/fusion/by-name/${encodeURIComponent(reverseName)}`)
      .then(res => res.ok ? res.json() : null)
      .then(json => {
        if (json?.code === 200 && json.data?.items?.length > 0) {
          console.log(`[Network] 找到反向融合 ${reverseName}，共 ${json.data.items.length} 个变体`);
          setReverseRows(json.data.items);
        } else {
          console.log('[Network] 无反向融合数据');
          setReverseRows([]);
        }
      })
      .catch(err => {
        console.log('[Network] 反向融合查询失败:', err);
        setReverseRows([]);
      });
  }, [fusionName]);

  // 3. 加载共现融合数据（UpSet 图）
  useEffect(() => {
    if (!fusionName || rows.length === 0) return;

    const loadCoOccurrence = async () => {
      try {
        setUpsetLoading(true);
        setUpsetError(null);

        // 收集本融合所有变体的全部样本 ID
        // 字段名为 sample_name（与后端 serialize_fusion_full 保持一致）
        const allSamples = new Set();
        rows.forEach(r => {
          if (r.sample_name) {
            r.sample_name.split(',').forEach(s => {
              const sid = s.trim();
              if (sid) allSamples.add(sid);
            });
          }
        });

        if (allSamples.size === 0) {
          setUpsetError('no samples');
          return;
        }

        // 调用后端 API（使用 POST 避免 URL 过长导致 431 错误）
        const sampleList = [...allSamples].join(',');
        const res = await fetchWithAuth(
          `/api/fusion/co-occurrence`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              samples: sampleList,
              current_fusion: fusionName
            })
          }
        );

        if (!res.ok) throw new Error(`API ${res.status}`);
        const json = await res.json();
        if (json.code === 200 && json.data) {
          setUpsetData(json.data);
        } else {
          throw new Error(json.message || 'No data');
        }
      } catch (err) {
        console.warn('[UpSet] 共现数据加载失败:', err.message);
        setUpsetError(err.message);
      } finally {
        setUpsetLoading(false);
      }
    };

    loadCoOccurrence();
  }, [fusionName, rows]);

  // 4. 检查临床数据可用性
  useEffect(() => {
    const checkClinicalAvailability = async () => {
      try {
        setClinicalLoading(true);
        const res = await fetchWithAuth(
          `/api/clinical/availability/${encodeURIComponent(fusionName)}`
        );
        
        if (res.ok) {
          const json = await res.json();
          if (json.code === 200 && json.data) {
            setClinicalAvailability(json.data);
            console.log('[Clinical] 可用性检查:', json.data);
          }
        }
      } catch (err) {
        console.error('[Clinical] 可用性检查失败:', err);
        setClinicalAvailability(null);
      } finally {
        setClinicalLoading(false);
      }
    };
    
    if (fusionName) {
      checkClinicalAvailability();
    }
  }, [fusionName]);

  // 5. 查询 UniProt IDs for gene structure links
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
      const [leftId, rightId] = await Promise.all([
        searchUniProt(selectedRow.left_gene),
        searchUniProt(selectedRow.right_gene)
      ]);
      setGeneUniprotIds({ left: leftId, right: rightId });
    };
    fetchIds();
  }, [selectedRow?.left_gene, selectedRow?.right_gene]);

  // 选中变体时不再滚动到详细数据区，直接更新selectedRow
  const handleSelectVariant = (row) => {
    console.log('[Select] 选中变体:', row.id);
    setSelectedRow(row);
  };

  const handleTranscriptomeAnalysis = () => {
    navigate(`/transcriptome/${encodeURIComponent(fusionName)}`);
  };

  const handleClinicalAnalysis = () => {
    navigate(`/clinical/${encodeURIComponent(fusionName)}`);
  };

  // 点击基因网络中的边，跳转到对应融合详情页
  const handleNetworkEdgeClick = (targetFusionName) => {
    if (targetFusionName && targetFusionName !== fusionName) {
      navigate(`/fusion/${encodeURIComponent(targetFusionName)}`);
    }
  };

  // 计算汇总数据
  const totalFq = rows.reduce((sum, r) => sum + (r.fq || 0), 0);
  const highestFqRow = rows.length > 0 ? rows[0] : null;
  const avgFfpm = highestFqRow?.avg_ffpm || 0;

  const inframeVariants = rows.filter(r => (r.prot_fusion_type || '').toUpperCase() === 'INFRAME');
  const frameshiftVariants = rows.filter(r => (r.prot_fusion_type || '').toUpperCase() === 'FRAMESHIFT');
  const highestFq = Math.max(...rows.map(r => r.fq || 0), 0);
  const highestFqVariants = rows.filter(r => r.fq === highestFq);

  const extractEnsgId = (geneStr) => {
    if (!geneStr) return 'N/A';
    const match = geneStr.match(/ENSG\d+\.\d+/);
    return match ? match[0] : geneStr;
  };

  const getClinicalStatusBadge = () => {
    if (clinicalLoading) return <span className="px-2 py-1 bg-slate-100 text-slate-500 rounded text-xs font-bold animate-pulse">{FD.checking}</span>;
    if (clinicalAvailability?.available) return <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-bold">{FD.available}</span>;
    return <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded text-xs font-bold">{FD.insufficientData}</span>;
  };

  if (loading) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
      <p className="text-blue-600">{FD.loading}</p>
      <p className="text-xs text-slate-400 mt-2">{fusionName}</p>
    </div>
  );

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
                  <div>{FD.debugApiPath}: /api/fusion/by-name/{fusionName}</div>
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

  return (
    <div className="min-h-screen bg-slate-50">
      {/* === 粘性头部占位 === */}
      <div ref={headerRef} className="h-0"></div>
      
      {/* === 粘性顶部栏 === */}
      <div className={`${isSticky ? 'fixed top-0 left-0 right-0 z-50 shadow-md' : ''} bg-white border-b border-slate-200 transition-shadow`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <div className="flex items-center relative">
            <div className="flex items-center gap-2">
              <button 
                onClick={() => navigate(-1)}
                className="flex items-center gap-2 text-slate-600 hover:text-blue-600 px-3 py-1.5 rounded-lg hover:bg-slate-50 transition"
              >
                <ArrowLeft size={18} /> {FD.backToList}
              </button>
            </div>
            
            <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-800">{fusionName}</h1>
              <span className="flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-bold">
                <Dna size={12} /> Target
              </span>
            </div>

            <div className="flex items-center gap-2 ml-auto">
              {/* ★ 如果该融合也存在于细胞系库，显示切换按钮 */}
              {cellfusionAggregated && (
                <button
                  onClick={() => navigate(`/cellfusion-detail/${encodeURIComponent(fusionName)}`)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-medium transition shadow-sm"
                >
                  <FlaskConical size={14} />
                  <span>{FD.viewCellLineData}</span>
                  <ExternalLink size={12} />
                </button>
              )}
              <div className="flex items-center gap-2">
                <span className="text-base text-slate-500">FQ:</span>
                <span className="px-3 py-1 bg-purple-100 text-purple-700 rounded font-bold text-base">{totalFq}</span>
                <span className="text-slate-400">/</span>
                <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded font-bold">{3157}</span>
                <span className="text-slate-400 text-xs">{FD.sampleCount}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* === 主内容区 === */}
      <div className={`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6 ${isSticky ? 'pt-20' : ''}`}>

        {/* === 可选融合分析模块（精简版） === */}
        <div className="bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-4">
            <Activity size={18} className="text-purple-600" />
            <h2 className="text-base font-bold text-slate-800">{FD.analysisTitle}</h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 转录组分析 */}
            <div 
              onClick={handleTranscriptomeAnalysis}
              className="bg-white rounded-lg p-4 border-2 border-blue-200 hover:border-blue-400 hover:shadow-md transition cursor-pointer group"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Database size={18} className="text-blue-600" />
                  <h3 className="font-bold text-slate-800">{FD.transcriptomeTitle}</h3>
                  <InfoTooltip>
                    <p className="mb-2">{FD.transcriptomeTooltip1}</p>
                    <p>• {FD.transcriptomeFFPM}: {selectedRow?.avg_ffpm?.toFixed(2) || 'N/A'}</p>
                    <p>• {FD.transcriptomeSupportReads}: {selectedRow?.avg_junction_read_count || 'N/A'}</p>
                    <p>• {FD.transcriptomeFusionType}: {selectedRow?.prot_fusion_type || 'N/A'}</p>
                  </InfoTooltip>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-bold">{FD.available}</span>
                  <ExternalLink size={14} className="text-slate-400 group-hover:text-blue-600 transition" />
                </div>
              </div>
              <div className="mt-3 pt-2 border-t border-slate-100">
                <span className="text-xs text-blue-600 font-medium group-hover:underline">
                  {FD.transcriptomeClick}
                </span>
              </div>
            </div>

            {/* 临床数据分析 */}
            <div 
              onClick={clinicalAvailability?.available ? handleClinicalAnalysis : undefined}
              className={`bg-white rounded-lg p-4 border-2 transition group ${
                clinicalAvailability?.available 
                  ? 'border-green-200 hover:border-green-400 hover:shadow-md cursor-pointer' 
                  : 'border-slate-200 opacity-75 cursor-not-allowed'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Heart size={18} className="text-green-600" />
                  <h3 className="font-bold text-slate-800">{FD.clinicalTitle}</h3>
                  <InfoTooltip>
                    <p className="mb-2">{FD.clinicalTooltip1}</p>
                    <p>• {FD.clinicalPositive}: {clinicalAvailability?.positive_samples ?? 'N/A'}</p>
                    <p>• {FD.clinicalNegative}: {clinicalAvailability?.negative_samples ?? 'N/A'}</p>
                    <p>• {FD.clinicalRiskStrat}: {clinicalAvailability?.risk_available ? FD.clinicalRiskAvail : FD.clinicalRiskNotAvail}</p>
                  </InfoTooltip>
                </div>
                <div className="flex items-center gap-2">
                  {getClinicalStatusBadge()}
                  {clinicalAvailability?.available && (
                    <ExternalLink size={14} className="text-slate-400 group-hover:text-green-600 transition" />
                  )}
                </div>
              </div>
              <div className="mt-3 pt-2 border-t border-slate-100">
                {clinicalAvailability?.available ? (
                  <span className="text-xs text-green-600 font-medium group-hover:underline">
                    {FD.clinicalClick}
                  </span>
                ) : (
                  <span className="text-xs text-slate-400">
                    {FD.clinicalInsufficient(clinicalAvailability?.positive_samples ?? 0, clinicalAvailability?.negative_samples ?? 0)}
                  </span>
                )}
              </div>
            </div>

            {/* 融合基因药敏预测 */}
            <div 
              onClick={() => navigate(`/drug-sensitivity/${encodeURIComponent(fusionName)}`)}
              className="bg-white rounded-lg p-4 border-2 border-amber-200 hover:border-amber-400 hover:shadow-md transition cursor-pointer group"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-lg">💊</span>
                  <h3 className="font-bold text-slate-800">{FD.drugTitle}</h3>
                  <InfoTooltip>
                    <p className="mb-2">{FD.drugTooltip1}</p>
                    <p>• {FD.drugTargeted}</p>
                    <p>• {FD.drugResistance}</p>
                    <p>• {FD.drugCombination}</p>
                  </InfoTooltip>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-bold">{FD.available}</span>
                  <ExternalLink size={14} className="text-slate-400 group-hover:text-amber-600 transition" />
                </div>
              </div>
              <div className="mt-3 pt-2 border-t border-slate-100">
                <span className="text-xs text-amber-600 font-medium group-hover:underline">
                  {FD.clickDrugSensitivity}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* === 融合概览信息区 === */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* 左侧：融合信息表格 */}
            <div className="lg:col-span-1">
              <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                <Database size={16} className="text-blue-500" />
                {FD.fusionInfoTitle}
              </h3>
              <table className="w-full text-xs">
                <tbody className="divide-y divide-slate-100">
                  <tr className="hover:bg-slate-50">
                    <td className="py-2 pr-3 text-slate-500 font-medium whitespace-nowrap">Fusion Name</td>
                    <td className="py-2 text-slate-800 font-mono">{fusionName}</td>
                  </tr>
                  <tr className="hover:bg-slate-50">
                    <td className="py-2 pr-3 text-slate-500 font-medium whitespace-nowrap">Left Gene</td>
                    <td className="py-2 text-slate-800 font-mono">{extractEnsgId(highestFqRow?.left_gene)}</td>
                  </tr>
                  <tr className="hover:bg-slate-50">
                    <td className="py-2 pr-3 text-slate-500 font-medium whitespace-nowrap">Right Gene</td>
                    <td className="py-2 text-slate-800 font-mono">{extractEnsgId(highestFqRow?.right_gene)}</td>
                  </tr>
                  <tr className="hover:bg-slate-50">
                    <td className="py-2 pr-3 text-slate-500 font-medium whitespace-nowrap">Function Left</td>
                    <td className="py-2 text-slate-800">{highestFqRow?.result_function_left || 'N/A'}</td>
                  </tr>
                  <tr className="hover:bg-slate-50">
                    <td className="py-2 pr-3 text-slate-500 font-medium whitespace-nowrap">Function Right</td>
                    <td className="py-2 text-slate-800">{highestFqRow?.result_function_right || 'N/A'}</td>
                  </tr>
                  <tr className="hover:bg-slate-50">
                    <td className="py-2 pr-3 text-slate-500 font-medium whitespace-nowrap">Avg FFPM</td>
                    <td className="py-2 text-slate-800 font-bold">{avgFfpm.toFixed(4)}</td>
                  </tr>
                  <tr className="hover:bg-slate-50">
                    <td className="py-2 pr-3 text-slate-500 font-medium whitespace-nowrap">Total FQ</td>
                    <td className="py-2 text-purple-600 font-bold">{totalFq}</td>
                  </tr>
                  {/* ★ 如果该融合也存在于细胞系库，额外追加三行（聚合所有变体） */}
                  {cellfusionAggregated && (
                    <>
                      <ExpandableInfoField label="Cell Line" value={cellfusionAggregated.cell_line || ''} color="red"    />
                      <CountableInfoField label="Tissue"    value={cellfusionAggregated.tissue    || ''} color="purple" />
                      {cellfusionAggregated.disease_fq && Object.keys(cellfusionAggregated.disease_fq).length > 0
                        ? <DiseaseWithFqField label="Disease" fqMap={cellfusionAggregated.disease_fq} color="orange" />
                        : <CountableInfoField label="Disease" value={cellfusionAggregated.disease || ''} color="orange" />
                      }
                    </>
                  )}
                </tbody>
              </table>
            </div>
            
            {/* 右侧：变体统计概览 */}
            <div className="lg:col-span-2">
              <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                <BarChart3 size={16} className="text-teal-500" />
                {FD.variantStatsTitle}
              </h3>
              
              <div className="grid grid-cols-4 gap-3 mb-4">
                <StatCard title={FD.totalVariants} value={rows.length} color="blue" variants={rows} onVariantClick={handleSelectVariant} />
                <StatCard title="In-frame" value={inframeVariants.length} color="green" variants={inframeVariants} onVariantClick={handleSelectVariant} />
                <StatCard title="Frameshift" value={frameshiftVariants.length} color="amber" variants={frameshiftVariants} onVariantClick={handleSelectVariant} />
                <StatCard title={FD.highestFQ} value={highestFq} color="purple" variants={highestFqVariants} onVariantClick={handleSelectVariant} />
              </div>

              {/* 下方：小型图表并排 */}
              <div className="grid grid-cols-2 gap-4">
                <div className="border border-slate-200 rounded-lg p-2 bg-slate-50">
                  <div className="text-xs font-medium text-slate-600 mb-1 text-center">{FD.junctionDistTitle}</div>
                  <MiniJunctionSpanningChart data={rows} fusionName={fusionName} />
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

        {/* === 基因与断点信息 === */}
        {selectedRow && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-4">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <Dna size={18} className="text-blue-500" />
              {FD.geneBreakpointTitle}
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* 左侧基因 */}
              <div className="space-y-3">
                <div className="bg-blue-50 rounded-lg p-4 border border-blue-200 min-h-[120px]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="text-xs text-blue-600 font-bold mb-2">{FD.leftGeneHeader}</div>
                      <div className="space-y-1 text-sm">
                        <div><span className="text-slate-500 inline-block w-20">{FD.geneNameLabel}</span> <span className="font-bold text-blue-700">{cleanGene(selectedRow.left_gene)}</span></div>
                        <div className="flex items-start"><span className="text-slate-500 inline-block w-20 flex-shrink-0">{FD.breakpointLabel}</span> <span className="font-mono text-xs break-all">{selectedRow.left_breakpoint || 'N/A'}</span></div>
                        {(selectedRow.left_break_dinuc || selectedRow.LeftBreakDinuc) && (
                          <div><span className="text-slate-500 inline-block w-20">{FD.dinucLabel}</span> <span className="font-mono text-xs">{selectedRow.left_break_dinuc || selectedRow.LeftBreakDinuc}</span></div>
                        )}
                        {(selectedRow.left_break_entropy || selectedRow.LeftBreakEntropy) && (
                          <div><span className="text-slate-500 inline-block w-20">{FD.entropyLabel}</span> <span className="font-mono text-xs">{selectedRow.left_break_entropy || selectedRow.LeftBreakEntropy}</span></div>
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
                <GeneFunctionCard geneName={selectedRow.left_gene} side="left" />
              </div>
              {/* 右侧基因 */}
              <div className="space-y-3">
                <div className="bg-purple-50 rounded-lg p-4 border border-purple-200 min-h-[120px]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="text-xs text-purple-600 font-bold mb-2">{FD.rightGeneHeader}</div>
                      <div className="space-y-1 text-sm">
                        <div><span className="text-slate-500 inline-block w-20">{FD.geneNameLabel}</span> <span className="font-bold text-purple-700">{cleanGene(selectedRow.right_gene)}</span></div>
                        <div className="flex items-start"><span className="text-slate-500 inline-block w-20 flex-shrink-0">{FD.breakpointLabel}</span> <span className="font-mono text-xs break-all">{selectedRow.right_breakpoint || 'N/A'}</span></div>
                        {(selectedRow.right_break_dinuc || selectedRow.RightBreakDinuc) && (
                          <div><span className="text-slate-500 inline-block w-20">{FD.dinucLabel}</span> <span className="font-mono text-xs">{selectedRow.right_break_dinuc || selectedRow.RightBreakDinuc}</span></div>
                        )}
                        {(selectedRow.right_break_entropy || selectedRow.RightBreakEntropy) && (
                          <div><span className="text-slate-500 inline-block w-20">{FD.entropyLabel}</span> <span className="font-mono text-xs">{selectedRow.right_break_entropy || selectedRow.RightBreakEntropy}</span></div>
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
                <GeneFunctionCard geneName={selectedRow.right_gene} side="right" />
              </div>
            </div>
          </div>
        )}

        {/* === 0. 样本共现融合分析（UpSet图） === */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center gap-2 mb-4 border-b pb-3">
            <BarChart3 className="text-purple-500" size={20} />
            <h2 className="text-lg font-bold text-slate-800">{FD.upsetTitle}</h2>
            <InfoTooltip>
              <p>{FD.upsetTooltip1}</p>
              <p className="mt-2">{FD.upsetTooltip2}</p>
              <p className="mt-2">{FD.upsetTooltip3('#a78bfa')}</p>
              <p className="mt-2">{FD.upsetTooltip4}</p>
            </InfoTooltip>
          </div>
          <UpsetPlot
            fusionName={fusionName}
            upsetData={upsetData}
            loading={upsetLoading}
            error={upsetError}
          />
        </div>

        {/* === 1. 融合断点图 === */}
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

          {/* 主可视化区域 */}
          <div className="w-full">
            <ArribaFusionDiagram
              fusionName={fusionName}
              allRows={rows}
              selectedRow={selectedRow}
              onSelectVariant={handleSelectVariant}
              showVariantSelector={true}
            />
          </div>
          
        </div>

        {/* === 2. 融合蛋白结构预测 === */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          {selectedRow ? (
            <FusionProteinPredictor 
              sequence={selectedRow.fusion_transl} 
              fusionName={selectedRow.fusion_name}
              leftGene={selectedRow.left_gene}
              rightGene={selectedRow.right_gene}
              variantId={selectedRow.id}
              variantStorageId={`T${selectedRow.id}`}
              variantDisplayId={`T${selectedRow.id}`}
              cacheSource="cache"
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
                {FD.dataTableTitle(selectedRow ? `TP${selectedRow.id}` : 'N/A')}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              {selectedRow && (
                <div className="flex items-center gap-2 mr-4">
                  <span className="text-xs text-slate-500">{FD.fqValueLabel}</span>
                  <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-bold">
                    {selectedRow.fq || 0}
                  </span>
                </div>
              )}
              {selectedRow && (
                <button 
                  onClick={() => {
                    const blob = new Blob([JSON.stringify(selectedRow, null, 2)], {type: 'application/json'});
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${fusionName}_TP${selectedRow.id}.json`;
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
                if (key === '_parsed') return null;
                
                const val = selectedRow[key];
                const isImportant = ['left_breakpoint', 'right_breakpoint', 'prot_fusion_type', 'avg_ffpm', 'fq'].includes(key);
                
                return (
                  <div 
                    key={key} 
                    className={`flex flex-col p-3 border-r border-b border-slate-200 hover:bg-slate-50 transition break-words ${
                      isImportant ? 'bg-blue-50' : ''
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

export default FusionDetail;