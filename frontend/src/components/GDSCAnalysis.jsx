// src/components/GDSCAnalysis.jsx
// GDSC 细胞系药物敏感性分析组件
// 集成到融合基因详情页的药物敏感性分析中

import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import * as d3 from 'd3';
import {
  Dna, FlaskConical, BarChart3, Info, AlertCircle,
  ArrowUpDown, Search, Download, ChevronDown, Layers
} from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

// ── Auth helper（复用父级的 fetchWithAuth） ──────────────────────────
async function ensureToken() {
  let token = localStorage.getItem('token');
  if (token) {
    try {
      const p = JSON.parse(atob(token.split('.')[1]));
      if (p.exp && (p.exp - Math.floor(Date.now() / 1000) < 300)) token = null;
    } catch { token = null; }
  }
  if (!token) {
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin' })
      });
      const d = await r.json(); token = d?.access_token;
      if (token) localStorage.setItem('token', token);
    } catch {}
  }
  return token;
}

async function fetchWithAuth(url, opts = {}, retries = 1) {
  const token = await ensureToken();
  const r = await fetch(url, { ...opts, headers: { ...opts.headers, Authorization: `Bearer ${token}` } });
  if (r.status === 401 && retries > 0) { localStorage.removeItem('token'); return fetchWithAuth(url, opts, retries - 1); }
  return r;
}

// ── 统计工具 ─────────────────────────────────────────────────────────
const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
const variance = arr => { const m = mean(arr); return arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length; };
const std = arr => Math.sqrt(variance(arr));

function welchTTest(a, b) {
  if (a.length < 2 || b.length < 2) return null;
  const n1 = a.length, n2 = b.length;
  const m1 = mean(a), m2 = mean(b);
  const v1 = variance(a), v2 = variance(b);
  const se = Math.sqrt(v1 / n1 + v2 / n2);
  if (se === 0) return null;
  const t = Math.abs((m1 - m2) / se);
  const df = (v1 / n1 + v2 / n2) ** 2 /
    ((v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1));
  const p = 2 * (1 - tCDF(t, df));
  return { t, df, p };
}

// t 分布 CDF 近似（避免依赖 jStat）
function tCDF(t, df) {
  const x = df / (df + t * t);
  return 1 - 0.5 * incompleteBeta(df / 2, 0.5, x);
}

function incompleteBeta(a, b, x) {
  // 使用连分数展开近似
  if (x < 0 || x > 1) return 0;
  if (x === 0) return 0;
  if (x === 1) return 1;
  const lbeta = logGamma(a) + logGamma(b) - logGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lbeta);
  if (x < (a + 1) / (a + b + 2)) {
    return front * cfBeta(a, b, x) / a;
  }
  return 1 - front * cfBeta(b, a, 1 - x) / b;
}

function cfBeta(a, b, x) {
  const maxIter = 200;
  const eps = 1e-10;
  let am = 1, bm = 1, az = 1;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let bz = 1 - qab * x / qap;
  for (let m = 1; m <= maxIter; m++) {
    const em = m, tem = em + em;
    let d = em * (b - m) * x / ((qam + tem) * (a + tem));
    const ap = az + d * am;
    const bp = bz + d * bm;
    d = -(a + em) * (qab + em) * x / ((a + tem) * (qap + tem));
    const app = ap + d * az;
    const bpp = bp + d * bz;
    const aold = az;
    am = ap / bpp; bm = bp / bpp;
    az = app / bpp; bz = 1;
    if (Math.abs(az - aold) < eps * Math.abs(az)) return az;
  }
  return az;
}

function logGamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.001208650973866179, -0.000005395239384953];
  let y = x, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += c[j] / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

function pearsonCorrelation(x, y) {
  if (x.length !== y.length || x.length < 3) return null;
  const n = x.length;
  const sx = x.reduce((a, b) => a + b, 0);
  const sy = y.reduce((a, b) => a + b, 0);
  const sxy = x.reduce((s, xi, i) => s + xi * y[i], 0);
  const sx2 = x.reduce((s, xi) => s + xi * xi, 0);
  const sy2 = y.reduce((s, yi) => s + yi * yi, 0);
  const num = n * sxy - sx * sy;
  const den = Math.sqrt((n * sx2 - sx * sx) * (n * sy2 - sy * sy));
  if (den === 0) return null;
  const r = num / den;
  const t = r * Math.sqrt((n - 2) / (1 - r * r));
  const df = n - 2;
  const p = 2 * (1 - tCDF(Math.abs(t), df));
  return { r, p, n };
}

function sigStars(p) {
  if (p == null) return 'ns';
  if (p < 0.0001) return '****';
  if (p < 0.001) return '***';
  if (p < 0.01) return '**';
  if (p < 0.05) return '*';
  return 'ns';
}

function formatP(p) {
  if (p == null) return '-';
  if (p < 0.001) return p.toExponential(2);
  return p.toFixed(3);
}

// ── 指标配置（标签依赖翻译，在组件内动态生成）──────────────────────
const METRIC_VALUES = ['Z_SCORE', 'LN_IC50', 'AUC', 'RMSE'];

const CATEGORY_LABELS_EN = {
  histology: {
    '\u5176\u4ed6': 'Other',
    '\u589e\u751f': 'Hyperplasia',
    '\u5c24\u6587\u6c0f\u8089\u7624/\u5916\u5468\u578b\u539f\u59cb\u795e\u7ecf\u5916\u80da\u5c42\u80bf\u7624': 'Ewing sarcoma/PNET',
    '\u5e73\u6ed1\u808c\u6bcd\u7ec6\u80de\u7624': 'Leiomyoblastoma',
    '\u5e73\u6ed1\u808c\u8089\u7624': 'Leiomyosarcoma',
    '\u6027\u7d22-\u95f4\u8d28\u80bf\u7624': 'Sex cord-stromal tumor',
    '\u6076\u6027\u7ea4\u7ef4\u7ec4\u7ec7\u7ec6\u80de\u7624/\u591a\u5f62\u6027\u8089\u7624': 'MFH/Pleomorphic sarcoma',
    '\u6076\u6027\u9ed1\u8272\u7d20\u7624': 'Malignant melanoma',
    '\u6a2a\u7eb9\u808c\u6837\u7624': 'Rhabdoid tumor',
    '\u6a2a\u7eb9\u808c\u8089\u7624': 'Rhabdomyosarcoma',
    '\u6dcb\u5df4\u7ec4\u7ec7\u80bf\u7624': 'Lymphoid neoplasm',
    '\u6ed1\u819c\u8089\u7624': 'Synovial sarcoma',
    '\u751f\u6b96\u7ec6\u80de\u7624': 'Germ cell tumor',
    '\u764c\u7624/\u4e0a\u76ae\u6027\u764c': 'Carcinoma/Epithelial cancer',
    '\u76ae\u80a4\u9644\u5c5e\u5668\u80bf\u7624': 'Skin appendage tumor',
    '\u795e\u7ecf\u6bcd\u7ec6\u80de\u7624': 'Neuroblastoma',
    '\u7c7b\u764c-\u5185\u5206\u6ccc\u80bf\u7624': 'Carcinoid/Endocrine tumor',
    '\u7ea4\u7ef4\u8089\u7624': 'Fibrosarcoma',
    '\u7ed2\u6bdb\u819c\u764c': 'Choriocarcinoma',
    '\u8089\u7624': 'Sarcoma',
    '\u80be\u4e0a\u817a\u76ae\u8d28\u764c': 'Adrenocortical carcinoma',
    '\u80be\u6bcd\u7ec6\u80de\u7624': 'Nephroblastoma',
    '\u80f6\u8d28\u7624': 'Glioma',
    '\u80f8\u58c1\u539f\u59cb\u795e\u7ecf\u5916\u80da\u5c42\u80bf\u7624': 'Chest wall PNET',
    '\u8102\u80aa\u8089\u7624': 'Liposarcoma',
    '\u8f6f\u9aa8\u8089\u7624': 'Chondrosarcoma',
    '\u9020\u8840\u7cfb\u7edf\u80bf\u7624': 'Hematologic malignancy',
    '\u95f4\u76ae\u7624': 'Mesothelioma',
    '\u9aa8\u8089\u7624': 'Osteosarcoma',
    '\u9ad3\u6bcd\u7ec6\u80de\u7624': 'Medulloblastoma',
  },
  site: {
    '\u4e0a\u547c\u5438\u6d88\u5316\u9053': 'Upper aerodigestive tract',
    '\u4e2d\u67a2\u795e\u7ecf\u7cfb\u7edf': 'Central nervous system',
    '\u4e73\u817a': 'Breast',
    '\u5176\u4ed6': 'Other',
    '\u524d\u5217\u817a': 'Prostate',
    '\u5375\u5de2': 'Ovary',
    '\u553e\u6db2\u817a': 'Salivary gland',
    '\u5916\u9634': 'Vulva',
    '\u5927\u80a0': 'Large intestine',
    '\u5b50\u5bab\u5185\u819c': 'Endometrium',
    '\u5bab\u9888': 'Cervix',
    '\u5c0f\u80a0': 'Small intestine',
    '\u6ccc\u5c3f\u9053': 'Urinary tract',
    '\u7532\u72b6\u817a': 'Thyroid',
    '\u76ae\u80a4': 'Skin',
    '\u777e\u4e38': 'Testis',
    '\u809d\u810f': 'Liver',
    '\u80ba\u90e8': 'Lung',
    '\u80be\u4e0a\u817a': 'Adrenal gland',
    '\u80be\u810f': 'Kidney',
    '\u80c3': 'Stomach',
    '\u80c6\u9053': 'Biliary tract',
    '\u80ce\u76d8': 'Placenta',
    '\u80f8\u819c': 'Pleura',
    '\u81ea\u4e3b\u795e\u7ecf\u8282': 'Autonomic ganglia',
    '\u8f6f\u7ec4\u7ec7': 'Soft tissue',
    '\u9020\u8840\u4e0e\u6dcb\u5df4\u7ec4\u7ec7': 'Hematopoietic/lymphoid',
    '\u98df\u7ba1': 'Esophagus',
    '\u9aa8\u9abc': 'Bone',
  },
};

const formatCategoryLabel = (category, groupBy, language, otherLabel) => {
  if (category === '\u5176\u4ed6') return otherLabel;
  if (language !== 'en') return category;
  return CATEGORY_LABELS_EN[groupBy]?.[category] || category;
};

// ── 颜色 ─────────────────────────────────────────────────────────────
const PALETTE = [
  '#636EFA', '#EF553B', '#00CC96', '#AB63FA', '#FFA15A',
  '#19D3F3', '#FF6692', '#B6E880', '#FF97FF', '#FECB52',
  '#636EFA', '#EF553B', '#00CC96', '#AB63FA', '#FFA15A',
];

const HIGH_COLOR = 'rgba(255,165,0,0.7)';
const LOW_COLOR = 'rgba(135,206,235,0.7)';
const HIGH_BORDER = '#f59e0b';
const LOW_BORDER = '#38bdf8';


// ════════════════════════════════════════════════════════════════════
//  主散点图：药物敏感性概览
// ════════════════════════════════════════════════════════════════════
const DrugScatterPlot = ({ highDrugStats, lowDrugStats, allDrugNames, metric, sortMode, onDrugClick, selectedDrug, labelA = 'High Expression', labelB = 'Low Expression' }) => {
  const svgRef = useRef();
  const containerRef = useRef();
  const [tooltip, setTooltip] = useState(null);

  useEffect(() => {
    if (!allDrugNames || allDrugNames.length === 0) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const W = 560, H = 400;
    const margin = { top: 30, right: 20, bottom: 60, left: 60 };
    const w = W - margin.left - margin.right;
    const h = H - margin.top - margin.bottom;

    svg.attr('viewBox', `0 0 ${W} ${H}`).attr('preserveAspectRatio', 'xMidYMid meet');

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    // 排序药物
    let sorted = [...allDrugNames];
    if (sortMode === 'high') {
      sorted.sort((a, b) => (highDrugStats[a]?.mean ?? 0) - (highDrugStats[b]?.mean ?? 0));
    } else if (sortMode === 'low') {
      sorted.sort((a, b) => (lowDrugStats[a]?.mean ?? 0) - (lowDrugStats[b]?.mean ?? 0));
    }

    const x = d3.scaleLinear().domain([0, sorted.length - 1]).range([0, w]);
    const allVals = [];
    sorted.forEach(d => {
      if (highDrugStats[d]) allVals.push(highDrugStats[d].mean);
      if (lowDrugStats[d]) allVals.push(lowDrugStats[d].mean);
    });
    const yExt = d3.extent(allVals);
    const yPad = (yExt[1] - yExt[0]) * 0.1 || 0.5;
    const y = d3.scaleLinear().domain([yExt[0] - yPad, yExt[1] + yPad]).range([h, 0]);

    // axes
    g.append('g').attr('transform', `translate(0,${h})`).call(d3.axisBottom(x).ticks(5).tickFormat(() => ''))
      .selectAll('text').remove();
    g.append('g').call(d3.axisLeft(y).ticks(6));

    // zero line
    if (yExt[0] < 0 && yExt[1] > 0) {
      g.append('line').attr('x1', 0).attr('x2', w).attr('y1', y(0)).attr('y2', y(0))
        .attr('stroke', '#000').attr('stroke-width', 0.5).attr('stroke-dasharray', '3,3');
    }

    // labels
    g.append('text').attr('x', w / 2).attr('y', h + 40).attr('text-anchor', 'middle')
      .style('font-size', '12px').style('fill', '#475569').text('Drug');
    g.append('text').attr('x', -h / 2).attr('y', -45).attr('text-anchor', 'middle')
      .attr('transform', 'rotate(-90)')
      .style('font-size', '12px').style('fill', '#475569').text(metric);

    // 绘制高表达组
    sorted.forEach((drug, i) => {
      const stat = highDrugStats[drug];
      if (!stat) return;
      g.append('circle')
        .attr('cx', x(i)).attr('cy', y(stat.mean))
        .attr('r', drug === selectedDrug ? 6 : 3.5)
        .attr('fill', HIGH_COLOR).attr('stroke', drug === selectedDrug ? '#000' : HIGH_BORDER)
        .attr('stroke-width', drug === selectedDrug ? 2 : 0.5)
        .style('cursor', 'pointer')
        .on('mouseenter', function (ev) {
          d3.select(this).attr('r', 6);
          const rect = containerRef.current.getBoundingClientRect();
          setTooltip({
            x: ev.clientX - rect.left, y: ev.clientY - rect.top - 50,
            lines: [drug, `${labelA} ${metric}: ${stat.mean.toFixed(4)}`, `n=${stat.n}`]
          });
        })
        .on('mouseleave', function () {
          d3.select(this).attr('r', drug === selectedDrug ? 6 : 3.5);
          setTooltip(null);
        })
        .on('click', () => onDrugClick(drug));
    });

    // 绘制低表达组
    sorted.forEach((drug, i) => {
      const stat = lowDrugStats[drug];
      if (!stat) return;
      g.append('circle')
        .attr('cx', x(i)).attr('cy', y(stat.mean))
        .attr('r', drug === selectedDrug ? 6 : 3.5)
        .attr('fill', LOW_COLOR).attr('stroke', drug === selectedDrug ? '#000' : LOW_BORDER)
        .attr('stroke-width', drug === selectedDrug ? 2 : 0.5)
        .style('cursor', 'pointer')
        .on('mouseenter', function (ev) {
          d3.select(this).attr('r', 6);
          const rect = containerRef.current.getBoundingClientRect();
          setTooltip({
            x: ev.clientX - rect.left, y: ev.clientY - rect.top - 50,
            lines: [drug, `${labelB} ${metric}: ${stat.mean.toFixed(4)}`, `n=${stat.n}`]
          });
        })
        .on('mouseleave', function () {
          d3.select(this).attr('r', drug === selectedDrug ? 6 : 3.5);
          setTooltip(null);
        })
        .on('click', () => onDrugClick(drug));
    });

    // legend
    const lg = g.append('g').attr('transform', `translate(${w - 150}, 0)`);
    [
      { label: labelA, fill: HIGH_COLOR, stroke: HIGH_BORDER },
      { label: labelB, fill: LOW_COLOR, stroke: LOW_BORDER },
    ].forEach((item, idx) => {
      const y0 = idx * 18;
      lg.append('circle')
        .attr('cx', 0).attr('cy', y0)
        .attr('r', 5).attr('fill', item.fill).attr('stroke', item.stroke);
      lg.append('text')
        .attr('x', 12).attr('y', y0 + 4)
        .style('font-size', '11px')
        .style('fill', '#0f172a')
        .text(item.label);
    });

  }, [highDrugStats, lowDrugStats, allDrugNames, metric, sortMode, selectedDrug, onDrugClick, labelA, labelB]);

  return (
    <div ref={containerRef} className="relative">
      <svg ref={svgRef} className="w-full" style={{ maxHeight: 420 }} />
      {tooltip && (
        <div className="absolute z-50 px-3 py-2 bg-slate-800 text-white text-xs rounded-lg shadow-lg pointer-events-none"
          style={{ left: tooltip.x, top: tooltip.y, transform: 'translateX(-50%)' }}>
          {tooltip.lines.map((l, i) => <div key={i} className={i === 0 ? 'font-bold' : 'text-slate-300'}>{l}</div>)}
        </div>
      )}
    </div>
  );
};


// ════════════════════════════════════════════════════════════════════
//  基因表达 Violin Plot（用 D3 绘制）
// ════════════════════════════════════════════════════════════════════
const ExpressionViolinPlot = ({ expressionData, gene, groupBy, language = 'en', otherLabel = 'Other', yAxisLabel = 'Expression (FPKM)' }) => {
  const svgRef = useRef();
  const containerRef = useRef();
  const [tooltip, setTooltip] = useState(null);

  useEffect(() => {
    if (!expressionData || expressionData.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // 按类别分组
    const groups = {};
    expressionData.forEach(d => {
      const cat = d[groupBy] || otherLabel;
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(parseFloat(d.value));
    });

    // 合并小类别
    const processed = {};
    const otherValues = [];
    Object.entries(groups).forEach(([cat, vals]) => {
      if (vals.length <= 2 || cat === 'NS' || cat.toLowerCase() === 'unknown') {
        otherValues.push(...vals);
      } else {
        processed[cat] = vals;
      }
    });
    if (otherValues.length > 0) {
      processed[otherLabel] = [...(processed[otherLabel] || []), ...otherValues];
    }

    const categories = Object.keys(processed).sort((a, b) => {
      if (a === otherLabel) return 1;
      if (b === otherLabel) return -1;
      return mean(processed[b]) - mean(processed[a]);
    });

    if (categories.length === 0) return;

    const W = 560, H = 420;
    const margin = { top: 30, right: 20, bottom: 100, left: 60 };
    const w = W - margin.left - margin.right;
    const h = H - margin.top - margin.bottom;

    svg.attr('viewBox', `0 0 ${W} ${H}`).attr('preserveAspectRatio', 'xMidYMid meet');
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleBand().domain(categories).range([0, w]).padding(0.15);
    const allVals = Object.values(processed).flat();
    const yExt = d3.extent(allVals);
    const yPad = (yExt[1] - yExt[0]) * 0.05;
    const y = d3.scaleLinear().domain([yExt[0] - yPad, yExt[1] + yPad]).range([h, 0]);

    g.append('g').attr('transform', `translate(0,${h})`).call(
      d3.axisBottom(x).tickFormat(cat => formatCategoryLabel(cat, groupBy, language, otherLabel))
    )
      .selectAll('text').attr('transform', 'rotate(-45)').style('text-anchor', 'end').style('font-size', '9px');
    g.append('g').call(d3.axisLeft(y).ticks(6));

    g.append('text').attr('x', -h / 2).attr('y', -45).attr('text-anchor', 'middle')
      .attr('transform', 'rotate(-90)')
      .style('font-size', '12px').style('fill', '#475569').text(yAxisLabel);

    categories.forEach((cat, ci) => {
      const vals = processed[cat].filter(v => !isNaN(v));
      if (vals.length === 0) return;

      const color = PALETTE[ci % PALETTE.length];
      const cx = x(cat) + x.bandwidth() / 2;
      const bw = Math.min(x.bandwidth() * 0.35, 25);

      // 核密度估计
      const kde = kernelDensity(vals, y.ticks(40), Math.max((d3.max(vals) - d3.min(vals)) / 8, 0.1));
      const maxDensity = d3.max(kde, d => d[1]) || 1;
      const xScale = d3.scaleLinear().domain([0, maxDensity]).range([0, bw]);

      // violin shape
      const area = d3.area()
        .x0(d => cx - xScale(d[1]))
        .x1(d => cx + xScale(d[1]))
        .y(d => y(d[0]))
        .curve(d3.curveCatmullRom);

      g.append('path').datum(kde)
        .attr('d', area).attr('fill', color).attr('fill-opacity', 0.35)
        .attr('stroke', color).attr('stroke-width', 1.5);

      // box plot
      const sorted = vals.sort((a, b) => a - b);
      const q1 = d3.quantile(sorted, 0.25);
      const q2 = d3.quantile(sorted, 0.5);
      const q3 = d3.quantile(sorted, 0.75);
      const boxW = bw * 0.4;
      g.append('rect')
        .attr('x', cx - boxW).attr('y', y(q3))
        .attr('width', boxW * 2).attr('height', y(q1) - y(q3))
        .attr('fill', 'white').attr('fill-opacity', 0.7)
        .attr('stroke', color).attr('stroke-width', 1.5);
      g.append('line')
        .attr('x1', cx - boxW).attr('x2', cx + boxW)
        .attr('y1', y(q2)).attr('y2', y(q2))
        .attr('stroke', color).attr('stroke-width', 2);

      // points
      vals.forEach(v => {
        g.append('circle')
          .attr('cx', cx + (Math.random() - 0.5) * bw * 0.8)
          .attr('cy', y(v)).attr('r', 1.5)
          .attr('fill', color).attr('fill-opacity', 0.5);
      });
    });

  }, [expressionData, gene, groupBy, language, otherLabel, yAxisLabel]);

  return (
    <div ref={containerRef} className="relative">
      <svg ref={svgRef} className="w-full" style={{ maxHeight: 440 }} />
    </div>
  );
};

function kernelDensity(data, ticks, bandwidth) {
  return ticks.map(t => [t, d3.mean(data, d => gaussianKernel((t - d) / bandwidth)) / bandwidth]);
}
function gaussianKernel(u) {
  return Math.abs(u) <= 3 ? (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * u * u) : 0;
}


// ════════════════════════════════════════════════════════════════════
//  相关性散点图
// ════════════════════════════════════════════════════════════════════
const CorrelationPlot = ({ matchedData, gene, drugName, metric, stats, xAxisLabel, yAxisLabel, exprLabel = 'Expression' }) => {
  const svgRef = useRef();
  const containerRef = useRef();
  const [tooltip, setTooltip] = useState(null);

  useEffect(() => {
    if (!matchedData || matchedData.length < 3) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const W = 420, H = 340;
    const margin = { top: 40, right: 20, bottom: 50, left: 60 };
    const w = W - margin.left - margin.right;
    const h = H - margin.top - margin.bottom;

    svg.attr('viewBox', `0 0 ${W} ${H}`).attr('preserveAspectRatio', 'xMidYMid meet');
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const xVals = matchedData.map(d => d.expr);
    const yVals = matchedData.map(d => d.drug);
    const xExt = d3.extent(xVals), yExt = d3.extent(yVals);
    const xPad = (xExt[1] - xExt[0]) * 0.05 || 0.5;
    const yPad = (yExt[1] - yExt[0]) * 0.05 || 0.5;

    const x = d3.scaleLinear().domain([xExt[0] - xPad, xExt[1] + xPad]).range([0, w]);
    const y = d3.scaleLinear().domain([yExt[0] - yPad, yExt[1] + yPad]).range([h, 0]);

    g.append('g').attr('transform', `translate(0,${h})`).call(d3.axisBottom(x).ticks(5));
    g.append('g').call(d3.axisLeft(y).ticks(5));

    g.append('text').attr('x', w / 2).attr('y', h + 38).attr('text-anchor', 'middle')
      .style('font-size', '11px').style('fill', '#475569').text(xAxisLabel || `${gene} Expression (FPKM)`);
    g.append('text').attr('x', -h / 2).attr('y', -45).attr('text-anchor', 'middle')
      .attr('transform', 'rotate(-90)')
      .style('font-size', '11px').style('fill', '#475569').text(yAxisLabel || `${drugName} ${metric}`);

    // trend line
    if (stats && matchedData.length >= 2) {
      const n = matchedData.length;
      const sx = d3.sum(xVals), sy = d3.sum(yVals);
      const sxy = xVals.reduce((s, xi, i) => s + xi * yVals[i], 0);
      const sx2 = xVals.reduce((s, xi) => s + xi * xi, 0);
      const slope = (n * sxy - sx * sy) / (n * sx2 - sx * sx);
      const intercept = (sy - slope * sx) / n;
      const lx1 = d3.min(xVals), lx2 = d3.max(xVals);
      g.append('line')
        .attr('x1', x(lx1)).attr('y1', y(slope * lx1 + intercept))
        .attr('x2', x(lx2)).attr('y2', y(slope * lx2 + intercept))
        .attr('stroke', '#ef4444').attr('stroke-width', 2).attr('stroke-dasharray', '6,3');
    }

    // points
    matchedData.forEach(d => {
      g.append('circle')
        .attr('cx', x(d.expr)).attr('cy', y(d.drug)).attr('r', 3.5)
        .attr('fill', 'rgba(31,119,180,0.5)').attr('stroke', 'rgba(31,119,180,0.9)').attr('stroke-width', 0.5)
        .style('cursor', 'pointer')
        .on('mouseenter', function (ev) {
          d3.select(this).attr('r', 6);
          const rect = containerRef.current.getBoundingClientRect();
          setTooltip({
            x: ev.clientX - rect.left, y: ev.clientY - rect.top - 50,
            lines: [d.cellLine, `${exprLabel}: ${d.expr.toFixed(3)}`, `${metric}: ${d.drug.toFixed(3)}`]
          });
        })
        .on('mouseleave', function () { d3.select(this).attr('r', 3.5); setTooltip(null); });
    });

    // annotation
    if (stats) {
      const sig = sigStars(stats.p);
      g.append('rect').attr('x', w / 2 - 90).attr('y', -30).attr('width', 180).attr('height', 22)
        .attr('fill', 'rgba(255,255,255,0.9)').attr('stroke', '#94a3b8').attr('rx', 3);
      g.append('text').attr('x', w / 2).attr('y', -15).attr('text-anchor', 'middle')
        .style('font-size', '10px')
        .text(`r = ${stats.r.toFixed(3)}, p = ${formatP(stats.p)} (${sig}), n = ${stats.n}`);
    }

  }, [matchedData, gene, drugName, metric, stats, xAxisLabel, yAxisLabel, exprLabel]);

  return (
    <div ref={containerRef} className="relative">
      <svg ref={svgRef} className="w-full" style={{ maxHeight: 360 }} />
      {tooltip && (
        <div className="absolute z-50 px-3 py-2 bg-slate-800 text-white text-xs rounded-lg shadow-lg pointer-events-none"
          style={{ left: tooltip.x, top: tooltip.y, transform: 'translateX(-50%)' }}>
          {tooltip.lines.map((l, i) => <div key={i} className={i === 0 ? 'font-bold' : 'text-slate-300'}>{l}</div>)}
        </div>
      )}
    </div>
  );
};


// ════════════════════════════════════════════════════════════════════
//  药物高低组 Violin Plot
// ════════════════════════════════════════════════════════════════════
const DrugGroupViolin = ({ highValues, lowValues, drugName, metric, pValue, labelA = 'High Expression', labelB = 'Low Expression' }) => {
  const svgRef = useRef();

  useEffect(() => {
    if (!highValues?.length || !lowValues?.length) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const W = 340, H = 340;
    const margin = { top: 40, right: 20, bottom: 50, left: 50 };
    const w = W - margin.left - margin.right;
    const h = H - margin.top - margin.bottom;

    svg.attr('viewBox', `0 0 ${W} ${H}`).attr('preserveAspectRatio', 'xMidYMid meet');
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const allVals = [...highValues, ...lowValues];
    const yExt = d3.extent(allVals);
    const yPad = (yExt[1] - yExt[0]) * 0.1 || 0.5;
    const y = d3.scaleLinear().domain([yExt[0] - yPad, yExt[1] + yPad]).range([h, 0]);

    const cats = [labelA, labelB];
    const x = d3.scaleBand().domain(cats).range([0, w]).padding(0.3);

    g.append('g').attr('transform', `translate(0,${h})`).call(d3.axisBottom(x));
    g.append('g').call(d3.axisLeft(y).ticks(6));
    g.append('text').attr('x', -h / 2).attr('y', -38).attr('text-anchor', 'middle')
      .attr('transform', 'rotate(-90)')
      .style('font-size', '11px').style('fill', '#475569').text(metric);

    // p-value annotation
    if (pValue != null) {
      const sig = sigStars(pValue);
      g.append('rect').attr('x', w / 2 - 80).attr('y', -30).attr('width', 160).attr('height', 20)
        .attr('fill', 'rgba(255,255,255,0.9)').attr('stroke', '#94a3b8').attr('rx', 3);
      g.append('text').attr('x', w / 2).attr('y', -16).attr('text-anchor', 'middle')
        .style('font-size', '10px')
        .text(`p = ${formatP(pValue)} (${sig})`);
    }

    const datasets = [
      { vals: highValues, cat: labelA, color: '#f59e0b', fill: 'rgba(255,165,0,0.3)' },
      { vals: lowValues, cat: labelB, color: '#38bdf8', fill: 'rgba(135,206,235,0.3)' },
    ];

    datasets.forEach(({ vals, cat, color, fill }) => {
      const cx = x(cat) + x.bandwidth() / 2;
      const bw = x.bandwidth() * 0.4;
      const kde = kernelDensity(vals, y.ticks(30), Math.max((d3.max(vals) - d3.min(vals)) / 8, 0.1));
      const maxD = d3.max(kde, d => d[1]) || 1;
      const xs = d3.scaleLinear().domain([0, maxD]).range([0, bw]);

      const area = d3.area()
        .x0(d => cx - xs(d[1]))
        .x1(d => cx + xs(d[1]))
        .y(d => y(d[0]))
        .curve(d3.curveCatmullRom);

      g.append('path').datum(kde).attr('d', area)
        .attr('fill', fill).attr('stroke', color).attr('stroke-width', 1.5);

      // box
      const sorted = [...vals].sort((a, b) => a - b);
      const q1 = d3.quantile(sorted, 0.25);
      const q2 = d3.quantile(sorted, 0.5);
      const q3 = d3.quantile(sorted, 0.75);
      const boxW = bw * 0.3;
      g.append('rect').attr('x', cx - boxW).attr('y', y(q3))
        .attr('width', boxW * 2).attr('height', Math.max(y(q1) - y(q3), 1))
        .attr('fill', 'white').attr('fill-opacity', 0.7).attr('stroke', color).attr('stroke-width', 1.2);
      g.append('line').attr('x1', cx - boxW).attr('x2', cx + boxW)
        .attr('y1', y(q2)).attr('y2', y(q2)).attr('stroke', color).attr('stroke-width', 2);

      // jittered points
      vals.forEach(v => {
        g.append('circle')
          .attr('cx', cx + (Math.random() - 0.5) * bw * 0.6)
          .attr('cy', y(v)).attr('r', 1.8)
          .attr('fill', color).attr('fill-opacity', 0.4);
      });
    });

  }, [highValues, lowValues, drugName, metric, pValue, labelA, labelB]);

  return <svg ref={svgRef} className="w-full" style={{ maxHeight: 360 }} />;
};


// ════════════════════════════════════════════════════════════════════
//  主组件：GDSCAnalysis
// ════════════════════════════════════════════════════════════════════
const GDSCAnalysis = ({ leftGene, rightGene, fusionName }) => {
  const { t, language } = useLanguage();
  const g = t.gdsc;

  // 翻译后的指标/分组配置
  const METRICS = useMemo(() => [
    { value: 'Z_SCORE', label: g.metricZScore },
    { value: 'LN_IC50', label: g.metricLnIc50 },
    { value: 'AUC', label: g.metricAuc },
    { value: 'RMSE', label: g.metricRmse },
  ], [g]);

  const METRIC_DESC = useMemo(() => ({
    Z_SCORE: g.descZScore,
    LN_IC50: g.descLnIc50,
    AUC: g.descAuc,
    RMSE: g.descRmse,
  }), [g]);

  const SPLIT_METHODS = useMemo(() => [
    { value: 'median',         label: g.splitMedian },
    { value: 'upper_tertile',  label: g.splitUpperTertile },
    { value: 'lower_tertile',  label: g.splitLowerTertile },
    { value: 'upper_quartile', label: g.splitUpperQuartile },
    { value: 'lower_quartile', label: g.splitLowerQuartile },
  ], [g]);

  const GROUP_BY_OPTIONS = useMemo(() => [
    { value: 'histology', label: g.groupHistology },
    { value: 'site', label: g.groupSite },
  ], [g]);

  // 分析模式：gene = 按基因表达分组，fusion = 按融合阳性/阴性分组
  const [analysisMode, setAnalysisMode] = useState(fusionName ? 'fusion' : 'gene');
  const [activeGene, setActiveGene] = useState(leftGene);
  const [metric, setMetric] = useState(fusionName ? 'AUC' : 'Z_SCORE');
  const [groupBy, setGroupBy] = useState('histology');
  const [sortMode, setSortMode] = useState('high');
  const [splitMethod, setSplitMethod] = useState('median');

  const [expressionData, setExpressionData] = useState([]);
  const [drugResponseData, setDrugResponseData] = useState([]);
  const [cellLineMap, setCellLineMap] = useState({});
  const [cellLineMapLoaded, setCellLineMapLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dataAvailable, setDataAvailable] = useState(null);

  // 融合模式：融合阳性细胞系列表
  const [fusionPositiveCellLines, setFusionPositiveCellLines] = useState([]);
  const [fusionLoading, setFusionLoading] = useState(false);

  const [selectedDrug, setSelectedDrug] = useState(null);
  const [drugDetails, setDrugDetails] = useState(null);
  const [correlationMetric, setCorrelationMetric] = useState('AUC');

  // 动态分组标签
  const labelA = analysisMode === 'fusion' ? g.fusionPositive : g.highExpression;
  const labelB = analysisMode === 'fusion' ? g.fusionNegative : g.lowExpression;
  const displayGene = analysisMode === 'fusion' ? leftGene : activeGene;

  // 检查数据可用性
  useEffect(() => {
    fetchWithAuth('/api/gdsc/check')
      .then(r => r.json())
      .then(d => setDataAvailable(d))
      .catch(() => setDataAvailable({ expression_exists: false, drug_exists: false }));
  }, []);

  // 加载细胞系映射
  useEffect(() => {
    fetchWithAuth('/api/gdsc/cell_line_map')
      .then(r => r.json())
      .then(d => setCellLineMap(d || {}))
      .catch(() => setCellLineMap({}))
      .finally(() => setCellLineMapLoaded(true));
  }, []);

  // 加载融合阳性细胞系（从 cellfusion API）
  useEffect(() => {
    if (!fusionName) return;
    setFusionLoading(true);
    fetchWithAuth(`/api/cellfusion/by-name/${encodeURIComponent(fusionName)}`)
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        if (json?.code === 200 && json.data?.aggregated?.cell_line) {
          const names = json.data.aggregated.cell_line
            .split(/[,;]/).map(s => s.trim()).filter(Boolean);
          setFusionPositiveCellLines(names);
        } else {
          setFusionPositiveCellLines([]);
        }
        setFusionLoading(false);
      })
      .catch(() => { setFusionPositiveCellLines([]); setFusionLoading(false); });
  }, [fusionName]);

  // 构建反向映射 CELL_LINE → COSMIC_ID
  const reverseCellLineMap = useMemo(() => {
    const rev = {};
    Object.entries(cellLineMap).forEach(([cosmicId, cellLine]) => {
      const key = (cellLine || '').trim().toUpperCase();
      if (key) { if (!rev[key]) rev[key] = []; rev[key].push(cosmicId); }
    });
    return rev;
  }, [cellLineMap]);

  // 融合阳性的 COSMIC_ID 集合 + 实际匹配到的细胞系名称
  const { fusionPositiveIds, matchedFusionCellLines } = useMemo(() => {
    const ids = new Set();
    const matchedNames = [];

    // 对细胞系名称中的分隔符（. _ - /）做全排列替换，逐一尝试匹配
    const getSeparatorVariants = (name) => {
      const upper = name.trim().toUpperCase();
      const variants = new Set([upper]);
      const seps = ['.', '_', '-', '/'];
      const sepRegex = /[._\-\/]/g;
      if (sepRegex.test(upper)) {
        seps.forEach(sep => {
          variants.add(upper.replace(/[._\-\/]/g, sep));
        });
        // 也尝试去掉分隔符
        variants.add(upper.replace(/[._\-\/]/g, ''));
      }
      return variants;
    };

    fusionPositiveCellLines.forEach(name => {
      const variants = getSeparatorVariants(name);
      let found = false;
      for (const variant of variants) {
        const matched = reverseCellLineMap[variant];
        if (matched) {
          matched.forEach(id => ids.add(id));
          found = true;
        }
      }
      if (found) matchedNames.push(name);
    });

    return { fusionPositiveIds: ids, matchedFusionCellLines: matchedNames };
  }, [fusionPositiveCellLines, reverseCellLineMap]);

  // 加载基因表达数据
  useEffect(() => {
    const genesToTry = analysisMode === 'fusion'
      ? [leftGene, rightGene].filter(Boolean)
      : [activeGene].filter(Boolean);
    if (genesToTry.length === 0) return;
    setLoading(true);
    setError('');
    setSelectedDrug(null);
    setDrugDetails(null);

    const fetchExpression = async () => {
      for (const gene of genesToTry) {
        const response = await fetchWithAuth(`/api/gdsc/expression/${encodeURIComponent(gene)}`);
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0) {
          return { gene, data };
        }
      }
      return { gene: genesToTry[0], data: [] };
    };

    fetchExpression()
      .then(({ gene, data }) => {
        if (!data || data.length === 0) {
          setError(g.geneNotFound(analysisMode === 'fusion' ? genesToTry.join('/') : gene));
          setExpressionData([]);
          setDrugResponseData([]);
          setLoading(false);
          return;
        }
        setExpressionData(data);

        // 获取药物响应数据
        const cosmicIds = data.map(d => d.COSMIC_ID);
        return fetchWithAuth('/api/gdsc/drug_response', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cosmic_ids: cosmicIds })
        });
      })
      .then(r => r?.json())
      .then(data => {
        if (data) setDrugResponseData(data);
        setLoading(false);
      })
      .catch(e => {
        setError(e.message);
        setLoading(false);
      });
  }, [activeGene, analysisMode, leftGene, rightGene, g]);

  // 加载药物详情
  useEffect(() => {
    if (!selectedDrug) { setDrugDetails(null); return; }
    fetchWithAuth(`/api/gdsc/drug_details/${encodeURIComponent(String(selectedDrug))}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setDrugDetails(d))
      .catch(() => setDrugDetails(null));
  }, [selectedDrug]);

  // 同步相关性指标
  useEffect(() => { setCorrelationMetric(metric); }, [metric]);

  // ── 计算高低表达组 / 融合阳性阴性组 ──────────────────────────────
  const { highIds, lowIds, medianValue, totalSamples } = useMemo(() => {
    if (expressionData.length === 0) return { highIds: new Set(), lowIds: new Set(), medianValue: 0, totalSamples: 0 };

    // ===== 融合模式 =====
    if (analysisMode === 'fusion') {
      const high = new Set(), low = new Set();
      expressionData.forEach(d => {
        const cid = String(d.COSMIC_ID);
        if (fusionPositiveIds.has(cid)) high.add(d.COSMIC_ID);
        else low.add(d.COSMIC_ID);
      });
      return { highIds: high, lowIds: low, medianValue: 0, totalSamples: expressionData.length };
    }

    // ===== 基因模式：支持多种分位数 =====
    const sorted = [...expressionData].sort((a, b) => parseFloat(a.value) - parseFloat(b.value));
    const n = sorted.length;
    let cutIndex;
    switch (splitMethod) {
      case 'upper_tertile':  cutIndex = Math.floor(n * 2 / 3); break;
      case 'lower_tertile':  cutIndex = Math.floor(n / 3); break;
      case 'upper_quartile': cutIndex = Math.floor(n * 3 / 4); break;
      case 'lower_quartile': cutIndex = Math.floor(n / 4); break;
      default:               cutIndex = Math.floor(n / 2); break;
    }
    const medVal = parseFloat(sorted[cutIndex]?.value || 0);
    const high = new Set(), low = new Set();
    sorted.forEach((d, i) => {
      if (i >= cutIndex) high.add(d.COSMIC_ID);
      else low.add(d.COSMIC_ID);
    });
    return { highIds: high, lowIds: low, medianValue: medVal, totalSamples: sorted.length };
  }, [expressionData, splitMethod, analysisMode, fusionPositiveIds]);

  const fusionGroupingReady =
    !fusionLoading && cellLineMapLoaded && expressionData.length > 0;
  const noFusionPositive =
    analysisMode === 'fusion' && fusionGroupingReady && highIds.size === 0;

  // ── 计算每个药物在高低组中的统计量 ─────────────────────────────
  const { highDrugStats, lowDrugStats, allDrugNames } = useMemo(() => {
    if (drugResponseData.length === 0) return { highDrugStats: {}, lowDrugStats: {}, allDrugNames: [] };

    const highStats = {}, lowStats = {};
    const drugSet = new Set();

    drugResponseData.forEach(item => {
      const val = parseFloat(item[metric]);
      if (isNaN(val)) return;
      const drug = item.Drug_Name;
      drugSet.add(drug);
      const cid = item.COSMIC_ID;

      if (highIds.has(cid) || highIds.has(String(cid))) {
        if (!highStats[drug]) highStats[drug] = [];
        highStats[drug].push(val);
      }
      if (lowIds.has(cid) || lowIds.has(String(cid))) {
        if (!lowStats[drug]) lowStats[drug] = [];
        lowStats[drug].push(val);
      }
    });

    const highResult = {}, lowResult = {};
    drugSet.forEach(drug => {
      if (highStats[drug]?.length > 0) {
        highResult[drug] = { mean: mean(highStats[drug]), n: highStats[drug].length, values: highStats[drug] };
      }
      if (lowStats[drug]?.length > 0) {
        lowResult[drug] = { mean: mean(lowStats[drug]), n: lowStats[drug].length, values: lowStats[drug] };
      }
    });

    return { highDrugStats: highResult, lowDrugStats: lowResult, allDrugNames: [...drugSet] };
  }, [drugResponseData, metric, highIds, lowIds]);

  // ── 选中药物的相关性分析数据 ───────────────────────────────────
  const correlationData = useMemo(() => {
    if (!selectedDrug || expressionData.length === 0 || drugResponseData.length === 0) return null;

    const drugSpecific = drugResponseData.filter(d => String(d.Drug_Name) === String(selectedDrug));
    if (drugSpecific.length === 0) return null;

    const matched = [];
    expressionData.forEach(exprItem => {
      const ev = parseFloat(exprItem.value);
      if (isNaN(ev)) return;
      const drugItem = drugSpecific.find(d =>
        d.COSMIC_ID === exprItem.COSMIC_ID || String(d.COSMIC_ID) === String(exprItem.COSMIC_ID)
      );
      if (drugItem) {
        const dv = parseFloat(drugItem[correlationMetric]);
        if (!isNaN(dv)) {
          matched.push({
            cosmicId: exprItem.COSMIC_ID,
            expr: ev,
            drug: dv,
            cellLine: cellLineMap[String(exprItem.COSMIC_ID)] || exprItem.CELL_LINE || `ID:${exprItem.COSMIC_ID}`
          });
        }
      }
    });

    if (matched.length < 3) return null;

    const xVals = matched.map(d => d.expr);
    const yVals = matched.map(d => d.drug);
    const stats = pearsonCorrelation(xVals, yVals);

    return { matched, stats };
  }, [selectedDrug, expressionData, drugResponseData, correlationMetric, cellLineMap]);

  // ── 选中药物在高低组中的分布 ───────────────────────────────────
  const drugGroupData = useMemo(() => {
    if (!selectedDrug || drugResponseData.length === 0) return null;

    const drugSpecific = drugResponseData.filter(d => String(d.Drug_Name) === String(selectedDrug));
    const highVals = [], lowVals = [];

    drugSpecific.forEach(d => {
      const v = parseFloat(d[correlationMetric]);
      if (isNaN(v)) return;
      const cid = d.COSMIC_ID;
      if (highIds.has(cid) || highIds.has(String(cid))) highVals.push(v);
      if (lowIds.has(cid) || lowIds.has(String(cid))) lowVals.push(v);
    });

    if (highVals.length < 2 || lowVals.length < 2) return null;

    const test = welchTTest(highVals, lowVals);
    return { highVals, lowVals, pValue: test?.p ?? null };
  }, [selectedDrug, drugResponseData, correlationMetric, highIds, lowIds]);

  // ── 回调 ───────────────────────────────────────────────────────
  const handleDrugClick = useCallback((drug) => {
    setSelectedDrug(prev => prev === drug ? null : drug);
  }, []);

  // 模式切换
  const handleGeneSelect = (gene) => {
    setAnalysisMode('gene');
    setActiveGene(gene);
    setMetric('Z_SCORE');
    setSelectedDrug(null);
  };
  const handleFusionSelect = () => {
    setAnalysisMode('fusion');
    setMetric('AUC');
    setSelectedDrug(null);
  };

  // ── 数据不可用 ─────────────────────────────────────────────────
  if (dataAvailable && (!dataAvailable.expression_exists || !dataAvailable.drug_exists)) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8">
        <div className="text-center py-8">
          <AlertCircle size={40} className="mx-auto text-amber-400 mb-3" />
          <h3 className="text-lg font-bold text-slate-700 mb-2">{g.dataNotConfigured}</h3>
          <p className="text-sm text-slate-500">
            {g.dataNotConfiguredDesc1}<code className="px-1.5 py-0.5 bg-slate-100 rounded text-xs">expression.csv</code>{g.dataNotConfiguredDesc2}
            <code className="px-1.5 py-0.5 bg-slate-100 rounded text-xs">drug.csv</code>{g.dataNotConfiguredDesc3}
            <code className="px-1.5 py-0.5 bg-slate-100 rounded text-xs">data/</code>{g.dataNotConfiguredDesc4}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* ── 标题 & 基因切换 ──────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-teal-100 rounded-lg"><Dna size={20} className="text-teal-600" /></div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">{g.title}</h2>
            </div>
          </div>

          {/* 基因 / 融合 切换 */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">{g.analyzeGene}</span>
            {[leftGene, rightGene].filter(Boolean).map(gene => (
              <button
                key={gene}
                onClick={() => handleGeneSelect(gene)}
                className={`px-3 py-1.5 rounded-lg text-sm font-bold transition ${
                  analysisMode === 'gene' && activeGene === gene
                    ? 'bg-teal-600 text-white shadow-md'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-300'
                }`}
              >
                {gene}
              </button>
            ))}
            {fusionName && (
              <button
                onClick={handleFusionSelect}
                className={`px-3 py-1.5 rounded-lg text-sm font-bold transition flex items-center gap-1.5 ${
                  analysisMode === 'fusion'
                    ? 'bg-purple-600 text-white shadow-md'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-300'
                }`}
              >
                <Layers size={14} />
                {g.analyzeFusion}
              </button>
            )}
          </div>
        </div>

        {/* 融合模式提示 */}
        {noFusionPositive && (
          <div className="mb-4 p-4 bg-amber-50 rounded-lg border border-amber-200 flex items-start gap-3">
            <AlertCircle size={18} className="text-amber-500 mt-0.5 flex-shrink-0" />
            <p className="text-sm font-medium text-amber-700">{g.fusionNotDetectedCCLE}</p>
          </div>
        )}

        {analysisMode === 'fusion' && !noFusionPositive && (
          <div className="mb-4 p-3 bg-purple-50 rounded-lg border border-purple-200 flex items-start gap-2">
            <Layers size={14} className="text-purple-500 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-purple-700">
              <p className="font-semibold">{g.fusionGroupMode}</p>
              <p className="mt-1">
                {g.fusionGroupDesc()}<strong>{fusionName}</strong>{g.fusionGroupDescMid}
                <span className="text-amber-600 font-bold">{g.fusionGroupDescPos(highIds.size)}</span>{g.fusionGroupDescAnd}
                <span className="text-sky-600 font-bold">{g.fusionGroupDescNeg(lowIds.size)}</span>{g.fusionGroupDescEnd}
                {matchedFusionCellLines.length > 0 && (
                  <span className="ml-1">{g.positiveCellLines}{matchedFusionCellLines.join(', ')}</span>
                )}
              </p>
            </div>
          </div>
        )}

        {/* 指标 & 分组 控制条 */}
        <div className="flex flex-wrap items-center gap-4 p-3 bg-slate-50 rounded-lg border border-slate-200">
          {/* 指标 */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-medium">{g.metricLabel}</span>
            <select
              value={metric}
              onChange={e => setMetric(e.target.value)}
              className="text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white font-medium"
            >
              {METRICS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>

          {/* 分组方式（仅基因模式） */}
          {analysisMode === 'gene' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 font-medium">{g.groupLabel}</span>
              <select
                value={splitMethod}
                onChange={e => setSplitMethod(e.target.value)}
                className="text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white"
              >
                {SPLIT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
          )}

          {/* 排序 */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-500 font-medium">{g.sortLabel}</span>
            {[
              { v: 'high', l: `${labelA}${g.sortSuffix}`, color: 'bg-amber-500' },
              { v: 'low', l: `${labelB}${g.sortSuffix}`, color: 'bg-sky-400' },
              { v: 'none', l: g.noSort, color: 'bg-slate-400' },
            ].map(({ v, l, color }) => (
              <button key={v} onClick={() => setSortMode(v)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition ${
                  sortMode === v ? `${color} text-white` : 'bg-white text-slate-600 border border-slate-300 hover:bg-slate-100'
                }`}>{l}</button>
            ))}
          </div>

          {/* 重置 */}
          <button onClick={() => {
            setSelectedDrug(null);
            setSortMode('high');
            setMetric(analysisMode === 'fusion' ? 'AUC' : 'Z_SCORE');
            setSplitMethod('median');
          }}
            className="ml-auto px-3 py-1 rounded text-xs bg-white text-slate-600 border border-slate-300 hover:bg-slate-100">
            {g.reset}
          </button>
        </div>

        {/* 指标说明 */}
        <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-200 flex items-start gap-2">
          <Info size={14} className="text-blue-500 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-blue-700">{METRIC_DESC[metric]}</p>
        </div>
      </div>

      {/* ── Loading ──────────────────────────────────────── */}
      {loading && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-teal-600 mx-auto mb-4" />
          <p className="text-teal-700 font-medium">{g.loadingData(activeGene)}</p>
        </div>
      )}

      {/* ── Error ────────────────────────────────────────── */}
      {error && !loading && (
        <div className="bg-white rounded-xl shadow-sm border border-red-200 p-8 text-center">
          <AlertCircle size={36} className="mx-auto text-red-400 mb-3" />
          <p className="text-red-600 font-medium">{error}</p>
        </div>
      )}

      {/* ── 主图区域 ─────────────────────────────────────── */}
      {!loading && !error && expressionData.length > 0 &&
        (analysisMode !== 'fusion' || fusionGroupingReady) && !noFusionPositive && (
        <>
          {/* 统计概览 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { n: totalSamples, l: g.totalSamples, c: 'from-teal-500 to-emerald-600' },
              { n: highIds.size, l: labelA, c: 'from-amber-500 to-orange-500' },
              { n: lowIds.size, l: labelB, c: 'from-sky-400 to-blue-500' },
              { n: allDrugNames.length, l: g.drugCount, c: 'from-purple-500 to-violet-600' },
            ].map(({ n, l, c }) => (
              <div key={l} className={`bg-gradient-to-br ${c} rounded-xl p-4 text-white text-center shadow-md`}>
                <p className="text-3xl font-bold">{n}</p>
                <p className="text-xs opacity-90 mt-1">{l}</p>
              </div>
            ))}
          </div>

          {/* ── 融合模式：散点图左 + 药物详情右 并排 ──────── */}
          {analysisMode === 'fusion' && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* 左侧：药物敏感性散点图 */}
            <div className="lg:col-span-3 bg-white rounded-xl shadow-sm border border-slate-200 p-5">
              <div className="flex items-center gap-2 mb-3 pb-3 border-b border-slate-100">
                <BarChart3 size={16} className="text-teal-500" />
                <h3 className="text-sm font-bold text-slate-700">
                  {g.fusionScatterTitle(fusionName)}
                </h3>
              </div>
              {allDrugNames.length > 0 ? (
                <DrugScatterPlot
                  highDrugStats={highDrugStats}
                  lowDrugStats={lowDrugStats}
                  allDrugNames={allDrugNames}
                  metric={metric}
                  sortMode={sortMode}
                  onDrugClick={handleDrugClick}
                  selectedDrug={selectedDrug}
                  labelA={labelA}
                  labelB={labelB}
                />
              ) : (
                <div className="py-12 text-center text-slate-400">{g.noDrugData}</div>
              )}
              <p className="text-xs text-slate-500 mt-2 text-center">
                {g.fusionStatsLine(fusionName, labelA, highIds.size, labelB, lowIds.size, metric)}
              </p>
            </div>

            {/* 右侧：药物详情 */}
            <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-teal-200 p-5">
              <div className="flex items-center gap-3 mb-4 pb-4 border-b border-slate-100">
                <div className="p-2 bg-teal-100 rounded-lg">
                  <FlaskConical size={18} className="text-teal-600" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-800">{g.drugDetails}</h3>
                  <p className="text-xs text-slate-500">{g.clickDrugDot}</p>
                </div>
              </div>
              {selectedDrug ? (
                <div className="space-y-3">
                  <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                    <h4 className="text-xs font-bold text-slate-600 mb-3 flex items-center gap-1.5">
                      <FlaskConical size={14} className="text-teal-500" />
                      {g.drugDetailInfo}
                    </h4>
                    <div className="space-y-2">
                      <DetailRow label={g.drugName} value={drugDetails?.DRUG_NAME || String(selectedDrug)} bold />
                      <DetailRow label={g.target} value={drugDetails?.PUTATIVE_TARGET} />
                      <DetailRow label={g.pathway} value={drugDetails?.PATHWAY_NAME} />
                      <DetailRow
                        label={`${labelA} ${metric} ${g.meanLabel}`}
                        value={highDrugStats[selectedDrug]
                          ? `${highDrugStats[selectedDrug].mean.toFixed(4)} (n=${highDrugStats[selectedDrug].n})`
                          : '-'}
                      />
                      <DetailRow
                        label={`${labelB} ${metric} ${g.meanLabel}`}
                        value={lowDrugStats[selectedDrug]
                          ? `${lowDrugStats[selectedDrug].mean.toFixed(4)} (n=${lowDrugStats[selectedDrug].n})`
                          : '-'}
                      />
                      {drugGroupData?.pValue != null && (
                        <DetailRow
                          label={`${labelA}/${labelB} ${g.diffPValue}`}
                          value={
                            <span className={drugGroupData.pValue < 0.05 ? 'text-red-600 font-bold' : ''}>
                              p = {formatP(drugGroupData.pValue)} ({sigStars(drugGroupData.pValue)})
                            </span>
                          }
                        />
                      )}
                    </div>
                    {drugGroupData?.pValue != null && drugGroupData.pValue < 0.05 && (
                      <div className="mt-4 p-3 bg-orange-50 border-l-4 border-orange-400 rounded-r text-xs text-orange-700">
                        {g.sigDiffMsg(labelA, labelB, metric)}
                      </div>
                    )}
                    {drugGroupData?.pValue != null && drugGroupData.pValue >= 0.05 && (
                      <div className="mt-4 p-3 bg-slate-50 border-l-4 border-slate-300 rounded-r text-xs text-slate-600">
                        {g.noSigDiffMsg(labelA, labelB, metric)}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="py-16 text-center">
                  <Search size={36} className="mx-auto text-slate-300 mb-3" />
                  <p className="text-slate-500 font-medium">{g.clickDrugDotView}</p>
                  <p className="text-xs text-slate-400 mt-1">{g.viewDrugInfo}</p>
                </div>
              )}
            </div>
          </div>
          )}

          {/* ── 基因模式：散点图 + Violin 并排 ────────────── */}
          {analysisMode !== 'fusion' && (
          <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 药物敏感性散点图 */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
              <div className="flex items-center gap-2 mb-3 pb-3 border-b border-slate-100">
                <BarChart3 size={16} className="text-teal-500" />
                <h3 className="text-sm font-bold text-slate-700">
                  {g.geneScatterTitle(displayGene)}
                </h3>
              </div>
              {allDrugNames.length > 0 ? (
                <DrugScatterPlot
                  highDrugStats={highDrugStats}
                  lowDrugStats={lowDrugStats}
                  allDrugNames={allDrugNames}
                  metric={metric}
                  sortMode={sortMode}
                  onDrugClick={handleDrugClick}
                  selectedDrug={selectedDrug}
                  labelA={labelA}
                  labelB={labelB}
                />
              ) : (
                <div className="py-12 text-center text-slate-400">{g.noDrugData}</div>
              )}
              <p className="text-xs text-slate-500 mt-2 text-center">
                {g.geneStatsLine(displayGene, totalSamples, labelA, highIds.size, labelB, lowIds.size, metric, SPLIT_METHODS.find(m => m.value === splitMethod)?.label || g.splitMedian)}
              </p>
            </div>

            {/* 基因表达 Violin */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
              <div className="flex items-center justify-between mb-3 pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <BarChart3 size={16} className="text-indigo-500" />
                  <h3 className="text-sm font-bold text-slate-700">
                    {g.expressionDistTitle(displayGene)}
                  </h3>
                </div>
                <div className="flex items-center gap-1">
                  {GROUP_BY_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setGroupBy(opt.value)}
                      className={`px-2.5 py-1 rounded text-xs font-medium transition ${
                        groupBy === opt.value
                          ? 'bg-indigo-500 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >{opt.label}</button>
                  ))}
                </div>
              </div>
              <ExpressionViolinPlot
                expressionData={expressionData}
                gene={displayGene}
                groupBy={groupBy}
                language={language}
                otherLabel={g.otherCategory}
                yAxisLabel={g.expressionAxisLabel}
              />
            </div>
          </div>

          {/* ── 药物详情区域（点击药物后显示）──────────────── */}
          {selectedDrug && (
            <div className="bg-white rounded-xl shadow-sm border border-teal-200 p-6">
              <div className="flex items-center justify-between mb-4 pb-4 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-teal-100 rounded-lg">
                    <FlaskConical size={18} className="text-teal-600" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-800">
                      {g.drugAnalysisTitle(String(selectedDrug))}
                    </h3>
                    <p className="text-xs text-slate-500">
                      {g.switchDrugHint}
                    </p>
                  </div>
                </div>

                {/* 相关性指标切换 */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">{g.correlationMetricLabel}</span>
                  {METRICS.map(m => (
                    <button
                      key={m.value}
                      onClick={() => setCorrelationMetric(m.value)}
                      className={`px-2.5 py-1 rounded text-xs font-medium transition ${
                        correlationMetric === m.value
                          ? 'bg-teal-500 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >{m.value}</button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* 相关性散点图 */}
                <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                  <h4 className="text-xs font-bold text-slate-600 mb-2">
                    {g.correlationTitle(displayGene, String(selectedDrug), correlationMetric)}
                  </h4>
                  {correlationData ? (
                    <>
                      <CorrelationPlot
                        matchedData={correlationData.matched}
                        gene={displayGene}
                        drugName={String(selectedDrug)}
                        metric={correlationMetric}
                        stats={correlationData.stats}
                        xAxisLabel={`${displayGene} ${g.expressionAxisLabel}`}
                        yAxisLabel={`${String(selectedDrug)} ${correlationMetric}`}
                        exprLabel={g.expressionAxisLabel}
                      />
                      {correlationData.stats && (
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                          <div><strong>{g.corrCoeff}</strong> {correlationData.stats.r.toFixed(4)}</div>
                          <div><strong>{g.pValue}</strong> {formatP(correlationData.stats.p)}</div>
                          <div><strong>{g.sampleCountN}</strong> {correlationData.stats.n}</div>
                          <div>
                            <strong>{g.significance}</strong>
                            <span className={`ml-1 font-bold ${correlationData.stats.p < 0.05 ? 'text-red-600' : 'text-slate-500'}`}>
                              {sigStars(correlationData.stats.p)} {correlationData.stats.p < 0.05 ? g.significant : g.notSignificant}
                            </span>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="py-8 text-center text-slate-400 text-xs">{g.insufficientData}</div>
                  )}
                </div>

                {/* 高低组 Violin */}
                <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                  <h4 className="text-xs font-bold text-slate-600 mb-2">
                    {g.drugGroupDistTitle(String(selectedDrug), labelA, labelB, correlationMetric)}
                  </h4>
                  {drugGroupData ? (
                    <>
                      <p className="text-[10px] text-slate-500 mb-1">
                        {g.samplesStat(labelA, drugGroupData.highVals.length)}, {g.samplesStat(labelB, drugGroupData.lowVals.length)}
                      </p>
                      <DrugGroupViolin
                        highValues={drugGroupData.highVals}
                        lowValues={drugGroupData.lowVals}
                        drugName={String(selectedDrug)}
                        metric={correlationMetric}
                        pValue={drugGroupData.pValue}
                        labelA={labelA}
                        labelB={labelB}
                      />
                    </>
                  ) : (
                    <div className="py-8 text-center text-slate-400 text-xs">{g.insufficientData}</div>
                  )}
                </div>

                {/* 药物详情 */}
                <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                  <h4 className="text-xs font-bold text-slate-600 mb-3 flex items-center gap-1.5">
                    <FlaskConical size={14} className="text-teal-500" />
                    {g.drugDetailInfo}
                  </h4>
                  <div className="space-y-2">
                    <DetailRow label={g.drugName} value={drugDetails?.DRUG_NAME || String(selectedDrug)} bold />
                    <DetailRow label={g.target} value={drugDetails?.PUTATIVE_TARGET} />
                    <DetailRow label={g.pathway} value={drugDetails?.PATHWAY_NAME} />
                    <DetailRow
                      label={`${labelA}/${labelB} ${correlationMetric} ${g.diffPValue}`}
                      value={drugGroupData?.pValue != null ? (
                        <span className={drugGroupData.pValue < 0.05 ? 'text-red-600 font-bold' : ''}>
                          p = {formatP(drugGroupData.pValue)} ({sigStars(drugGroupData.pValue)})
                        </span>
                      ) : '-'}
                    />
                    <DetailRow
                      label={`${labelA} ${correlationMetric} ${g.meanSdLabel}`}
                      value={drugGroupData?.highVals?.length > 1
                        ? `${mean(drugGroupData.highVals).toFixed(3)} ± ${std(drugGroupData.highVals).toFixed(3)}`
                        : '-'}
                    />
                    <DetailRow
                      label={`${labelB} ${correlationMetric} ${g.meanSdLabel}`}
                      value={drugGroupData?.lowVals?.length > 1
                        ? `${mean(drugGroupData.lowVals).toFixed(3)} ± ${std(drugGroupData.lowVals).toFixed(3)}`
                        : '-'}
                    />
                  </div>

                  {/* 显著性提示 */}
                  {drugGroupData?.pValue != null && drugGroupData.pValue < 0.05 && (
                    <div className="mt-4 p-3 bg-orange-50 border-l-4 border-orange-400 rounded-r text-xs text-orange-700">
                      {g.sigDiffMsg(labelA, labelB, correlationMetric)}
                    </div>
                  )}
                  {drugGroupData?.pValue != null && drugGroupData.pValue >= 0.05 && (
                    <div className="mt-4 p-3 bg-slate-50 border-l-4 border-slate-300 rounded-r text-xs text-slate-600">
                      {g.noSigDiffMsg(labelA, labelB, correlationMetric)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 未选择药物提示 */}
          {!selectedDrug && (
            <div className="bg-white rounded-xl shadow-sm border border-dashed border-slate-300 p-8 text-center">
              <Search size={36} className="mx-auto text-slate-300 mb-3" />
              <p className="text-slate-500 font-medium">{g.clickForAnalysis}</p>
              <p className="text-xs text-slate-400 mt-1">{g.analysisIncludes}</p>
            </div>
          )}
          </>
          )}
        </>
      )}
    </div>
  );
};


// ── 小组件 ───────────────────────────────────────────────────────
const DetailRow = ({ label, value, bold }) => (
  <div className="flex items-start py-2 border-b border-slate-100 last:border-0">
    <span className="text-[11px] text-slate-500 font-medium w-2/5 flex-shrink-0">{label}</span>
    <span className={`text-[11px] text-slate-800 flex-1 break-words ${bold ? 'font-bold' : ''}`}>
      {value || '-'}
    </span>
  </div>
);


export default GDSCAnalysis;
