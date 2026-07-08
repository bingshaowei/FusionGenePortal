// Home.jsx
import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Search, ChevronLeft, ChevronRight, Dna, Filter, FlaskConical, BarChart2, X, Download } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

// ── 认证 ──────────────────────────────────────────────────────────────────────
async function ensureToken() {
  let token = localStorage.getItem('token');
  if (!token) {
    const resp = await fetch('/api/auth/login', { method: 'POST' });
    const text = await resp.text();
    if (!resp.ok) throw new Error(`login ${resp.status}`);
    const data = JSON.parse(text || '{}');
    token = data?.access_token;
    if (token) localStorage.setItem('token', token);
  }
  return token;
}
async function fetchWithAuth(url, opts = {}, retry = 0) {
  const token = await ensureToken();
  const headers = { ...(opts.headers || {}), Authorization: `Bearer ${token}` };
  const resp = await fetch(url, { ...opts, headers });
  if (!resp.ok) {
    const txt = await resp.text();
    console.error(`[${url}] ${resp.status}`, txt);
    if ((resp.status === 401 || resp.status === 422) && retry < 1) {
      localStorage.removeItem('token');
      return fetchWithAuth(url, opts, retry + 1);
    }
  }
  return resp;
}

// ── 辅助 ──────────────────────────────────────────────────────────────────────
const truncate = (text, max = 20) => {
  if (!text) return 'N/A';
  const s = String(text);
  return s.length > max ? s.slice(0, max) + '...' : s;
};
const extractGeneName = (s) => s ? s.split('^')[0] : '';
const extractENSG    = (s) => {
  if (!s) return 'N/A';
  const p = s.split('^');
  return p.length > 1 ? p[1] : s;
};

// ── 括号感知分割：括号内的逗号/分号不算分隔符 ─────────────────────────────────
const smartSplit = (str) => {
  if (!str || String(str).trim() === '' || String(str).trim().toLowerCase() === 'n/a') return [];
  const items = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '(') { depth++; current += ch; }
    else if (ch === ')') { depth--; current += ch; }
    else if ((ch === ',' || ch === ';') && depth === 0) {
      const t = current.trim();
      if (t) items.push(t);
      current = '';
    } else {
      current += ch;
    }
  }
  const t = current.trim();
  if (t) items.push(t);
  return items;
};

// ── Disease 列：显示前 5 个，hover 时 position:fixed portal 展示全部 ──────────
const DiseaseCell = ({ value }) => {
  const { t } = useLanguage();
  const h = t.home;
  const [pos, setPos] = React.useState(null);
  const ref = React.useRef(null);
  const all = React.useMemo(() => smartSplit(value), [value]);
  const handleMouseEnter = () => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 6, left: rect.left });
    }
  };
  if (!value || value === 'N/A' || value === '' || all.length === 0)
    return <span className="text-xs text-gray-400">N/A</span>;
  const shown = all.slice(0, 5);
  const hidden = all.length - shown.length;
  const shortText = shown.map(d => d.length > 22 ? d.slice(0, 22) + '…' : d).join('; ');
  return (
    <>
      <span ref={ref} className="text-xs text-orange-700 underline decoration-dotted cursor-default truncate block max-w-[180px]"
        onMouseEnter={handleMouseEnter} onMouseLeave={() => setPos(null)}>
        {shortText}{hidden > 0 && <span className="text-gray-400 ml-0.5">+{hidden}</span>}
      </span>
      {pos && createPortal(
        <div style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999, maxWidth: 380 }}
          className="bg-gray-900 text-white text-xs rounded-lg py-2 px-3 shadow-xl pointer-events-none">
          <div className="mb-1 text-gray-300 font-semibold">{h.allDiseases(all.length)}</div>
          {all.map((d, i) => <div key={i} className="leading-snug py-0.5 border-b border-gray-700 last:border-0">{d}</div>)}
        </div>,
        document.body
      )}
    </>
  );
};

// ── Cell Line 列：显示前 10 个，hover 时 position:fixed portal 展示全部 ────────
const CellLineCell = ({ value }) => {
  const { t } = useLanguage();
  const h = t.home;
  const [pos, setPos] = React.useState(null);
  const ref = React.useRef(null);
  const all = React.useMemo(() => smartSplit(value), [value]);
  const handleMouseEnter = () => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 6, left: rect.left });
    }
  };
  if (!value || value === 'N/A' || value === '' || all.length === 0)
    return <span className="text-xs text-gray-400">N/A</span>;
  const shown = all.slice(0, 10);
  const hidden = all.length - shown.length;
  const shortText = shown.map(c => c.trim()).join('; ');
  return (
    <>
      <span ref={ref} className="text-xs text-red-700 underline decoration-dotted cursor-default truncate block max-w-[180px]"
        onMouseEnter={handleMouseEnter} onMouseLeave={() => setPos(null)}>
        {shortText}{hidden > 0 && <span className="text-gray-400 ml-0.5">+{hidden}</span>}
      </span>
      {pos && createPortal(
        <div style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999, maxWidth: 320 }}
          className="bg-gray-900 text-white text-xs rounded-lg py-2 px-3 shadow-xl pointer-events-none">
          <div className="mb-1 text-gray-300 font-semibold">{h.allCellLines(all.length)}</div>
          <div className="flex flex-wrap gap-1">
            {all.map((c, i) => <span key={i} className="px-1.5 py-0.5 bg-gray-700 rounded text-[10px]">{c.trim()}</span>)}
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

// ── Annots 列：截断显示，hover 时 position:fixed portal 展示完整内容 ──────────
const AnnotsCell = ({ value, maxLen = 15 }) => {
  const [pos, setPos] = React.useState(null);
  const ref = React.useRef(null);
  const s = value ? String(value) : '';
  const needsTip = s.length > maxLen;
  const handleMouseEnter = () => {
    if (needsTip && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 6, left: rect.left });
    }
  };
  if (!s) return <span className="text-xs text-gray-400">N/A</span>;
  return (
    <>
      <span ref={ref} onMouseEnter={handleMouseEnter} onMouseLeave={() => setPos(null)}
        className={`text-xs text-gray-700 ${needsTip ? 'underline decoration-dotted cursor-help' : ''}`}>
        {needsTip ? s.slice(0, maxLen) + '...' : s}
      </span>
      {pos && createPortal(
        <div style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999, maxWidth: 360 }}
          className="bg-gray-900 text-white text-xs rounded-lg py-2 px-3 shadow-xl pointer-events-none break-words leading-relaxed">
          {s}
        </div>,
        document.body
      )}
    </>
  );
};
// 疾病名称为解析后的精确名称（\, 替换为 ,）
const DISEASE_CATEGORIES = [
  {
    id: 'carcinoma', label: 'Carcinoma', labelZh: '上皮癌',
    color: { tab: 'bg-red-100 text-red-700 border-red-300', active: 'bg-red-600 text-white border-red-600' },
    diseases: [
      'carcinoma',
      'carcinoma (adenocarcinoma)',
      'carcinoma (anaplastic_carcinoma)',
      'carcinoma (barrett_associated_adenocarcinoma)',
      'carcinoma (bronchioloalveolar_adenocarcinoma)',
      'carcinoma (Brenner_tumour)',
      'carcinoma (carcinosarcoma-malignant_mesodermal_mixed_tumour)',
      'carcinoma (clear_cell_carcinoma)',
      'carcinoma (clear_cell_renal_cell_carcinoma)',
      'carcinoma (diffuse_adenocarcinoma)',
      'carcinoma (ductal_carcinoma)',
      'carcinoma (ductal_carcinoma, medullary)',
      'carcinoma (ductal_carcinoma, papillary)',
      'carcinoma (ductal_carcinoma, squamous_cell_carcinoma)',
      'carcinoma (endometrioid_carcinoma)',
      'carcinoma (follicular_carcinoma)',
      'carcinoma (hepatocellular_carcinoma)',
      'carcinoma (intestinal_adenocarcinoma)',
      'carcinoma (large_cell_carcinoma)',
      'carcinoma (medullary_carcinoma)',
      'carcinoma (metaplastic_carcinoma)',
      'carcinoma (mixed_adenosquamous_carcinoma)',
      'carcinoma (mixed_carcinoma)',
      'carcinoma (mucinous_carcinoma)',
      'carcinoma (mucoepidermoid_carcinoma)',
      'carcinoma (non_small_cell_carcinoma)',
      'carcinoma (papillary_carcinoma)',
      'carcinoma (renal_cell_carcinoma)',
      'carcinoma (serous_carcinoma)',
      'carcinoma (signet_ring_adenocarcinoma)',
      'carcinoma (small_cell_adenocarcinoma)',
      'carcinoma (small_cell_carcinoma)',
      'carcinoma (squamous_cell_carcinoma)',
      'carcinoma (transitional_cell_carcinoma)',
      'carcinoma (transitional_cell_carcinoma, papillary_transitional_cell_carcinoma)',
      'carcinoma (tubular_adenocarcinoma)',
      'carcinoma (undifferentiated_adenocarcinoma)',
      'carcinoma (undifferentiated_carcinoma)',
      'carcinoid-endocrine_tumour',
    ],
  },
  {
    id: 'lymphoid', label: 'Lymphoid', labelZh: '淋巴系统',
    color: { tab: 'bg-purple-100 text-purple-700 border-purple-300', active: 'bg-purple-600 text-white border-purple-600' },
    diseases: [
      'lymphoid_neoplasm',
      'lymphoid_neoplasm (acute_lymphoblastic_B_cell_leukaemia)',
      'lymphoid_neoplasm (acute_lymphoblastic_B_cell_leukaemia, L2)',
      'lymphoid_neoplasm (acute_lymphoblastic_T_cell_leukaemia)',
      'lymphoid_neoplasm (acute_lymphoblastic_T_cell_leukaemia, L2)',
      'lymphoid_neoplasm (adult_T_cell_lymphoma-leukaemia)',
      'lymphoid_neoplasm (anaplastic_large_cell_lymphoma)',
      'lymphoid_neoplasm (B_cell_lymphoma_unspecified)',
      'lymphoid_neoplasm (Burkitt_lymphoma)',
      'lymphoid_neoplasm (chronic_lymphocytic_leukaemia-small_lymphocytic_lymphoma)',
      'lymphoid_neoplasm (diffuse_large_B_cell_lymphoma)',
      'lymphoid_neoplasm (Hodgkin_lymphoma)',
      'lymphoid_neoplasm (mantle_cell_lymphoma)',
      'lymphoid_neoplasm (mycosis_fungoides-Sezary_syndrome)',
      'lymphoid_neoplasm (peripheral_T_cell_lymphoma_unspecified)',
      'lymphoid_neoplasm (plasma_cell_myeloma)',
    ],
  },
  {
    id: 'haematopoietic', label: 'Haematopoietic', labelZh: '髓系造血',
    color: { tab: 'bg-orange-100 text-orange-700 border-orange-300', active: 'bg-orange-500 text-white border-orange-500' },
    diseases: [
      'haematopoietic_neoplasm (acute_myeloid_leukaemia)',
      'haematopoietic_neoplasm (acute_myeloid_leukaemia, M0)',
      'haematopoietic_neoplasm (acute_myeloid_leukaemia, M2)',
      'haematopoietic_neoplasm (acute_myeloid_leukaemia, M3)',
      'haematopoietic_neoplasm (acute_myeloid_leukaemia, M4)',
      'haematopoietic_neoplasm (acute_myeloid_leukaemia, M5)',
      'haematopoietic_neoplasm (acute_myeloid_leukaemia, M5a)',
      'haematopoietic_neoplasm (acute_myeloid_leukaemia, M6)',
      'haematopoietic_neoplasm (acute_myeloid_leukaemia, M7)',
      'haematopoietic_neoplasm (blast_phase_chronic_myeloid_leukaemia)',
      'haematopoietic_neoplasm (blast_phase_chronic_myeloid_leukaemia, Ph_positive)',
      'haematopoietic_neoplasm (chronic_myeloid_leukaemia)',
      'haematopoietic_neoplasm (chronic_myeloid_leukaemia, Ph_positive)',
      'haematopoietic_neoplasm (essential_thrombocythaemia)',
    ],
  },
  {
    id: 'glioma', label: 'Glioma', labelZh: '胶质瘤',
    color: { tab: 'bg-yellow-100 text-yellow-700 border-yellow-300', active: 'bg-yellow-500 text-white border-yellow-500' },
    diseases: [
      'glioma',
      'glioma (astrocytoma)',
      'glioma (astrocytoma_Grade_III)',
      'glioma (astrocytoma_Grade_III, anaplastic)',
      'glioma (astrocytoma_Grade_III-IV)',
      'glioma (astrocytoma_Grade_IV)',
      'glioma (astrocytoma_Grade_IV, glioblastoma_multiforme)',
      'glioma (gliosarcoma)',
      'glioma (oligodendroglioma)',
      'meningioma',
    ],
  },
  {
    id: 'sarcoma', label: 'Sarcoma', labelZh: '肉瘤',
    color: { tab: 'bg-amber-100 text-amber-700 border-amber-300', active: 'bg-amber-600 text-white border-amber-600' },
    diseases: [
      'chondrosarcoma',
      'chondrosarcoma (dedifferentiated)',
      'Ewings_sarcoma-peripheral_primitive_neuroectodermal_tumour',
      'fibrosarcoma',
      'leiomyosarcoma',
      'malignant_fibrous_histiocytoma-pleomorphic_sarcoma',
      'osteosarcoma',
      'rhabdomyosarcoma',
      'rhabdomyosarcoma (alveolar)',
      'rhabdomyosarcoma (embryonal)',
      'sarcoma',
    ],
  },
  {
    id: 'other', label: 'Other', labelZh: '其他',
    color: { tab: 'bg-gray-100 text-gray-600 border-gray-300', active: 'bg-gray-600 text-white border-gray-600' },
    diseases: [
      'neuroblastoma',
      'primitive_neuroectodermal_tumour-medulloblastoma',
      'giant_cell_tumour',
      'malignant_melanoma',
      'mesothelioma',
      'other (hepatoblastoma)',
      'other (immortalized_embryonic_fibroblast)',
      'other (immortalized_epithelial)',
      'other (metaplasia)',
      'other (papilloma)',
      'rhabdoid_tumour',
      'sex_cord-stromal_tumour (granulosa_cell_tumour)',
    ],
  },
];

// ── 染色体配置 ────────────────────────────────────────────────────────────────
const CHROMOSOMES = [
  {id:'chr1',label:'1'},{id:'chr2',label:'2'},{id:'chr3',label:'3'},
  {id:'chr4',label:'4'},{id:'chr5',label:'5'},{id:'chr6',label:'6'},
  {id:'chr7',label:'7'},{id:'chr8',label:'8'},{id:'chr9',label:'9'},
  {id:'chr10',label:'10'},{id:'chr11',label:'11'},{id:'chr12',label:'12'},
  {id:'chr13',label:'13'},{id:'chr14',label:'14'},{id:'chr15',label:'15'},
  {id:'chr16',label:'16'},{id:'chr17',label:'17'},{id:'chr18',label:'18'},
  {id:'chr19',label:'19'},{id:'chr20',label:'20'},{id:'chr21',label:'21'},
  {id:'chr22',label:'22'},{id:'chrX',label:'X'},{id:'chrY',label:'Y'},
];

const colorClasses = {
  blue:   {bg:'bg-blue-50',  hover:'hover:bg-blue-100',  border:'border-blue-200',  heading:'text-blue-800'},
  green:  {bg:'bg-green-50', hover:'hover:bg-green-100', border:'border-green-200', heading:'text-green-800'},
  purple: {bg:'bg-purple-50',hover:'hover:bg-purple-100',border:'border-purple-200',heading:'text-purple-800'},
  red:    {bg:'bg-red-50',   hover:'hover:bg-red-100',   border:'border-red-200',   heading:'text-red-800'},
  orange: {bg:'bg-orange-50',hover:'hover:bg-orange-100',border:'border-orange-200',heading:'text-orange-800'},
};

// ── Tooltip 单元格 ────────────────────────────────────────────────────────────
const TooltipCell = ({ short, full, colorClass = 'text-gray-700' }) => {
  if (!full || full === 'N/A' || full === '') return <span className="text-xs text-gray-400">N/A</span>;
  const needsTip = full.length > 22;
  return (
    <div className="relative group inline-block max-w-[160px]">
      <span className={`text-xs ${colorClass} ${needsTip ? 'underline decoration-dotted cursor-default' : ''} truncate block`}>{short}</span>
      {needsTip && (
        <div className="absolute z-50 invisible group-hover:visible bg-gray-900 text-white text-xs rounded-lg py-2 px-3 left-0 top-full mt-1 w-80 shadow-xl whitespace-normal pointer-events-none">
          <div className="break-words leading-relaxed">{full}</div>
          <div className="absolute -top-1 left-4 w-2 h-2 bg-gray-900 rotate-45" />
        </div>
      )}
    </div>
  );
};

// ==================== Cell Line 柱状图 (SVG，从高到低) ====================
const CellLineChart = ({ data, loading, onFusionClick }) => {
  const { t } = useLanguage();
  const h = t.home;
  const navigate = useNavigate();
  if (loading) return (
    <div className="flex items-center justify-center bg-gray-50 rounded-xl" style={{minHeight:240}}>
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-500 mx-auto mb-2"/>
        <p className="text-xs text-gray-400">Loading...</p>
      </div>
    </div>
  );
  if (!data || data.length === 0) return (
    <div className="flex items-center justify-center bg-gray-50 rounded-xl" style={{minHeight:160}}>
      <p className="text-gray-400 text-sm">{h.chartNoDataForFilter}</p>
    </div>
  );

  const sorted = [...data].sort((a, b) => (b.total_fq||0) - (a.total_fq||0));
  const maxVal = Math.max(...sorted.map(d => d.total_fq||0), 1);
  const BAR_H=18, BAR_GAP=4, ML=158, MR=46, MT=10, MB=20, SVG_W=520;
  const CHART_W = SVG_W - ML - MR;
  const SVG_H   = MT + sorted.length*(BAR_H+BAR_GAP) + MB;
  const LMIN    = 16;

  const handleClick = (fusionName) => {
    if (onFusionClick) {
      onFusionClick(fusionName);
    } else {
      navigate(`/cellfusion-detail/${encodeURIComponent(fusionName)}`);
    }
  };

  return (
    <svg width="100%" viewBox={`0 0 ${SVG_W} ${SVG_H}`}
      style={{fontFamily:"'Inter','Segoe UI',sans-serif",overflow:'visible'}}>
      {sorted.map((item, i) => {
        const y  = MT + i*(BAR_H+BAR_GAP);
        const fh = Math.max(0, item.fq_high||0);
        const fl = Math.max(0, item.fq_low||0);
        const hw = (fh/maxVal)*CHART_W;
        const lw = (fl/maxVal)*CHART_W;
        return (
          <g key={item.fusion_name||i}>
            {/* ★ 融合名可点击跳转详情页 */}
            <text x={ML-4} y={y+BAR_H/2+4} textAnchor="end" fontSize={8.5} fill="#2563eb"
              style={{cursor:'pointer',textDecoration:'underline'}}
              onClick={() => handleClick(item.fusion_name)}>
              {item.fusion_name}
            </text>
            {hw>0 && <rect x={ML} y={y} width={hw} height={BAR_H} fill="#A9A9A9" rx={1.5}/>}
            {hw>LMIN && <text x={ML+hw/2} y={y+BAR_H/2+4} textAnchor="middle" fontSize={8} fontWeight="bold" fill="#000">{Math.round(fh)}</text>}
            {lw>0 && <rect x={ML+hw} y={y} width={lw} height={BAR_H} fill="#CC2929" rx={1.5}/>}
            {lw>LMIN && <text x={ML+hw+lw/2} y={y+BAR_H/2+4} textAnchor="middle" fontSize={8} fontWeight="bold" fill="#fff">{Math.round(fl)}</text>}
            <text x={ML+hw+lw+4} y={y+BAR_H/2+4} fontSize={8.5} fill="#333">{Math.round(fh+fl)}</text>
          </g>
        );
      })}
      <line x1={ML} y1={SVG_H-MB+2} x2={ML+CHART_W} y2={SVG_H-MB+2} stroke="#ccc" strokeWidth={0.8}/>
      <text x={ML+CHART_W/2} y={SVG_H-4} textAnchor="middle" fontSize={9} fill="#888">Frequency (fq)</text>
    </svg>
  );
};

// ==================== 多选疾病选择器（★ 一级分类可多选） ====================
const DiseaseSelector = ({ onApply, disabled, sampleCounts = {} }) => {
  const { t, language } = useLanguage();
  const h = t.home;
  const [expandedCategory, setExpandedCategory] = useState(null);  // 当前展开的分类（用于细调）
  const [selected, setSelected] = useState(new Set());              // 已选疾病名 Set

  // ★ 计算每个一级分类的总样本数（对该分类所有疾病的样本数求和）
  const getCategorySampleCount = (cat) => {
    let total = 0;
    cat.diseases.forEach(d => { total += (sampleCounts[d] || 0); });
    return total;
  };

  const toggleDisease = (d) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(d) ? next.delete(d) : next.add(d);
      return next;
    });
  };

  const toggleAll = (diseases) => {
    const inSet = diseases.every(d => selected.has(d));
    setSelected(prev => {
      const next = new Set(prev);
      diseases.forEach(d => inSet ? next.delete(d) : next.add(d));
      return next;
    });
  };

  // ★ 点击一级分类标签：全选/取消该分类所有疾病 + 展开该分类细调面板
  const handleCategoryClick = (cat) => {
    toggleAll(cat.diseases);
    // 展开该分类方便细调（再次点同一个则收起）
    setExpandedCategory(prev => prev === cat.id ? null : cat.id);
  };

  const currentCategory = DISEASE_CATEGORIES.find(c => c.id === expandedCategory);

  // 判断一级分类是否"全选"
  const isCategoryFullySelected = (cat) => cat.diseases.every(d => selected.has(d));
  // 判断一级分类是否"部分选"
  const isCategoryPartiallySelected = (cat) => cat.diseases.some(d => selected.has(d)) && !isCategoryFullySelected(cat);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-semibold text-gray-600">{h.filterByDiseaseType}</label>
        {selected.size > 0 && (
          <button onClick={() => setSelected(new Set())} className="text-xs text-gray-400 hover:text-red-500 flex items-center gap-0.5">
            <X size={10}/> {h.clearSelection}
          </button>
        )}
      </div>

      {/* ★ 一级分类标签行 — 点击直接全选/取消该类所有疾病，支持多选 */}
      <div className="flex flex-wrap gap-1.5 mb-2">
        {DISEASE_CATEGORIES.map(cat => {
          const fullySelected = isCategoryFullySelected(cat);
          const partiallySelected = isCategoryPartiallySelected(cat);
          const selectedInCat = cat.diseases.filter(d => selected.has(d)).length;
          const isExpanded = expandedCategory === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => handleCategoryClick(cat)}
              disabled={disabled}
              className={`relative px-2 py-1 text-xs rounded-md border font-medium transition-all
                ${fullySelected ? cat.color.active
                  : partiallySelected ? `${cat.color.tab} ring-2 ring-offset-1 ring-current`
                  : cat.color.tab}
                ${isExpanded ? 'ring-2 ring-offset-1 ring-blue-400' : ''}
                disabled:opacity-50`}
            >
              {language === 'zh' ? cat.labelZh : cat.label}
              {selectedInCat > 0 && !fullySelected && (
                <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
                  {selectedInCat}
                </span>
              )}
              {fullySelected && (
                <span className="absolute -top-1.5 -right-1.5 bg-green-500 text-white text-[9px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
                  ✓
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 当前展开分类的复选框列表（用于细调单个疾病） */}
      {currentCategory && (
        <div className="border border-gray-200 rounded-lg bg-white overflow-hidden mb-2">
          <div className="flex items-center justify-between px-2.5 py-1.5 bg-gray-50 border-b border-gray-200">
            <span className="text-xs font-semibold text-gray-600">{language === 'zh' ? currentCategory.labelZh : currentCategory.label}</span>
            <button
              onClick={() => toggleAll(currentCategory.diseases)}
              className="text-xs text-blue-500 hover:text-blue-700 font-medium"
            >
              {currentCategory.diseases.every(d => selected.has(d)) ? h.deselectAll : h.selectAll}
            </button>
          </div>
          <div className="max-h-44 overflow-y-auto p-1.5 space-y-0.5 custom-scrollbar">
            {currentCategory.diseases.map(d => {
              const n = sampleCounts[d];
              return (
                <label key={d}
                  className="flex items-start gap-2 px-1.5 py-1 rounded hover:bg-gray-50 cursor-pointer group"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(d)}
                    onChange={() => toggleDisease(d)}
                    className="mt-0.5 h-3 w-3 accent-red-500 cursor-pointer flex-shrink-0"
                  />
                  <span className="text-xs text-gray-700 leading-tight break-words" title={d}>
                    {d}{n != null ? ` (n=${n})` : ''}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* 已选标签预览 */}
      {selected.size > 0 && (
        <div className="mb-2">
          <p className="text-xs text-gray-500 mb-1">{h.selectedDiseasesCount(selected.size)}</p>
          <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto custom-scrollbar">
            {[...selected].map(d => (
              <span key={d}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-red-50 text-red-700 border border-red-200 rounded text-[10px] font-medium"
              >
                <span className="max-w-[140px] truncate" title={d}>{d}{sampleCounts[d] != null ? ` (n=${sampleCounts[d]})` : ''}</span>
                <button onClick={() => toggleDisease(d)} className="hover:text-red-900 flex-shrink-0">
                  <X size={9}/>
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Apply 按钮 */}
      <button
        onClick={() => onApply([...selected])}
        disabled={disabled || selected.size === 0}
        className="w-full py-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-semibold rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {selected.size === 0 ? h.pleaseSelectDisease : h.drawSelectedDiseases(selected.size)}
      </button>
    </div>
  );
};

// ==================== Cell Line 模块 ====================
const CellLineModule = () => {
  const { t } = useLanguage();
  const h = t.home;
  const [overallTop20,  setOverallTop20]  = useState([]);
  const [filteredTop20, setFilteredTop20] = useState(null);
  const [cellLineInput,  setCellLineInput]  = useState('');
  const [activeCellLine, setActiveCellLine] = useState('');
  const [activeDiseases, setActiveDiseases] = useState([]);
  const [chartLoading,  setChartLoading]  = useState(true);
  const [filterLoading, setFilterLoading] = useState(false);
  const [diseaseSampleCounts, setDiseaseSampleCounts] = useState({});  // ★ 疾病样本计数

  useEffect(() => {
    setChartLoading(true);
    fetchWithAuth('/api/cellfusion/top20')
      .then(async res => { if (res.ok) { const d=await res.json(); setOverallTop20(d?.data||[]); } })
      .catch(console.error)
      .finally(() => setChartLoading(false));

    // ★ 获取疾病样本计数
    fetchWithAuth('/api/cellfusion/disease-sample-counts')
      .then(async res => { if (res.ok) { const d=await res.json(); setDiseaseSampleCounts(d?.data||{}); } })
      .catch(console.error);
  }, []);

  // 疾病多选 apply
  const handleDiseaseApply = async (diseases) => {
    setActiveDiseases(diseases);
    setActiveCellLine('');
    setCellLineInput('');
    if (!diseases.length) { setFilteredTop20(null); return; }
    setFilterLoading(true);
    try {
      const param = diseases.join('|');
      const res = await fetchWithAuth(`/api/cellfusion/top20?diseases=${encodeURIComponent(param)}`);
      if (res.ok) { const d=await res.json(); setFilteredTop20(d?.data||[]); }
    } catch(e){console.error(e);}
    finally { setFilterLoading(false); }
  };

  // 细胞系搜索 — ★ 不再绘图，仅设置 activeCellLine 以显示下载按钮
  const handleCellLineSearch = async () => {
    const q = cellLineInput.trim();
    if (!q) return;
    setActiveCellLine(q);
    setActiveDiseases([]);
    setFilteredTop20(null);  // ★ 不设置图表数据
  };

  const handleClear = () => {
    setActiveDiseases([]);
    setActiveCellLine('');
    setCellLineInput('');
    setFilteredTop20(null);
  };

  // ★ 下载细胞系相关数据为 CSV
  const handleDownloadCellLine = async () => {
    if (!activeCellLine) return;
    try {
      const res = await fetchWithAuth(`/api/cellfusion/cellline-download?cell_line=${encodeURIComponent(activeCellLine)}`);
      if (!res.ok) { console.error('Download failed', res.status); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cellfusion_${activeCellLine.replace(/\s+/g, '_')}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) { console.error('Download error:', e); }
  };

  const displayData = filteredTop20 !== null ? filteredTop20 : overallTop20;
  const isFiltered  = filteredTop20 !== null;
  const filterDesc  = activeDiseases.length > 0
    ? h.diseasesFilterDesc(activeDiseases.length)
    : activeCellLine ? h.cellLineFilterDesc(activeCellLine) : '';

  return (
    <div className="bg-white rounded-2xl shadow-lg p-6">
      {/* 标题 */}
      <div className="mb-5 pb-4 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-red-100 rounded-lg"><FlaskConical size={20} className="text-red-600"/></div>
          <div>
            <h2 className="text-2xl font-bold text-red-800">SNIFFER Cell Line Analysis</h2>
            <p className="text-sm text-gray-500 mt-0.5">{h.cellLineModuleSubtitle}</p>
          </div>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[['103',h.diseaseTypesLabel,'from-red-500 to-rose-600'],['1,019',h.cellLineSamplesLabel,'from-orange-500 to-amber-500'],['25',h.tissueOriginsLabel,'from-amber-500 to-yellow-500']].map(([n,l,g])=>(
          <div key={l} className={`bg-gradient-to-br ${g} rounded-xl p-4 text-white text-center shadow-md`}>
            <p className="text-3xl font-bold">{n}</p>
            <p className="text-xs opacity-90 mt-1.5 font-medium">{l}</p>
          </div>
        ))}
      </div>

      {/* 图表 + 筛选 */}
      <div className="flex gap-5 items-start">

        {/* 左侧图表 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <BarChart2 size={14} className="text-red-500"/>
              {isFiltered ? `Top 20 Fusions · ${filterDesc}` : activeCellLine ? `Cell Line: ${activeCellLine}` : 'Top 20 Fusion Genes by Frequency'}
            </h3>
            {(isFiltered || activeCellLine) && (
              <button onClick={handleClear} className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700">
                <X size={12}/> {h.clearFilter}
              </button>
            )}
          </div>
          <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
            {activeCellLine ? (
              <div className="flex flex-col items-center justify-center py-12 gap-4">
                <FlaskConical size={36} className="text-red-400"/>
                <p className="text-sm text-gray-600 font-medium">Cell Line: <span className="text-red-700 font-bold">{activeCellLine}</span></p>
                <p className="text-xs text-gray-500">可下载该细胞系的融合详情数据</p>
                <button onClick={handleDownloadCellLine}
                  className="flex items-center gap-2 px-5 py-2.5 bg-green-500 hover:bg-green-600 text-white text-sm font-semibold rounded-lg transition shadow-md hover:shadow-lg">
                  <Download size={16}/> {h.downloadCellLineData(activeCellLine)}
                </button>
              </div>
            ) : (
              <CellLineChart data={displayData} loading={chartLoading || filterLoading}/>
            )}
          </div>
        </div>

        {/* 右侧筛选面板 */}
        <div className="w-80 flex-shrink-0">
          <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 space-y-4">

            {/* 图例 */}
            <div className="flex flex-col gap-1.5 p-2.5 bg-white rounded-lg border border-gray-200">
              <div className="flex items-center gap-2">
                <div className="w-5 h-3 rounded-sm flex-shrink-0" style={{backgroundColor:'#A9A9A9'}}/>
                <span className="text-xs text-gray-600">FFPM ≥ 0.1 (STAR-Fusion detectable)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-5 h-3 rounded-sm flex-shrink-0" style={{backgroundColor:'#CC2929'}}/>
                <span className="text-xs text-gray-600">FFPM &lt; 0.1 (SNIFFER unique)</span>
              </div>
            </div>

            {/* 疾病多选器 */}
            <DiseaseSelector onApply={handleDiseaseApply} disabled={filterLoading} sampleCounts={diseaseSampleCounts}/>

            {/* 分隔 */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200"/></div>
              <div className="relative flex justify-center text-xs"><span className="px-2 bg-gray-50 text-gray-400">or</span></div>
            </div>

            {/* 细胞系搜索 */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">{h.searchByCellLine}</label>
              <div className="flex gap-2">
                <input
                  type="text" value={cellLineInput}
                  onChange={e=>setCellLineInput(e.target.value)}
                  onKeyPress={e=>e.key==='Enter'&&handleCellLineSearch()}
                  placeholder="e.g. MCF7, HeLa..."
                  disabled={filterLoading}
                  className="flex-1 border border-gray-300 rounded-lg px-2.5 py-2 text-xs focus:border-red-400 focus:outline-none disabled:opacity-60"
                />
                <button onClick={handleCellLineSearch} disabled={filterLoading||!cellLineInput.trim()}
                  className="px-2.5 py-2 bg-red-500 text-white rounded-lg text-xs hover:bg-red-600 transition disabled:opacity-50 flex items-center">
                  <Search size={12}/>
                </button>
              </div>
            </div>

            {/* 加载中 */}
            {filterLoading && (
              <div className="text-center py-2">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-red-500 mx-auto"/>
                <p className="text-xs text-gray-400 mt-1">Loading...</p>
              </div>
            )}

            {/* 无结果提示 */}
            {isFiltered && !filterLoading && filteredTop20?.length===0 && (
              <div className="p-2.5 bg-yellow-50 rounded-lg border border-yellow-200">
                <p className="text-xs text-yellow-700">{h.noFusionForFilter}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ==================== 低可信度融合基因表格 ====================
const DeletedFusionsTable = () => {
  const { t } = useLanguage();
  const h = t.home;
  const navigate = useNavigate();
  const [filterTypes, setFilterTypes] = useState([]);
  const [selectedFilter, setSelectedFilter] = useState('');
  const [deletedFusions, setDeletedFusions] = useState([]);
  const [deletedLoading, setDeletedLoading] = useState(true);
  const [deletedPage, setDeletedPage] = useState(1);
  const PER_PAGE = 10;

  const extractAfterCaret = (v) => { if (!v) return 'N/A'; const p=String(v).split('^'); return p.length>1?p[1]:p[0]; };

  useEffect(()=>{
    fetchWithAuth('/api/deleted/filters').then(async r=>{if(r.ok){const d=await r.json();setFilterTypes(d?.data||[]);}}).catch(console.error);
  },[]);

  useEffect(()=>{
    setDeletedLoading(true); setDeletedPage(1);
    const url=selectedFilter?`/api/deleted/top100?filter_type=${encodeURIComponent(selectedFilter)}`:'/api/deleted/top100';
    fetchWithAuth(url).then(async r=>{if(r.ok){const d=await r.json();setDeletedFusions(d?.data?.items||[]);}}).catch(console.error).finally(()=>setDeletedLoading(false));
  },[selectedFilter]);

  const totalPages = Math.ceil(deletedFusions.length / PER_PAGE);
  const pageData   = deletedFusions.slice((deletedPage-1)*PER_PAGE, deletedPage*PER_PAGE);

  return (
    <div className="bg-white rounded-2xl shadow-lg p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-2xl font-bold text-red-800">{h.deletedTitle}</h2>
          <p className="text-sm text-gray-500 mt-1">{h.deletedSubtitle}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Filter size={16} className="text-red-500"/>
          <label className="text-sm font-medium text-gray-700 whitespace-nowrap">{h.filterLabel}</label>
          <select value={selectedFilter} onChange={e=>setSelectedFilter(e.target.value)}
            className="border-2 border-red-200 rounded-lg px-3 py-2 text-sm focus:border-red-400 focus:outline-none bg-white min-w-[220px] cursor-pointer">
            <option value="">{h.filterAll}</option>
            {filterTypes.map(ft=><option key={ft} value={ft}>{ft}</option>)}
          </select>
          {selectedFilter&&<button onClick={()=>setSelectedFilter('')} className="text-xs text-red-500 hover:text-red-700 underline whitespace-nowrap">{h.filterClear}</button>}
        </div>
      </div>

      {selectedFilter&&(
        <div className="mb-3 flex items-center gap-2">
          <span className="text-sm text-gray-600">{h.currentFilter}</span>
          <span className="px-3 py-1 bg-red-100 text-red-700 rounded-full text-sm font-semibold border border-red-200">{selectedFilter}</span>
          <span className="text-sm text-gray-500">{h.totalCount(deletedFusions.length)}</span>
        </div>
      )}

      {deletedLoading ? (
        <div className="text-center py-12"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-red-500 mx-auto mb-3"/><p className="text-red-600 text-sm">{h.deletedLoading}</p></div>
      ) : deletedFusions.length===0 ? (
        <div className="text-center py-12 text-gray-500"><p className="text-lg">{h.noData}</p></div>
      ) : (
        <>
          <div className="overflow-x-auto overflow-y-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gradient-to-r from-red-100 to-orange-100">
                <tr>{['#','Fusion Name','Left Breakpoint','Right Breakpoint','Annots',h.fqLabel,'FFPM','Filter'].map(c=><th key={c} className="px-3 py-3 text-left font-semibold">{c}</th>)}</tr>
              </thead>
              <tbody>
                {pageData.map((row,idx)=>{
                  const gi=(deletedPage-1)*PER_PAGE+idx;
                  const fn=row['Fusion.Name']||row['FusionName']||'N/A';
                  const lg=row['LeftGene']||'N/A', rg=row['RightGene']||'N/A';
                  const lb=row['LeftBreakpoint']||'N/A', rb=row['RightBreakpoint']||'N/A';
                  const ann=row['annots']||'', fqv=row['fq']??row['JunctionReadCount']??0;
                  const ffpm=row['FFPM.cal']||row['FFPM']||'N/A', fv=row['Filter']||'N/A';
                  return (
                    <tr key={gi} className={`border-t hover:bg-red-50 transition ${idx%2===0?'bg-white':'bg-gray-50'}`}>
                      <td className="px-3 py-3 text-gray-600">{gi+1}</td>
                      <td className="px-3 py-3 whitespace-nowrap"><button onClick={()=>navigate(`/fusion-deleted/${encodeURIComponent(fn)}`)} className="text-red-700 hover:text-red-900 font-semibold text-xs hover:underline text-left whitespace-nowrap cursor-pointer">{fn}</button></td>
                      <td className="px-3 py-3 text-xs text-gray-700">{truncate(lb,18)}</td>
                      <td className="px-3 py-3 text-xs text-gray-700">{truncate(rb,18)}</td>
                      <td className="px-3 py-3 text-xs text-gray-700 relative group">
                        <span className="cursor-help">{truncate(ann,15)}</span>
                        {ann&&ann.length>15&&<div className="absolute z-50 invisible group-hover:visible bg-gray-900 text-white text-xs rounded-lg py-2 px-3 left-0 top-full mt-1 w-72 shadow-lg whitespace-normal"><div className="break-words">{ann}</div><div className="absolute -top-1 left-4 w-2 h-2 bg-gray-900 rotate-45"/></div>}
                      </td>
                      <td className="px-3 py-3 text-xs font-semibold text-orange-700">{fqv}</td>
                      <td className="px-3 py-3 text-xs text-gray-700">{ffpm!=='N/A'?parseFloat(ffpm).toFixed(3):'N/A'}</td>
                      <td className="px-3 py-3">
                        <button onClick={()=>setSelectedFilter(fv==='N/A'?'':fv)} title={h.clickToFilter(fv)}
                          className={`px-2 py-1 rounded text-xs font-semibold border transition hover:opacity-80 cursor-pointer whitespace-nowrap ${selectedFilter===fv?'bg-red-500 text-white border-red-500':'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'}`}>
                          {truncate(fv,22)}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {totalPages>1&&(
            <div className="flex items-center justify-between mt-4 pt-4 border-t">
              <span className="text-sm text-gray-600">{h.deletedShowingRange((deletedPage-1)*PER_PAGE+1,Math.min(deletedPage*PER_PAGE,deletedFusions.length),deletedFusions.length)}</span>
              <div className="flex items-center gap-2">
                <button onClick={()=>setDeletedPage(p=>Math.max(1,p-1))} disabled={deletedPage===1} className="p-2 border rounded-lg hover:bg-gray-100 disabled:opacity-50"><ChevronLeft size={18}/></button>
                {Array.from({length:Math.min(5,totalPages)},(_,i)=>{let p=totalPages<=5?i+1:deletedPage<=3?i+1:deletedPage>=totalPages-2?totalPages-4+i:deletedPage-2+i;return<button key={p} onClick={()=>setDeletedPage(p)} className={`w-10 h-10 rounded-lg font-semibold transition ${deletedPage===p?'bg-red-500 text-white':'border hover:bg-gray-100'}`}>{p}</button>;})}
                <button onClick={()=>setDeletedPage(p=>Math.min(totalPages,p+1))} disabled={deletedPage===totalPages} className="p-2 border rounded-lg hover:bg-gray-100 disabled:opacity-50"><ChevronRight size={18}/></button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

// ==================== 主页组件 ====================
const Home = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const h = t.home;

  const [loading, setLoading] = useState(true);
  const stats = { uniqueFusions:203278, uniqueGenes:23108, sampleCount:3157 };

  const [searchQuery,    setSearchQuery]    = useState('');
  const [suggestions,    setSuggestions]    = useState([]);
  const [showSuggestions,setShowSuggestions]= useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const searchRef = useRef(null);

  const [topFusions,   setTopFusions]   = useState([]);
  const [currentPage,  setCurrentPage]  = useState(1);
  const [todayHighlight,setTodayHighlight]=useState(null);
  const [selectedChr,  setSelectedChr]  = useState(null);
  const [hoveredChr,   setHoveredChr]   = useState(null);
  const [cellFusionMap,setCellFusionMap] = useState({});
  const ITEMS = 10;

  useEffect(()=>{
    const load = async () => {
      try {
        setLoading(true);
        const [topRes, mapRes] = await Promise.all([
          fetchWithAuth('/api/fusion/top-fusions-cached'),
          fetchWithAuth('/api/cellfusion/tissue-disease-map'),
        ]);
        if (topRes.ok) {
          const d=await topRes.json(); const items=d?.data?.items||[];
          setTopFusions(items);
          if (items.length>0) setTodayHighlight(items[Math.floor(Math.random()*Math.min(items.length,20))]);
        }
        if (mapRes.ok) { const d=await mapRes.json(); setCellFusionMap(d?.data||{}); }
      } catch(e){console.error(e);}
      finally{setLoading(false);}
    };
    load();
  },[]);

  useEffect(()=>{
    if (searchQuery.trim().length<2){setSuggestions([]);setShowSuggestions(false);return;}
    setSuggestLoading(true);
    const t=setTimeout(async()=>{
      try{const r=await fetchWithAuth(`/api/fusion/search-suggest?q=${encodeURIComponent(searchQuery)}&limit=10`);if(r.ok){const d=await r.json();setSuggestions(d?.data||[]);setShowSuggestions(true);}}
      catch(e){}finally{setSuggestLoading(false);}
    },150);
    return ()=>clearTimeout(t);
  },[searchQuery]);

  useEffect(()=>{
    const h=(e)=>{if(searchRef.current&&!searchRef.current.contains(e.target))setShowSuggestions(false);};
    document.addEventListener('mousedown',h);return()=>document.removeEventListener('mousedown',h);
  },[]);

  const handleSearch=(q=searchQuery)=>{if(q.trim())navigate(`/search?q=${encodeURIComponent(q.trim())}`);}
  const handleSelectSugg=(s)=>{const v=extractGeneName(s.value);setSearchQuery(v);setShowSuggestions(false);handleSearch(v);}
  const handleChrClick=(c)=>{setSelectedChr(c);navigate(`/chromosome/${c}`);}
  const handleFusionClick=(fn)=>navigate(`/fusion/${encodeURIComponent(fn)}`);

  const pageData   = topFusions.slice((currentPage-1)*ITEMS, currentPage*ITEMS);
  const totalPages = Math.ceil(topFusions.length / ITEMS);

  if (loading) return (
    <div className="w-full p-6 min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50">
      <div className="max-w-6xl mx-auto">
        <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-700 mx-auto mb-4"/>
          <p className="text-blue-700 font-semibold">{h.loading}</p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="w-full min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-8">

        {/* Target 横幅 */}
        {/* Target / Cell Line analysis banners */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-700 rounded-2xl shadow-lg p-5 text-white">
            <div className="flex items-center gap-4">
              <div className="p-2.5 bg-white/20 rounded-xl"><Dna size={26}/></div>
              <div>
                <h1 className="text-xl font-bold">{h.targetBannerTitle}</h1>
                <p className="text-sm text-blue-100 mt-0.5">{h.targetBannerSubtitle}</p>
              </div>
            </div>
          </div>
          <div className="bg-gradient-to-r from-orange-500 via-orange-600 to-amber-500 rounded-2xl shadow-lg p-5 text-white">
            <div className="flex items-center gap-4">
              <div className="p-2.5 bg-white/20 rounded-xl"><FlaskConical size={26}/></div>
              <div>
                <h1 className="text-xl font-bold">{h.cellLineBannerTitle}</h1>
                <p className="text-sm text-orange-50 mt-0.5">{h.cellLineBannerSubtitle}</p>
              </div>
            </div>
          </div>
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          {[['from-blue-500 to-blue-600',h.uniqueFusions,stats.uniqueFusions],['from-purple-500 to-purple-600',h.uniqueGenes,stats.uniqueGenes],['from-indigo-500 to-indigo-600',h.sampleCount,stats.sampleCount],['from-orange-500 to-orange-600',h.cellLineSampleCount,1019]].map(([g,l,v])=>(
            <div key={l} className={`bg-gradient-to-br ${g} rounded-xl p-6 shadow-lg text-white`}>
              <h3 className="text-lg font-semibold opacity-90">{l}</h3>
              <p className="text-4xl font-bold mt-2">{v.toLocaleString()}</p>
            </div>
          ))}
        </div>

        {/* 搜索框 */}
        <div className="bg-white rounded-2xl shadow-lg p-6">
          <h2 className="text-2xl font-bold text-blue-800 mb-4">{h.searchTitle}</h2>
          <div ref={searchRef} className="relative">
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20}/>
                <input type="text" value={searchQuery} onChange={e=>setSearchQuery(e.target.value)}
                  onKeyPress={e=>e.key==='Enter'&&handleSearch()} onFocus={()=>suggestions.length>0&&setShowSuggestions(true)}
                  placeholder={h.searchPlaceholder}
                  className="w-full pl-12 pr-4 py-3 border-2 border-blue-300 rounded-lg focus:border-blue-500 focus:outline-none text-lg"/>
                {suggestLoading&&<div className="absolute right-4 top-1/2 -translate-y-1/2"><div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500"/></div>}
              </div>
              <button onClick={()=>handleSearch()} className="px-8 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white font-semibold rounded-lg shadow-md hover:shadow-lg hover:scale-105 transition">{h.searchButton}</button>
            </div>
            {showSuggestions&&suggestions.length>0&&(
              <div className="absolute z-50 w-full mt-2 bg-white border-2 border-blue-200 rounded-lg shadow-xl max-h-80 overflow-y-auto">
                {suggestions.map((item,idx)=>(
                  <div key={idx} onClick={()=>handleSelectSugg(item)} className="px-4 py-3 hover:bg-blue-50 cursor-pointer flex items-center gap-3 border-b border-gray-100 last:border-b-0">
                    <span className={`px-2 py-1 rounded text-xs font-bold ${item.type==='gene'?'bg-green-100 text-green-700':'bg-purple-100 text-purple-700'}`}>
                      {item.type==='gene'?h.suggestionTypeGene:h.suggestionTypeFusion}
                    </span>
                    <span className="font-medium text-gray-800">{extractGeneName(item.value)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {h.searchTip && <p className="text-xs text-gray-500 mt-3">{h.searchTip}</p>}
        </div>

        {/* Circos */}
        <div className="bg-white rounded-2xl shadow-lg p-6">
          <h2 className="text-2xl font-bold text-blue-800 mb-2">{h.circosTitle}</h2>
          <p className="text-sm text-gray-600 mb-4">{h.circosSubtitle}</p>
          <div className="flex gap-6">
            <div className="w-64 flex-shrink-0">
              <div className="bg-gradient-to-b from-gray-50 to-gray-100 rounded-xl p-3 border border-gray-200">
                <h3 className="text-sm font-semibold text-gray-700 mb-3 px-2 flex items-center gap-2">
                  <Dna size={16} className="text-blue-600"/>{h.selectChromosome}
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {CHROMOSOMES.map(chr=>(
                    <button key={chr.id} onClick={()=>handleChrClick(chr.id)} onMouseEnter={()=>setHoveredChr(chr.id)} onMouseLeave={()=>setHoveredChr(null)}
                      className={`px-2 py-2 rounded-lg text-left text-sm font-medium flex items-center gap-2 transition-all duration-200 ${selectedChr===chr.id?'bg-blue-600 text-white shadow-md':hoveredChr===chr.id?'bg-blue-100 text-blue-800':'bg-white text-gray-700 hover:bg-gray-50'} border ${selectedChr===chr.id?'border-blue-500':'border-gray-200'}`}>
                      <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${selectedChr===chr.id?'bg-white/20 text-white':chr.id==='chrX'?'bg-pink-100 text-pink-600':chr.id==='chrY'?'bg-cyan-100 text-cyan-600':parseInt(chr.label)<=11?'bg-blue-100 text-blue-600':'bg-purple-100 text-purple-600'}`}>{chr.label}</span>
                      <span className="whitespace-nowrap">{`chr${chr.label}`}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex-1 flex justify-center items-start">
              <img src="/circos.png" alt="Circos Plot" className="max-w-full h-auto rounded-lg" style={{maxHeight:'720px'}}/>
            </div>
          </div>
        </div>

        {/* Top 100 - 列顺序：Disease in Cell Line、Cell Line 在 fq/FFPM 前 */}
        <div className="bg-white rounded-2xl shadow-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold text-blue-800">{h.top100Title}</h2>
            <span className="text-sm text-gray-500">{h.top100Subtitle}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gradient-to-r from-blue-100 to-indigo-100">
                <tr>
                  <th className="px-3 py-3 text-left font-semibold">#</th>
                  <th className="px-3 py-3 text-left font-semibold">Fusion Name</th>
                  <th className="px-3 py-3 text-left font-semibold">Left Breakpoint</th>
                  <th className="px-3 py-3 text-left font-semibold">Right Breakpoint</th>
                  <th className="px-3 py-3 text-left font-semibold"><span className="flex items-center gap-1"><FlaskConical size={11} className="text-orange-500"/>Disease in Cell Line</span></th>
                  <th className="px-3 py-3 text-left font-semibold"><span className="flex items-center gap-1"><FlaskConical size={11} className="text-red-500"/>Cell Line</span></th>
                  <th className="px-3 py-3 text-left font-semibold">{h.fqLabel}</th>
                  <th className="px-3 py-3 text-left font-semibold">Avg FFPM</th>
                  <th className="px-3 py-3 text-left font-semibold">Annots</th>
                </tr>
              </thead>
              <tbody>
                {pageData.map((fusion,idx)=>{
                  const gi=(currentPage-1)*ITEMS+idx;
                  const info=cellFusionMap[fusion.fusion_name]||{};
                  return (
                    <tr key={fusion.id||gi} className={`border-t hover:bg-blue-50 transition ${idx%2===0?'bg-white':'bg-gray-50'}`}>
                      <td className="px-3 py-3 text-gray-600">{gi+1}</td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <button onClick={()=>handleFusionClick(fusion.fusion_name)} className="text-blue-600 hover:text-blue-800 font-semibold hover:underline text-left whitespace-nowrap">{fusion.fusion_name||'N/A'}</button>
                      </td>
                      <td className="px-3 py-3 text-xs text-gray-700">{truncate(fusion.left_breakpoint,18)}</td>
                      <td className="px-3 py-3 text-xs text-gray-700">{truncate(fusion.right_breakpoint,18)}</td>
                      <td className="px-3 py-3"><DiseaseCell value={info.disease||''}/></td>
                      <td className="px-3 py-3"><CellLineCell value={info.cell_line||''}/></td>
                      <td className="px-3 py-3 text-xs font-semibold text-green-700">{fusion.fq||0}</td>
                      <td className="px-3 py-3 text-xs text-gray-700">{fusion.avg_ffpm?fusion.avg_ffpm.toFixed(3):'N/A'}</td>
                      <td className="px-3 py-3"><AnnotsCell value={fusion.annots}/></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {totalPages>1&&(
            <div className="flex items-center justify-between mt-4 pt-4 border-t">
              <span className="text-sm text-gray-600">{h.showingRange((currentPage-1)*ITEMS+1,Math.min(currentPage*ITEMS,topFusions.length),topFusions.length)}</span>
              <div className="flex items-center gap-2">
                <button onClick={()=>setCurrentPage(p=>Math.max(1,p-1))} disabled={currentPage===1} className="p-2 border rounded-lg hover:bg-gray-100 disabled:opacity-50"><ChevronLeft size={18}/></button>
                {Array.from({length:Math.min(5,totalPages)},(_,i)=>{let p=totalPages<=5?i+1:currentPage<=3?i+1:currentPage>=totalPages-2?totalPages-4+i:currentPage-2+i;return<button key={p} onClick={()=>setCurrentPage(p)} className={`w-10 h-10 rounded-lg font-semibold transition ${currentPage===p?'bg-blue-600 text-white':'border hover:bg-gray-100'}`}>{p}</button>;})}
                <button onClick={()=>setCurrentPage(p=>Math.min(totalPages,p+1))} disabled={currentPage===totalPages} className="p-2 border rounded-lg hover:bg-gray-100 disabled:opacity-50"><ChevronRight size={18}/></button>
              </div>
            </div>
          )}
        </div>

        {/* 低可信度 */}
        <DeletedFusionsTable />

        {/* Cell Line 横幅 */}
        <CellLineModule />

        {/* 今日推荐 */}
        {todayHighlight&&(
          <div className="bg-gradient-to-r from-yellow-50 to-orange-50 rounded-2xl shadow-lg p-6 border-2 border-yellow-200">
            <h2 className="text-2xl font-bold text-orange-800 mb-4">{h.todayHighlight}</h2>
            <div className="bg-white rounded-lg p-6 shadow">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                <div><p className="text-sm text-gray-600 mb-1">{h.fusionName}</p><p className="font-bold text-lg text-gray-900">{todayHighlight.fusion_name||'N/A'}</p></div>
                <div><p className="text-sm text-gray-600 mb-1">{h.leftGene}</p><p className="font-bold text-lg text-blue-700">{extractENSG(todayHighlight.left_gene)}</p></div>
                <div><p className="text-sm text-gray-600 mb-1">{h.rightGene}</p><p className="font-bold text-lg text-purple-700">{extractENSG(todayHighlight.right_gene)}</p></div>
                <div><p className="text-sm text-gray-600 mb-1">{h.frequency}</p><p className="font-bold text-lg text-green-700">{todayHighlight.fq||0}</p></div>
              </div>
              <div className="mt-4 pt-4 border-t border-gray-200">
                <button onClick={()=>handleFusionClick(todayHighlight.fusion_name)}
                  className="bg-gradient-to-r from-orange-500 to-red-500 text-white px-8 py-3 rounded-lg hover:shadow-lg hover:scale-105 transition font-semibold">{h.viewDetails}</button>
              </div>
            </div>
          </div>
        )}

        {/* SNIFFER 简介 */}
        <div className="bg-white rounded-2xl shadow-lg p-6">
          <h2 className="text-2xl font-bold text-blue-800 mb-4">{h.snifferTitle}</h2>
          <div className="mb-5 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
            <img src="/sniffer-workflow.png" alt="SNIFFER workflow" className="w-full h-auto rounded-lg" />
          </div>
          <p className="text-gray-700 leading-7">{h.snifferIntro}</p>
        </div>

        {/* 相关文献 */}
        <div className="bg-white rounded-2xl shadow-lg p-6">
          <h2 className="text-2xl font-bold text-blue-800 mb-4">{h.literatureTitle}</h2>
          <div className="space-y-4">
            {h.literatureList.map((paper,idx)=>{
              const c=colorClasses[paper.color]||colorClasses.blue;
              return (
                <a key={idx} href={paper.href} target="_blank" rel="noopener noreferrer"
                  className={`block p-4 ${c.bg} rounded-lg ${c.hover} transition border ${c.border}`}>
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">📄</span>
                    <div><h3 className={`font-semibold ${c.heading} hover:underline`}>{paper.title}</h3><p className="text-sm text-gray-600 mt-1">{paper.desc}</p></div>
                  </div>
                </a>
              );
            })}
          </div>
        </div>

      </div>

      <footer className="mt-10 py-6 text-center text-sm text-blue-900 bg-blue-100 bg-opacity-70 rounded-t-xl shadow-inner">
        © 2025 Fusion Gene Portal. All rights reserved.
      </footer>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar{width:4px;}
        .custom-scrollbar::-webkit-scrollbar-track{background:#f1f1f1;border-radius:2px;}
        .custom-scrollbar::-webkit-scrollbar-thumb{background:#c1c1c1;border-radius:2px;}
        .custom-scrollbar::-webkit-scrollbar-thumb:hover{background:#a1a1a1;}
      `}</style>
    </div>
  );
};

export default Home;