// src/pages/TranscriptomeAnalysis.jsx
// 转录组分析页面 - v4.0：支持分页、tooltip、PDF导出

import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, BarChart3, PieChart, Download, FileDown,
  AlertCircle, CheckCircle, TrendingUp, TrendingDown, 
  Loader2, Database, FlaskConical, ChevronLeft, ChevronRight
} from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

// ==================== 认证辅助函数 ====================
async function ensureToken() {
  let token = localStorage.getItem('token');
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.exp && (payload.exp - Math.floor(Date.now() / 1000) < 300)) {
        token = null;
      }
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
    } catch (e) { console.error('[Auth] 失败:', e); }
  }
  return token;
}

async function fetchWithAuth(url) {
  const token = await ensureToken();
  return fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
}

// ==================== PDF导出功能 ====================
const exportToPDF = async (elementId, filename, labels = {}) => {
  try {
    const html2canvas = (await import('html2canvas')).default;
    const { jsPDF } = await import('jspdf');
    const element = document.getElementById(elementId);
    if (!element) {
      alert(labels.notFound || 'Export failed: chart element not found');
      return;
    }
    const canvas = await html2canvas(element, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({
      orientation: canvas.width > canvas.height ? 'landscape' : 'portrait',
      unit: 'px',
      format: [canvas.width, canvas.height]
    });
    pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
    pdf.save(`${filename}.pdf`);
  } catch (error) {
    console.error('PDF export failed:', error);
    alert(labels.failed || 'PDF export failed. Ensure html2canvas and jspdf are installed');
  }
};

// ==================== 简单SVG导出为PDF ====================
const exportSvgToPDF = async (svgElement, filename) => {
  try {
    const { jsPDF } = await import('jspdf');
    const svg2pdf = (await import('svg2pdf.js')).default;
    
    const pdf = new jsPDF({
      orientation: 'landscape',
      unit: 'pt',
      format: 'a4'
    });
    
    await svg2pdf(svgElement, pdf, { x: 20, y: 20, width: 800, height: 500 });
    pdf.save(`${filename}.pdf`);
  } catch (error) {
    // 备用方案：导出为PNG
    exportToPNG(svgElement, filename);
  }
};

const exportToPNG = (svgElement, filename) => {
  const svgData = new XMLSerializer().serializeToString(svgElement);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const img = new Image();
  
  img.onload = () => {
    canvas.width = img.width * 2;
    canvas.height = img.height * 2;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    
    const a = document.createElement('a');
    a.download = `${filename}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
  };
  
  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
};

// ==================== Tooltip组件 ====================
const Tooltip = ({ text, children }) => {
  const [show, setShow] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  
  const handleMouseEnter = (e) => {
    setShow(true);
    setPosition({ x: e.clientX, y: e.clientY });
  };
  
  const handleMouseMove = (e) => {
    setPosition({ x: e.clientX, y: e.clientY });
  };
  
  return (
    <div 
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setShow(false)}
      className="relative"
    >
      {children}
      {show && text && (
        <div 
          className="fixed z-50 max-w-md p-2 text-sm bg-gray-900 text-white rounded-lg shadow-lg pointer-events-none"
          style={{ 
            left: position.x + 10, 
            top: position.y - 10,
            transform: 'translateY(-100%)'
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
};

// ==================== 表达量散点图组件 ====================
const ExpressionScatterPlot = ({ data, fusionName, id }) => {
  const { t } = useLanguage();
  const T = t.transcriptome;
  if (!data) return <div className="text-center py-10 text-slate-400">{T.noData}</div>;

  const width = 400, height = 340;
  const margin = { top: 40, right: 30, bottom: 60, left: 50 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  const posValues = data.fusion_positive?.values || [];
  const negValues = data.fusion_negative?.values || [];
  const allValues = [...posValues, ...negValues];
  
  if (allValues.length === 0) return <div className="text-center py-10 text-slate-400">{T.noExpressionData}</div>;

  const maxY = Math.max(...allValues) * 1.1;
  const yScale = (v) => margin.top + plotHeight - (v / maxY) * plotHeight;

  const posMean = data.fusion_positive?.mean || 0;
  const negMean = data.fusion_negative?.mean || 0;
  const posStd = data.fusion_positive?.std || 0;
  const negStd = data.fusion_negative?.std || 0;
  const pValue = data.statistics?.p_value || 1;

  const getSigMarker = (p) => {
    if (p < 0.001) return '***';
    if (p < 0.01) return '**';
    if (p < 0.05) return '*';
    return 'ns';
  };

  const negX = margin.left + plotWidth * 0.25;
  const posX = margin.left + plotWidth * 0.75;

  // 固定随机种子的散点位置
  const getJitter = (index, range) => {
    const seed = index * 0.618033988749895;
    return (seed % 1 - 0.5) * range;
  };

  return (
    <div id={id} className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex justify-between items-center mb-2">
        <h4 className="font-bold text-slate-700">{data.gene_full || data.gene}</h4>
        <div className="flex items-center gap-2">
          <span className={`text-sm px-2 py-0.5 rounded ${pValue < 0.05 ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
            {pValue < 0.05 && <CheckCircle className="w-3 h-3 inline mr-1" />}
            p = {pValue.toExponential(2)}
          </span>
          <button 
            onClick={() => exportToPDF(id, `expression_${data.gene}`, { notFound: T.exportPdfFailed, failed: T.exportPdfInstall })}
            className="p-1 rounded hover:bg-slate-100"
            title={T.exportPDF}
          >
            <FileDown className="w-4 h-4 text-slate-500" />
          </button>
        </div>
      </div>
      
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
        <line x1={margin.left} y1={margin.top} x2={margin.left} y2={margin.top + plotHeight} stroke="#94a3b8" />
        <text x={15} y={height/2} textAnchor="middle" fill="#64748b" fontSize="11" transform={`rotate(-90, 15, ${height/2})`}>TPM</text>
        
        {[0, 0.25, 0.5, 0.75, 1].map(f => {
          const v = maxY * f;
          const y = yScale(v);
          return (
            <g key={f}>
              <line x1={margin.left - 5} y1={y} x2={margin.left} y2={y} stroke="#94a3b8" />
              <text x={margin.left - 8} y={y + 4} textAnchor="end" fill="#64748b" fontSize="10">{Math.round(v)}</text>
            </g>
          );
        })}
        
        <line x1={margin.left} y1={margin.top + plotHeight} x2={margin.left + plotWidth} y2={margin.top + plotHeight} stroke="#94a3b8" />
        <text x={posX} y={height - 25} textAnchor="middle" fill="#64748b" fontSize="11">+</text>
        <text x={negX} y={height - 25} textAnchor="middle" fill="#64748b" fontSize="11">-</text>
        <text x={width/2} y={height - 5} textAnchor="middle" fill="#475569" fontSize="11">{fusionName}</text>
        
        {negValues.map((v, i) => (
          <circle key={`neg-${i}`} cx={negX + getJitter(i, 60)} cy={yScale(v)} r={3} fill="#94a3b8" fillOpacity={0.6} />
        ))}
        
        {posValues.map((v, i) => (
          <circle key={`pos-${i}`} cx={posX + getJitter(i, 40)} cy={yScale(v)} r={4} fill="#f97316" fillOpacity={0.9} />
        ))}
        
        <line x1={posX - 25} y1={yScale(posMean)} x2={posX + 25} y2={yScale(posMean)} stroke="#000" strokeWidth={2} />
        <line x1={posX} y1={yScale(Math.max(0, posMean - posStd))} x2={posX} y2={yScale(posMean + posStd)} stroke="#000" strokeWidth={1.5} />
        <line x1={posX - 8} y1={yScale(posMean + posStd)} x2={posX + 8} y2={yScale(posMean + posStd)} stroke="#000" strokeWidth={1.5} />
        <line x1={posX - 8} y1={yScale(Math.max(0, posMean - posStd))} x2={posX + 8} y2={yScale(Math.max(0, posMean - posStd))} stroke="#000" strokeWidth={1.5} />
        
        <line x1={negX - 25} y1={yScale(negMean)} x2={negX + 25} y2={yScale(negMean)} stroke="#000" strokeWidth={2} />
        <line x1={negX} y1={yScale(Math.max(0, negMean - negStd))} x2={negX} y2={yScale(negMean + negStd)} stroke="#000" strokeWidth={1.5} />
        <line x1={negX - 8} y1={yScale(negMean + negStd)} x2={negX + 8} y2={yScale(negMean + negStd)} stroke="#000" strokeWidth={1.5} />
        <line x1={negX - 8} y1={yScale(Math.max(0, negMean - negStd))} x2={negX + 8} y2={yScale(Math.max(0, negMean - negStd))} stroke="#000" strokeWidth={1.5} />
        
        <text x={width/2} y={margin.top - 10} textAnchor="middle" fill={pValue < 0.05 ? '#16a34a' : '#64748b'} fontSize="14" fontWeight="bold">
          {getSigMarker(pValue)}
        </text>
      </svg>
      
      <div className="flex justify-between mt-2 text-xs">
        <div className="text-slate-500">
          <span className="font-semibold">{T.fusionNegativeLabel}</span><br/>
          {T.nMeanStd(data.fusion_negative?.count, negMean.toFixed(2), negStd.toFixed(2))}
        </div>
        <div className="text-orange-600">
          <span className="font-semibold">{T.fusionPositiveLabel}</span><br/>
          {T.nMeanStd(data.fusion_positive?.count, posMean.toFixed(2), posStd.toFixed(2))}
        </div>
      </div>
    </div>
  );
};

// ==================== 火山图组件 ====================
const VolcanoPlot = ({ data, title = "", id }) => {
  const { t } = useLanguage();
  const T = t.transcriptome;
  if (!data || data.length === 0) {
    return <div className="text-center py-10 text-slate-400">{T.noData}</div>;
  }

  const width = 600, height = 450;
  const margin = { top: 40, right: 100, bottom: 70, left: 70 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  // 🔥🔥🔥 关键修复：计算合理的X轴范围 🔥🔥🔥
  // X轴范围：取绝对值较大的那个，确保对称，最小为5，最大为10
  let xAxisMax = 7;
  
  // Y轴范围
  const pvalValues = data.map(d => d.neg_log10_pval).filter(v => isFinite(v));
  const maxPval = Math.max(...pvalValues, 5);
  const yAxisMax = Math.min(Math.ceil(maxPval * 1.1), 50);  // 最大限制为50

  // 比例尺函数
  const xScale = (fc) => {
    // 将log2FC限制在显示范围内
    const clampedFC = Math.max(-xAxisMax, Math.min(xAxisMax, fc));
    return margin.left + ((clampedFC + xAxisMax) / (2 * xAxisMax)) * plotWidth;
  };
  
  const yScale = (pval) => {
    const clampedPval = Math.min(pval, yAxisMax);
    return margin.top + plotHeight - (clampedPval / yAxisMax) * plotHeight;
  };

  const fcThreshold = 1;
  const pvalThreshold = -Math.log10(0.05);  // ≈ 1.3

  // 生成X轴刻度
  const xTicks = Array.from({ length: 15 }, (_, i) => i - 7);

  // 生成Y轴刻度
  const yTicks = [];
  const yStep = yAxisMax <= 10 ? 1 : (yAxisMax <= 20 ? 2 : 5);
  for (let i = 0; i <= yAxisMax; i += yStep) {
    yTicks.push(i);
  }

  // 统计显著基因数
  const upCount = data.filter(d => d.direction === 'up').length;
  const downCount = data.filter(d => d.direction === 'down').length;

  return (
    <div id={id} className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="text-lg font-bold text-slate-800">{title}</h3>
          <span className="text-slate-500">
            {T.up}: <span className="text-red-500 font-medium">{upCount}</span> | 
            {T.down}: <span className="text-blue-500 font-medium">{downCount}</span>
          </span>
        </div>
        <button 
          onClick={() => exportToPDF(id, 'volcano_plot', { notFound: T.exportPdfFailed, failed: T.exportPdfInstall })}
          className="flex items-center gap-1 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded border border-slate-200"
        >
          <FileDown className="w-4 h-4" />
          {T.exportPDF}
        </button>
      </div>
      
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
        {/* 背景 */}
        <rect x={margin.left} y={margin.top} width={plotWidth} height={plotHeight} fill="#f8fafc" />
        
        {/* 网格线 */}
        {xTicks.map(v => (
          <line 
            key={`grid-x-${v}`}
            x1={xScale(v)} y1={margin.top} 
            x2={xScale(v)} y2={margin.top + plotHeight} 
            stroke="#e2e8f0" 
            strokeWidth={v === 0 ? 1 : 0.5}
          />
        ))}
        {yTicks.map(v => (
          <line 
            key={`grid-y-${v}`}
            x1={margin.left} y1={yScale(v)} 
            x2={margin.left + plotWidth} y2={yScale(v)} 
            stroke="#e2e8f0" 
            strokeWidth={0.5}
          />
        ))}
        
        {/* 阈值线 */}
        <line 
          x1={xScale(-fcThreshold)} y1={margin.top} 
          x2={xScale(-fcThreshold)} y2={margin.top + plotHeight} 
          stroke="#94a3b8" strokeDasharray="5,5" strokeWidth={1.5}
        />
        <line 
          x1={xScale(fcThreshold)} y1={margin.top} 
          x2={xScale(fcThreshold)} y2={margin.top + plotHeight} 
          stroke="#94a3b8" strokeDasharray="5,5" strokeWidth={1.5}
        />
        <line 
          x1={margin.left} y1={yScale(pvalThreshold)} 
          x2={margin.left + plotWidth} y2={yScale(pvalThreshold)} 
          stroke="#94a3b8" strokeDasharray="5,5" strokeWidth={1.5}
        />
        
        {/* 数据点 - 先画不显著的，再画显著的 */}
        {data.filter(d => d.direction === 'ns').map((point, idx) => (
          <circle
            key={`ns-${idx}`}
            cx={xScale(point.log2FC)}
            cy={yScale(point.neg_log10_pval)}
            r={2}
            fill="#94a3b8"
            fillOpacity={0.4}
          >
            <title>{`${point.gene}\nlog2FC: ${point.log2FC.toFixed(3)}\n-log10(FDR): ${point.neg_log10_pval.toFixed(2)}`}</title>
          </circle>
        ))}
        {data.filter(d => d.direction === 'down').map((point, idx) => (
          <circle
            key={`down-${idx}`}
            cx={xScale(point.log2FC)}
            cy={yScale(point.neg_log10_pval)}
            r={4}
            fill="#3b82f6"
            fillOpacity={0.7}
          >
            <title>{`${point.gene}\nlog2FC: ${point.log2FC.toFixed(3)}\n-log10(FDR): ${point.neg_log10_pval.toFixed(2)}`}</title>
          </circle>
        ))}
        {data.filter(d => d.direction === 'up').map((point, idx) => (
          <circle
            key={`up-${idx}`}
            cx={xScale(point.log2FC)}
            cy={yScale(point.neg_log10_pval)}
            r={4}
            fill="#ef4444"
            fillOpacity={0.7}
          >
            <title>{`${point.gene}\nlog2FC: ${point.log2FC.toFixed(3)}\n-log10(FDR): ${point.neg_log10_pval.toFixed(2)}`}</title>
          </circle>
        ))}
        
        {/* X轴 */}
        <line 
          x1={margin.left} y1={margin.top + plotHeight} 
          x2={margin.left + plotWidth} y2={margin.top + plotHeight} 
          stroke="#475569" strokeWidth={1.5}
        />
        <text 
          x={width / 2} y={height - 15} 
          textAnchor="middle" fill="#475569" fontSize="13" fontWeight="500"
        >
          log2(Fold Change)
        </text>
        {xTicks.map(v => (
          <g key={`xtick-${v}`}>
            <line 
              x1={xScale(v)} y1={margin.top + plotHeight} 
              x2={xScale(v)} y2={margin.top + plotHeight + 6} 
              stroke="#475569" strokeWidth={1}
            />
            <text 
              x={xScale(v)} y={margin.top + plotHeight + 20} 
              textAnchor="middle" fill="#64748b" fontSize="11"
            >
              {v}
            </text>
          </g>
        ))}
        
        {/* Y轴 */}
        <line 
          x1={margin.left} y1={margin.top} 
          x2={margin.left} y2={margin.top + plotHeight} 
          stroke="#475569" strokeWidth={1.5}
        />
        <text 
          x={20} y={height / 2} 
          textAnchor="middle" fill="#475569" fontSize="13" fontWeight="500"
          transform={`rotate(-90, 20, ${height/2})`}
        >
          -log10(FDR)
        </text>
        {yTicks.map(v => (
          <g key={`ytick-${v}`}>
            <line 
              x1={margin.left - 6} y1={yScale(v)} 
              x2={margin.left} y2={yScale(v)} 
              stroke="#475569" strokeWidth={1}
            />
            <text 
              x={margin.left - 10} y={yScale(v) + 4} 
              textAnchor="end" fill="#64748b" fontSize="11"
            >
              {v}
            </text>
          </g>
        ))}
        
        {/* 图例 */}
        <g transform={`translate(${width - 90}, ${margin.top + 10})`}>
          <rect x={-10} y={-5} width={85} height={75} fill="white" fillOpacity={0.9} rx={4} />
          <circle cx={5} cy={10} r={5} fill="#ef4444" />
          <text x={18} y={14} fill="#64748b" fontSize="11">{T.up} ({upCount})</text>
          <circle cx={5} cy={32} r={5} fill="#3b82f6" />
          <text x={18} y={36} fill="#64748b" fontSize="11">{T.down} ({downCount})</text>
          <circle cx={5} cy={54} r={3} fill="#94a3b8" />
          <text x={18} y={58} fill="#64748b" fontSize="11">{T.ns}</text>
        </g>
      </svg>
    </div>
  );
};

// ==================== 富集气泡图组件（带Tooltip） ====================
const EnrichmentDotPlot = ({ data, title, type = 'go', id }) => {
  const [hoveredItem, setHoveredItem] = useState(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const { t } = useLanguage();
  const T = t.transcriptome;
  
  if (!data || data.length === 0) {
    return (
      <div className="text-center py-10 text-slate-400 bg-white rounded-xl border border-slate-200">
        <Database className="w-10 h-10 mx-auto mb-2 opacity-50" />
        <p>{T.noDotPlotData(title)}</p>
      </div>
    );
  }

  const displayData = data.slice(0, 10);
  const width = 600, height = Math.max(300, displayData.length * 28 + 80);
  const margin = { top: 40, right: 120, bottom: 60, left: 220 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  const maxRatio = Math.max(...displayData.map(d => d.gene_ratio || 0.1));
  const maxCount = Math.max(...displayData.map(d => d.gene_count || 1));
  const maxNegLogP = Math.max(...displayData.map(d => d.neg_log10_padj || 1));

  const xScale = (ratio) => margin.left + (ratio / maxRatio) * plotWidth;
  const yScale = (idx) => margin.top + (idx + 0.5) * (plotHeight / displayData.length);
  const sizeScale = (count) => 5 + (count / maxCount) * 12;
  const colorScale = (negLogP) => {
    const t = Math.min(negLogP / Math.max(maxNegLogP, 1), 1);
    const r = Math.round(100 + t * 55);
    const g = Math.round(100 - t * 50);
    const b = Math.round(200 + t * 55);
    return `rgb(${r}, ${g}, ${b})`;
  };

  // 截断文本
  const truncateText = (text, maxLen = 30) => {
    if (text.length <= maxLen) return text;
    return text.substring(0, maxLen) + '...';
  };

  return (
    <div id={id} className="bg-white rounded-xl border border-slate-200 p-4 relative">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-bold text-slate-800">{title}</h3>
        <button 
          onClick={() => exportToPDF(id, `enrichment_${type}`, { notFound: T.exportPdfFailed, failed: T.exportPdfInstall })}
          className="flex items-center gap-1 px-2 py-1 text-sm text-slate-600 hover:bg-slate-100 rounded"
        >
          <FileDown className="w-4 h-4" />
          {T.exportPDF}
        </button>
      </div>
      
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ minHeight: `${height}px` }}>
        {displayData.map((item, idx) => (
          <g key={idx}>
            <text 
              x={margin.left - 10} 
              y={yScale(idx) + 4} 
              textAnchor="end" 
              fill="#374151" 
              fontSize="11"
              style={{ cursor: 'pointer' }}
              onMouseEnter={(e) => {
                setHoveredItem(item);
                setMousePos({ x: e.clientX, y: e.clientY });
              }}
              onMouseMove={(e) => setMousePos({ x: e.clientX, y: e.clientY })}
              onMouseLeave={() => setHoveredItem(null)}
            >
              {truncateText(item.term)}
            </text>
            <circle
              cx={xScale(item.gene_ratio || 0.05)}
              cy={yScale(idx)}
              r={sizeScale(item.gene_count)}
              fill={colorScale(item.neg_log10_padj)}
              fillOpacity={0.8}
              stroke="#fff"
              strokeWidth={1}
              style={{ cursor: 'pointer' }}
              onMouseEnter={(e) => {
                setHoveredItem(item);
                setMousePos({ x: e.clientX, y: e.clientY });
              }}
              onMouseMove={(e) => setMousePos({ x: e.clientX, y: e.clientY })}
              onMouseLeave={() => setHoveredItem(null)}
            />
          </g>
        ))}
        
        <line x1={margin.left} y1={height - margin.bottom} x2={margin.left + plotWidth} y2={height - margin.bottom} stroke="#475569" />
        <text x={margin.left + plotWidth / 2} y={height - 15} textAnchor="middle" fill="#475569" fontSize="12">Gene Ratio</text>
        
        <text x={width - 100} y={margin.top} fill="#475569" fontSize="10">-log10(p.adj)</text>
        <defs>
          <linearGradient id={`colorGrad-${type}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgb(155, 50, 255)" />
            <stop offset="100%" stopColor="rgb(100, 100, 200)" />
          </linearGradient>
        </defs>
        <rect x={width - 100} y={margin.top + 15} width={15} height={60} fill={`url(#colorGrad-${type})`} />
        <text x={width - 80} y={margin.top + 25} fill="#64748b" fontSize="9">{maxNegLogP.toFixed(1)}</text>
        <text x={width - 80} y={margin.top + 75} fill="#64748b" fontSize="9">0</text>
        
        <text x={width - 100} y={margin.top + 100} fill="#475569" fontSize="10">Gene Count</text>
        <circle cx={width - 85} cy={margin.top + 120} r={6} fill="#94a3b8" />
        <text x={width - 70} y={margin.top + 124} fill="#64748b" fontSize="9">{Math.round(maxCount / 2)}</text>
        <circle cx={width - 85} cy={margin.top + 145} r={12} fill="#94a3b8" />
        <text x={width - 65} y={margin.top + 149} fill="#64748b" fontSize="9">{maxCount}</text>
      </svg>
      
      {/* Tooltip */}
      {hoveredItem && (
        <div 
          className="fixed z-50 max-w-lg p-3 bg-gray-900 text-white rounded-lg shadow-xl pointer-events-none"
          style={{ 
            left: mousePos.x + 15, 
            top: mousePos.y - 10,
            transform: 'translateY(-100%)'
          }}
        >
          <div className="font-semibold mb-1">{hoveredItem.term_full || hoveredItem.term}</div>
          <div className="text-xs text-gray-300 space-y-0.5">
            <div>ID: {hoveredItem.id}</div>
            <div>Gene Count: {hoveredItem.gene_count}</div>
            <div>Gene Ratio: {(hoveredItem.gene_ratio * 100).toFixed(1)}%</div>
            <div>p.adjust: {hoveredItem.adj_p_value?.toExponential(2)}</div>
            {hoveredItem.genes && hoveredItem.genes.length > 0 && (
              <div className="mt-1 pt-1 border-t border-gray-700">
                Genes: {hoveredItem.genes.slice(0, 10).join(', ')}{hoveredItem.genes.length > 10 ? '...' : ''}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};


// ==================== R富集图片展示组件 ====================
const InteractiveEnrichmentPreview = ({ terms, title, type }) => {
  const { t } = useLanguage();
  const T = t.transcriptome || {};
  const [hoveredItem, setHoveredItem] = useState(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const data = (terms || []).slice(0, 20);
  if (!data.length) return null;

  const width = 920;
  const height = Math.max(360, data.length * 42 + 115);
  const maxLabelLen = Math.max(...data.map((item) => String(item.term_full || item.term || '').length));
  const margin = {
    top: 44,
    right: 150,
    bottom: 62,
    left: maxLabelLen > 48 ? 330 : 285
  };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maxRatio = Math.max(...data.map((d) => Number(d.gene_ratio) || 0.01), 0.01);
  const maxCount = Math.max(...data.map((d) => Number(d.gene_count) || 1), 1);
  const maxNegLogP = Math.max(...data.map((d) => Number(d.neg_log10_padj) || 1), 1);

  const xScale = (ratio) => margin.left + ((Number(ratio) || 0) / maxRatio) * plotWidth;
  const yScale = (idx) => margin.top + (idx + 0.5) * (plotHeight / data.length);
  const sizeScale = (count) => 6 + ((Number(count) || 1) / maxCount) * 13;
  const colorScale = (negLogP) => {
    const value = Math.min((Number(negLogP) || 0) / maxNegLogP, 1);
    const r = Math.round(59 + value * 180);
    const g = Math.round(130 - value * 65);
    const b = Math.round(246 - value * 25);
    return `rgb(${r}, ${g}, ${b})`;
  };
  const truncateText = (text, maxLen = 46) => {
    const value = String(text || '');
    return value.length > maxLen ? `${value.slice(0, maxLen - 1)}...` : value;
  };
  const formatP = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 'NA';
    return numeric < 0.001 ? numeric.toExponential(2) : numeric.toFixed(4);
  };
  const tooltipText = (item) => [
    item.term_full || item.term || title,
    `${T.termId || 'Term ID'}: ${item.id || 'NA'}`,
    `${T.geneCount || 'Gene Count'}: ${item.gene_count ?? 'NA'}`,
    `${T.geneRatio || 'Gene Ratio'}: ${item.gene_ratio_label || `${((Number(item.gene_ratio) || 0) * 100).toFixed(1)}%`}`,
    `${T.adjustedP || 'Adjusted P'}: ${formatP(item.adj_p_value)}`
  ].join('\n');
  const xTicks = Array.from({ length: 5 }, (_, idx) => (maxRatio * idx) / 4);

  return (
    <div className="relative rounded-lg border border-slate-100 bg-white overflow-hidden" data-plot-type={type}>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto block">
        <text x={width / 2} y={24} textAnchor="middle" fill="#0f172a" fontSize="18" fontWeight="700">
          {title}
        </text>

        {xTicks.map((tick, idx) => {
          const x = xScale(tick);
          return (
            <g key={`tick-${idx}`}>
              <line x1={x} y1={margin.top} x2={x} y2={height - margin.bottom} stroke="#e5e7eb" strokeDasharray="3 3" />
              <text x={x} y={height - margin.bottom + 22} textAnchor="middle" fill="#475569" fontSize="12">
                {tick.toFixed(maxRatio < 0.1 ? 3 : 2)}
              </text>
            </g>
          );
        })}

        {data.map((item, idx) => {
          const fullTerm = item.term_full || item.term || '';
          return (
            <g key={`${item.id || fullTerm}-${idx}`}>
              <line
                x1={margin.left}
                y1={yScale(idx)}
                x2={margin.left + plotWidth}
                y2={yScale(idx)}
                stroke="#eef2f7"
                strokeDasharray="3 3"
              />
              <text
                x={margin.left - 12}
                y={yScale(idx) + 4}
                textAnchor="end"
                fill="#111827"
                fontSize={data.length <= 6 ? 14 : 12}
                style={{ cursor: 'help' }}
                onMouseEnter={(e) => {
                  setHoveredItem(item);
                  setMousePos({ x: e.clientX, y: e.clientY });
                }}
                onMouseMove={(e) => setMousePos({ x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setHoveredItem(null)}
              >
                <title>{tooltipText(item)}</title>
                {truncateText(fullTerm, maxLabelLen > 48 ? 52 : 44)}
              </text>
              <circle
                cx={xScale(item.gene_ratio || 0)}
                cy={yScale(idx)}
                r={sizeScale(item.gene_count)}
                fill={colorScale(item.neg_log10_padj)}
                fillOpacity={0.86}
                stroke="#fff"
                strokeWidth={2}
                style={{ cursor: 'help' }}
                onMouseEnter={(e) => {
                  setHoveredItem(item);
                  setMousePos({ x: e.clientX, y: e.clientY });
                }}
                onMouseMove={(e) => setMousePos({ x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setHoveredItem(null)}
              >
                <title>{tooltipText(item)}</title>
              </circle>
            </g>
          );
        })}

        <line x1={margin.left} y1={margin.top} x2={margin.left} y2={height - margin.bottom} stroke="#475569" />
        <line x1={margin.left} y1={height - margin.bottom} x2={margin.left + plotWidth} y2={height - margin.bottom} stroke="#475569" />
        <text x={margin.left + plotWidth / 2} y={height - 16} textAnchor="middle" fill="#1f2937" fontSize="15">
          {T.geneRatio || 'Gene Ratio'}
        </text>

        <text x={width - 122} y={margin.top + 8} fill="#475569" fontSize="12">-log10(FDR)</text>
        <circle cx={width - 112} cy={margin.top + 34} r={8} fill={colorScale(maxNegLogP)} />
        <text x={width - 94} y={margin.top + 38} fill="#64748b" fontSize="11">{maxNegLogP.toFixed(1)}</text>
        <circle cx={width - 112} cy={margin.top + 60} r={8} fill={colorScale(maxNegLogP / 2)} />
        <text x={width - 94} y={margin.top + 64} fill="#64748b" fontSize="11">{(maxNegLogP / 2).toFixed(1)}</text>

        <text x={width - 122} y={margin.top + 102} fill="#475569" fontSize="12">{T.geneCount || 'Gene Count'}</text>
        <circle cx={width - 112} cy={margin.top + 130} r={sizeScale(Math.max(1, Math.round(maxCount / 2)))} fill="#cbd5e1" />
        <text x={width - 84} y={margin.top + 134} fill="#64748b" fontSize="11">{Math.max(1, Math.round(maxCount / 2))}</text>
        <circle cx={width - 112} cy={margin.top + 170} r={sizeScale(maxCount)} fill="#cbd5e1" />
        <text x={width - 84} y={margin.top + 174} fill="#64748b" fontSize="11">{maxCount}</text>
      </svg>

      {hoveredItem && (
        <div
          className="fixed z-50 max-w-md p-3 bg-slate-950 text-white rounded-lg shadow-xl pointer-events-none"
          style={{
            left: mousePos.x + 14,
            top: mousePos.y - 10,
            transform: 'translateY(-100%)'
          }}
        >
          <div className="font-semibold mb-1">{hoveredItem.term_full || hoveredItem.term}</div>
          <div className="text-xs text-slate-200 space-y-0.5">
            <div>{T.termId || 'Term ID'}: {hoveredItem.id || 'NA'}</div>
            <div>{T.geneCount || 'Gene Count'}: {hoveredItem.gene_count ?? 'NA'}</div>
            <div>{T.geneRatio || 'Gene Ratio'}: {hoveredItem.gene_ratio_label || `${((Number(hoveredItem.gene_ratio) || 0) * 100).toFixed(1)}%`}</div>
            <div>{T.adjustedP || 'Adjusted P'}: {formatP(hoveredItem.adj_p_value)}</div>
            {hoveredItem.genes?.length > 0 && (
              <div className="mt-1 pt-1 border-t border-slate-700">
                {T.genesLabel || 'Genes'}: {hoveredItem.genes.slice(0, 16).join(', ')}{hoveredItem.genes.length > 16 ? '...' : ''}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const EnrichmentImageCard = ({ plot, title, type }) => {
  const { t } = useLanguage();
  const T = t.transcriptome || {};
  const [imageError, setImageError] = useState(false);

  const terms = Array.isArray(plot?.terms) ? plot.terms : [];
  const hasInteractiveTerms = plot?.available && terms.length > 0;
  const hasFallbackImage = plot?.png_url && !imageError;
  const available = hasInteractiveTerms || hasFallbackImage;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex justify-between items-start gap-4 mb-4">
        <div>
          <h3 className="text-lg font-bold text-slate-800">{title}</h3>
          <p className="text-xs text-slate-500 mt-1">
            {available
              ? (T.generatedPlot || 'R/clusterProfiler generated plot')
              : (T.noEnrichmentPlot || 'No significant terms or R plot was not generated')}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {plot?.pdf_url && (
            <a
              href={plot.pdf_url}
              target="_blank"
              rel="noreferrer"
              download
              className="flex items-center gap-1 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded border border-slate-200"
              title={T.exportPDF || 'Download PDF'}
            >
              <FileDown className="w-4 h-4" />
              PDF
            </a>
          )}
        </div>
      </div>

      {available ? (
        <div>
          {hasInteractiveTerms ? (
            <InteractiveEnrichmentPreview terms={terms} title={title} type={type} />
          ) : (
            <div className="rounded-lg border border-slate-100 bg-white overflow-hidden">
              <img
                src={plot.png_url}
                alt={title}
                className="w-full h-auto"
                onError={() => setImageError(true)}
              />
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-12 bg-slate-50 rounded-lg border border-dashed border-slate-200">
          <Database className="w-10 h-10 mx-auto mb-3 text-slate-300" />
          <p className="text-slate-500 font-medium">{plot?.message || T.noEnrichmentResult || 'No enrichment result available'}</p>
          <p className="text-slate-400 text-xs mt-1">
            {T.noEnrichmentReason || 'This can happen when no term passes the adjusted p-value threshold.'}
          </p>
        </div>
      )}
    </div>
  );
};

// ==================== 差异基因表格组件（分页+切换） ====================
const DEGTable = ({ upTable, downTable, title }) => {
  const [viewType, setViewType] = useState('up');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 15;
  const { t } = useLanguage();
  const T = t.transcriptome;
  
  const currentData = viewType === 'up' ? upTable : downTable;
  const totalPages = Math.ceil((currentData?.length || 0) / pageSize);
  const startIdx = (currentPage - 1) * pageSize;
  const pageData = currentData?.slice(startIdx, startIdx + pageSize) || [];
  
  // 切换类型时重置页码
  const handleTypeChange = (type) => {
    setViewType(type);
    setCurrentPage(1);
  };
  
  if ((!upTable || upTable.length === 0) && (!downTable || downTable.length === 0)) {
    return null;
  }
  
  return (
    <div id="deg-table" className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-bold text-slate-800">{title}</h3>
        <div className="flex items-center gap-2">
          {/* 上调/下调切换按钮 */}
          <div className="flex bg-slate-100 rounded-lg p-1">
            <button
              onClick={() => handleTypeChange('up')}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium transition ${
                viewType === 'up' 
                  ? 'bg-red-500 text-white' 
                  : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              <TrendingUp className="w-4 h-4" />
              {T.upLabel(upTable?.length || 0)}
            </button>
            <button
              onClick={() => handleTypeChange('down')}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium transition ${
                viewType === 'down' 
                  ? 'bg-blue-500 text-white' 
                  : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              <TrendingDown className="w-4 h-4" />
              {T.downLabel(downTable?.length || 0)}
            </button>
          </div>
        </div>
      </div>
      
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-slate-600">#</th>
              <th className="px-3 py-2 text-left font-medium text-slate-600">{T.colGene}</th>
              <th className="px-3 py-2 text-right font-medium text-slate-600">log2FC</th>
              <th className="px-3 py-2 text-right font-medium text-slate-600">{T.colPValue}</th>
              <th className="px-3 py-2 text-right font-medium text-slate-600">FDR</th>
              <th className="px-3 py-2 text-right font-medium text-slate-600">Base Mean</th>
            </tr>
          </thead>
          <tbody>
            {pageData.map((row, idx) => (
              <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                <td className="px-3 py-2 text-slate-400">{startIdx + idx + 1}</td>
                <td className="px-3 py-2 font-medium text-slate-800">{row.gene}</td>
                <td className={`px-3 py-2 text-right font-mono ${row.log2FC > 0 ? 'text-red-600' : 'text-blue-600'}`}>
                  {row.log2FC?.toFixed(3)}
                </td>
                <td className="px-3 py-2 text-right text-slate-600 font-mono">{row.p_value?.toExponential(2)}</td>
                <td className="px-3 py-2 text-right text-slate-600 font-mono">{row.adj_p_value?.toExponential(2)}</td>
                <td className="px-3 py-2 text-right text-slate-600 font-mono">{row.base_mean?.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {/* 分页控件 */}
      {totalPages > 1 && (
        <div className="flex justify-between items-center mt-4 pt-4 border-t border-slate-200">
          <div className="text-sm text-slate-500">
            {T.showingGenes(startIdx + 1, Math.min(startIdx + pageSize, currentData.length), currentData.length)}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let page;
                if (totalPages <= 5) {
                  page = i + 1;
                } else if (currentPage <= 3) {
                  page = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  page = totalPages - 4 + i;
                } else {
                  page = currentPage - 2 + i;
                }
                return (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={`w-8 h-8 rounded text-sm ${
                      currentPage === page 
                        ? 'bg-blue-500 text-white' 
                        : 'hover:bg-slate-100 text-slate-600'
                    }`}
                  >
                    {page}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ==================== 主组件 ====================
export default function TranscriptomeAnalysis() {
  const { fusionName } = useParams();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const T = t.transcriptome;
  
  const [activeTab, setActiveTab] = useState('expression');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  const [expressionData, setExpressionData] = useState(null);
  const [differentialData, setDifferentialData] = useState(null);
  const [enrichmentData, setEnrichmentData] = useState(null);
  
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [loadingEnrich, setLoadingEnrich] = useState(false);

  useEffect(() => {
    async function loadExpression() {
      try {
        setLoading(true);
        const response = await fetchWithAuth(`/api/transcriptome/expression/${encodeURIComponent(fusionName)}`);
        const data = await response.json();
        if (data.code === 200) {
          setExpressionData(data.data);
        } else {
          setError(data.message);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    loadExpression();
  }, [fusionName]);

  const loadDifferential = async () => {
    if (differentialData) return;
    try {
      setLoadingDiff(true);
      const response = await fetchWithAuth(`/api/transcriptome/differential/${encodeURIComponent(fusionName)}`);
      const data = await response.json();
      if (data.code === 200) {
        setDifferentialData(data.data);
      }
    } catch (err) {
      console.error('差异分析加载失败:', err);
    } finally {
      setLoadingDiff(false);
    }
  };

  const loadEnrichment = async () => {
    if (enrichmentData) return;
    try {
      setLoadingEnrich(true);
      const response = await fetchWithAuth(`/api/transcriptome/enrichment/${encodeURIComponent(fusionName)}`);
      const data = await response.json();
      if (data.code === 200) {
        setEnrichmentData(data.data);
      }
    } catch (err) {
      console.error('富集分析加载失败:', err);
    } finally {
      setLoadingEnrich(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'differential') loadDifferential();
    else if (activeTab === 'enrichment') loadEnrichment();
  }, [activeTab]);

  const handleExport = () => {
    const exportData = { fusion_name: fusionName, expression: expressionData, differential: differentialData, enrichment: enrichmentData };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcriptome_${fusionName.replace(/[^a-zA-Z0-9]/g, '_')}.json`;
    a.click();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-blue-500 mx-auto mb-4" />
          <p className="text-slate-600">{T.loadingExpression}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* 头部 */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate(-1)} className="p-2 rounded-lg bg-white border border-slate-200 hover:bg-slate-50">
              <ArrowLeft className="w-5 h-5 text-slate-600" />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-slate-800">{T.pageTitle}</h1>
              <p className="text-slate-500">{fusionName}</p>
            </div>
          </div>
          <button onClick={handleExport} className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-50">
            <Download className="w-4 h-4" />
            {T.exportData}
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-500" />
            <span className="text-red-700">{error}</span>
          </div>
        )}

        {/* 标签页 */}
        <div className="flex gap-2 mb-6 bg-white rounded-xl p-1 border border-slate-200 w-fit mx-auto">
          <button onClick={() => setActiveTab('expression')} className={`flex items-center gap-2 px-4 py-2 rounded-lg transition ${activeTab === 'expression' ? 'bg-blue-500 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
            <BarChart3 className="w-4 h-4" />
            {T.tabExpression}
          </button>
          <button onClick={() => setActiveTab('differential')} className={`flex items-center gap-2 px-4 py-2 rounded-lg transition ${activeTab === 'differential' ? 'bg-blue-500 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
            <FlaskConical className="w-4 h-4" />
            {T.tabDifferential}
          </button>
          <button onClick={() => setActiveTab('enrichment')} className={`flex items-center gap-2 px-4 py-2 rounded-lg transition ${activeTab === 'enrichment' ? 'bg-blue-500 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
            <PieChart className="w-4 h-4" />
            {T.tabEnrichment}
          </button>
        </div>

        {/* 表达量比较 */}
        {activeTab === 'expression' && expressionData && (
          <div>
            <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-xl">
              <h3 className="font-bold text-blue-800 flex items-center gap-2"><BarChart3 className="w-5 h-5" />{T.expressionSectionTitle}</h3>
              <p className="text-blue-600 text-sm mt-1">{T.expressionSectionDesc}</p>
            </div>
            <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white rounded-xl border border-slate-200 p-4 text-center">
                <div className="text-2xl font-bold text-orange-500">{expressionData.total_fusion_positive_samples || 0}</div>
                <div className="text-sm text-slate-500">{T.fusionPositiveSamples}</div>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-4 text-center">
                <div className="text-2xl font-bold text-slate-500">{expressionData.left_gene_expression?.fusion_negative?.count || 0}</div>
                <div className="text-sm text-slate-500">{T.fusionNegativeSamples}</div>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-4 text-center">
                <div className="text-2xl font-bold text-blue-500">{expressionData.fusion_info?.avg_ffpm?.toFixed(2) || 'N/A'}</div>
                <div className="text-sm text-slate-500">{T.avgFFPM}</div>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-4 text-center">
                <div className="text-lg font-bold text-purple-500">{expressionData.fusion_info?.prot_fusion_type || 'N/A'}</div>
                <div className="text-sm text-slate-500">n = {expressionData.fusion_info?.inframe_count ?? 0}</div>
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {expressionData.left_gene_expression && <ExpressionScatterPlot data={expressionData.left_gene_expression} fusionName={fusionName} id="expr-left" />}
              {expressionData.right_gene_expression && <ExpressionScatterPlot data={expressionData.right_gene_expression} fusionName={fusionName} id="expr-right" />}
            </div>
          </div>
        )}

        {/* 差异表达分析 */}
        {activeTab === 'differential' && (
          <div>
            {loadingDiff ? (
              <div className="text-center py-20">
                <Loader2 className="w-10 h-10 animate-spin text-blue-500 mx-auto mb-4" />
                <p className="text-slate-600">{T.loadingDiff}</p>
                <p className="text-slate-400 text-sm mt-1">{T.loadingDiffHint}</p>
              </div>
            ) : differentialData ? (
              <div>
                <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-white rounded-xl border border-slate-200 p-4">
                    <h3 className="font-bold text-slate-700 mb-3">{T.diffMethodTitle}</h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between"><span className="text-slate-500">{T.method}:</span><span className="font-medium text-blue-600">{String(differentialData.method || 'DESeq2').replace(/\s*precomputed\b/i, '').trim() || 'DESeq2'}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">{T.log2fcThreshold}:</span><span className="font-medium">|log2FC| &gt; {differentialData.parameters?.log2fc_threshold || 1}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">{T.fdrThreshold}:</span><span className="font-medium">FDR &lt; {differentialData.parameters?.fdr_threshold || 0.05}</span></div>
                    </div>
                  </div>
                  <div className="bg-white rounded-xl border border-slate-200 p-4">
                    <h3 className="font-bold text-slate-700 mb-3">{T.diffSummaryTitle}</h3>
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div><div className="text-2xl font-bold text-slate-600">{differentialData.summary?.total_genes_tested || 0}</div><div className="text-xs text-slate-400">{T.genesDetected}</div></div>
                      <div><div className="text-2xl font-bold text-red-500">{differentialData.summary?.up_regulated || 0}</div><div className="text-xs text-slate-400">{T.upRegulated}</div></div>
                      <div><div className="text-2xl font-bold text-blue-500">{differentialData.summary?.down_regulated || 0}</div><div className="text-xs text-slate-400">{T.downRegulated}</div></div>
                    </div>
                  </div>
                </div>
                {differentialData.volcano_data && <div className="mb-6"><VolcanoPlot data={differentialData.volcano_data} title={T.volcanoTitle} id="volcano-plot" /></div>}
                <DEGTable upTable={differentialData.up_table} downTable={differentialData.down_table} title={T.degTableTitle} />
              </div>
            ) : (
              <div className="text-center py-20 text-slate-400"><AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-50" /><p>{T.noDataDiff}</p></div>
            )}
          </div>
        )}

        {/* GO/KEGG富集分析 */}
        {activeTab === 'enrichment' && (
          <div>
            {loadingEnrich ? (
              <div className="text-center py-20">
                <Loader2 className="w-10 h-10 animate-spin text-blue-500 mx-auto mb-4" />
                <p className="text-slate-600">{T.loadingEnrich}</p>
                <p className="text-slate-400 text-sm mt-1">{T.loadingEnrichHint}</p>
              </div>
            ) : enrichmentData ? (() => {
              const enrich = enrichmentData.combined_enrichment || {};
              const plots = enrich.plots || {};
              const combinedCount = enrichmentData.deg_summary?.combined_count || 0;
              const upCount = enrichmentData.deg_summary?.up_count || 0;
              const downCount = enrichmentData.deg_summary?.down_count || 0;
              const mappedCount = (enrich.meta?.mapped_gene_count !== undefined && enrich.meta?.mapped_gene_count !== null) ? enrich.meta.mapped_gene_count : null;
              const hasAnyPlot = Object.values(plots).some(p => p?.available);

              return (
                <div>
                  <div className="mb-6 p-4 bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-xl">
                    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                      <div>
                        <h3 className="font-bold text-purple-800 mb-2">{T.enrichBanner || 'GO/KEGG Enrichment Analysis'}</h3>
                      </div>
                      <div className="grid grid-cols-3 gap-3 text-center min-w-[360px]">
                        <div className="bg-white/70 rounded-lg px-3 py-2 border border-purple-100">
                          <div className="text-2xl font-bold text-purple-600">{combinedCount}</div>
                          <div className="text-xs text-slate-500">{T.combinedDEG || 'Combined DEG'}</div>
                        </div>
                        <div className="bg-white/70 rounded-lg px-3 py-2 border border-purple-100">
                          <div className="text-2xl font-bold text-red-500">{upCount}</div>
                          <div className="text-xs text-slate-500">{T.up || 'Up'}</div>
                        </div>
                        <div className="bg-white/70 rounded-lg px-3 py-2 border border-purple-100">
                          <div className="text-2xl font-bold text-blue-500">{downCount}</div>
                          <div className="text-xs text-slate-500">{T.down || 'Down'}</div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      <span className="px-2 py-1 rounded-full bg-white/70 border border-purple-100 text-slate-600">
                        {T.sourceLabel || 'Source'}: {enrichmentData.source || 'local R clusterProfiler'}
                      </span>
                      <span className="px-2 py-1 rounded-full bg-white/70 border border-purple-100 text-slate-600">
                        |log2FC| &gt; {enrichmentData.parameters?.log2fc_threshold || 1}, FDR &lt; {enrichmentData.parameters?.fdr_threshold || 0.05}
                      </span>
                      {mappedCount !== null && (
                        <span className="px-2 py-1 rounded-full bg-white/70 border border-purple-100 text-slate-600">
                          {T.mappedGenes || 'Mapped genes'}: {mappedCount}
                        </span>
                      )}
                      {enrich.meta?.kegg_source && (
                        <span className="px-2 py-1 rounded-full bg-white/70 border border-purple-100 text-slate-600">
                          KEGG: {enrich.meta.kegg_source}
                        </span>
                      )}
                    </div>

                    {enrich.status === 'error' && (
                      <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                        <AlertCircle className="w-4 h-4 inline mr-1" />
                        R富集分析失败：{enrich.message}
                      </div>
                    )}
                  </div>

                  {combinedCount > 0 ? (
                    hasAnyPlot ? (
                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                        <EnrichmentImageCard plot={plots.go_bp} title={T.goBpTitle || 'GO Biological Process'} type="go_bp" />
                        <EnrichmentImageCard plot={plots.go_mf} title={T.goMfTitle || 'GO Molecular Function'} type="go_mf" />
                        <EnrichmentImageCard plot={plots.go_cc} title={T.goCcTitle || 'GO Cellular Component'} type="go_cc" />
                        <EnrichmentImageCard plot={plots.kegg} title={T.keggTitle || 'KEGG Pathway'} type="kegg" />
                      </div>
                    ) : (
                      <div className="text-center py-20 bg-white rounded-xl border border-slate-200">
                        <AlertCircle className="w-12 h-12 mx-auto mb-4 text-amber-400" />
                        <p className="text-slate-600 font-medium">
                          {enrich.message || 'R分析已完成，但没有显著GO/KEGG条目通过阈值，或没有生成可展示图片。'}
                        </p>
                      </div>
                    )
                  ) : (
                    <div className="text-center py-20 bg-white rounded-xl border border-slate-200">
                      <AlertCircle className="w-12 h-12 mx-auto mb-4 text-amber-400" />
                      <p className="text-slate-600 font-medium">{T.noSigDEG || 'No significant DEGs for enrichment analysis'}</p>
                    </div>
                  )}
                </div>
              );
            })() : (
              <div className="text-center py-20 text-slate-400"><AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-50" /><p>{T.noDataEnrich}</p></div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
