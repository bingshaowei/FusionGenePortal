// Search.jsx - PASS / 全局搜索 双模式版本 v4
// 变更：原 FILTER 模式改为「全局搜索」，同时搜索 Fusion DB + fusiondeleted CSV
// PASS 模式完全不变
// 全局搜索表格：编号(TP/TF) | FusionName | LeftGene | LeftBP | RightGene | RightBP | Annots | fq | FILTER
// fusiondeleted 来源行淡黄色底；Fusion DB 来源行 FILTER 列显示 PASS

import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search as SearchIcon, X, ChevronDown, ChevronUp, ChevronLeft, ChevronRight } from 'lucide-react';
import CircosChartInteractive from '../components/CircosChart';
import { useLanguage } from '../contexts/LanguageContext';
import JunctionSpanningChart from '../components/JunctionSpanningChart';
import NetworkView from '../components/NetworkView';

// 认证辅助
async function ensureToken() {
  let token = localStorage.getItem('token');
  if (!token) {
    const resp = await fetch('/api/auth/login', { method: 'POST' });
    const data = await resp.json();
    token = data?.access_token;
    if (token) localStorage.setItem('token', token);
  }
  return token;
}
async function fetchWithAuth(url, options = {}, _retries = 0) {
  const token = await ensureToken();
  const headers = { ...(options.headers || {}), Authorization: `Bearer ${token}` };
  const resp = await fetch(url, { ...options, headers });
  if (!resp.ok) {
    const errText = await resp.text();
    console.error(`[${url}] HTTP ${resp.status} →`, errText);
    if ((resp.status === 401 || resp.status === 422) && _retries < 1) {
      localStorage.removeItem('token');
      return fetchWithAuth(url, options, _retries + 1);
    }
  }
  return resp;
}

const SEARCH_RETURN_KEY = 'fusiongp.search.returnState';

const extractGeneId = (fullName) => {
  if (!fullName) return '';
  const parts = fullName.split('^');
  return parts.length > 1 ? parts[1] : parts[0];
};
const extractGeneName = (fullName) => {
  if (!fullName) return '';
  return fullName.split('^')[0];
};

// =====================================================
// 全局搜索：归一化函数
// =====================================================

/** 将 Fusion DB (PASS) 的行归一化，供全局搜索统一展示 */
function normalizePassItemForGlobal(item) {
  return {
    ...item,
    _source: 'pass',
    _displayId: item.id,
    _idPrefix: 'TP',
    _fusionName: item.fusion_name || '',
    _leftGene: item.left_gene || '',
    _leftBreakpoint: item.left_breakpoint || '',
    _rightGene: item.right_gene || '',
    _rightBreakpoint: item.right_breakpoint || '',
    _annots: item.annots || '',
    _fq: item.fq ?? 0,
    _avgFfpm: item.avg_ffpm ?? 0,
    _filter: 'PASS',
    _variantCount: item.variant_count || 1,  // 后端返回的变体数
    // 图表字段对齐
    fusion_name: item.fusion_name || '',
    left_gene: item.left_gene || '',
    right_gene: item.right_gene || '',
    left_breakpoint: item.left_breakpoint || '',
    right_breakpoint: item.right_breakpoint || '',
    fq: item.fq ?? 0,
    avg_ffpm: item.avg_ffpm ?? 0,
    avg_junction_read_count: item.avg_junction_read_count ?? 0,
    avg_spanning_frag_count: item.avg_spanning_frag_count ?? 0,
    id: item.id,
  };
}

/** 将 fusiondeleted CSV (FILTER) 的行归一化，供全局搜索统一展示 */
function normalizeDeletedItemForGlobal(item) {
  const fqVal = parseFloat(item.fq ?? item.junction ?? 0) || 0;
  const ffpmVal = parseFloat(item.ffpm ?? 0) || 0;
  return {
    ...item,
    _source: 'deleted',
    _displayId: item.squeue || '',
    _idPrefix: 'TF',
    _fusionName: item.fusionName || '',
    _leftGene: item.leftGene || '',
    _leftBreakpoint: item.leftBreakpoint || '',
    _rightGene: item.rightGene || '',
    _rightBreakpoint: item.rightBreakpoint || '',
    _annots: item.annots || '',
    _fq: fqVal,
    _avgFfpm: ffpmVal,
    _filter: item.filter || '',
    // 图表字段对齐
    fusion_name: item.fusionName || '',
    left_gene: item.leftGene || '',
    right_gene: item.rightGene || '',
    left_breakpoint: item.leftBreakpoint || '',
    right_breakpoint: item.rightBreakpoint || '',
    fq: fqVal,
    avg_ffpm: ffpmVal,
    avg_junction_read_count: parseFloat(item.junction ?? 0) || 0,
    avg_spanning_frag_count: parseFloat(item.spanningFrag ?? 0) || 0,
    id: item.squeue || '',
  };
}

/** 将 Cell Line DB 的行归一化，供 CL 编号全局搜索展示 */
function normalizeCellfusionItemForGlobal(item) {
  const fqVal = parseFloat(item.fq ?? 0) || 0;
  const ffpmVal = parseFloat(item.avg_ffpm ?? 0) || 0;
  const displayId = item.display_id || item.id || (item.squeue ? `CL${item.squeue}` : '');
  return {
    ...item,
    _source: 'cellfusion',
    _displayId: String(displayId).replace(/^CL/i, ''),
    _idPrefix: 'CL',
    _fusionName: item.fusion_name || '',
    _leftGene: item.left_gene || '',
    _leftBreakpoint: item.left_breakpoint || '',
    _rightGene: item.right_gene || '',
    _rightBreakpoint: item.right_breakpoint || '',
    _annots: item.annots || '',
    _fq: fqVal,
    _avgFfpm: ffpmVal,
    _filter: 'CELL LINE',
    fusion_name: item.fusion_name || '',
    left_gene: item.left_gene || '',
    right_gene: item.right_gene || '',
    left_breakpoint: item.left_breakpoint || '',
    right_breakpoint: item.right_breakpoint || '',
    fq: fqVal,
    avg_ffpm: ffpmVal,
    avg_junction_read_count: parseFloat(item.avg_junction_read_count ?? 0) || 0,
    avg_spanning_frag_count: parseFloat(item.avg_spanning_frag_count ?? 0) || 0,
    id: displayId,
  };
}

/**
 * 按融合名分组（PASS 和 FILTER 各自内部分组）
 * 每个融合名只保留 fq 最高的作为主行，其余存入 _variants 数组
 * 用于表格展示：主行直接显示，_variants 可展开查看
 */
function groupItemsByFusion(items) {
  const map = new Map();
  items.forEach(item => {
    const name = item._fusionName || item.fusion_name || '';
    const source = item._source || 'pass';
    const key = `${source}::${name}`;
    if (!name) return;
    if (!map.has(key)) {
      map.set(key, { ...item, _variants: [] });
    } else {
      const group = map.get(key);
      // 如果新 item 的 fq 更高，把当前主行降级为变体，新 item 成为主行
      if ((item._fq || 0) > (group._fq || 0)) {
        group._variants.push({ ...group, _variants: undefined });
        Object.assign(group, item, { _variants: group._variants });
      } else {
        group._variants.push(item);
      }
    }
  });
  return Array.from(map.values());
}

/**
 * 按融合名合并 junction/spanning 用于图表（PASS 和 FILTER 各自内部合并）
 * 同源同名融合的 junction 和 spanning 值累加，fq 取总和
 */
function mergeItemsForChart(items) {
  const map = new Map();
  items.forEach(item => {
    const name = item.fusion_name || item._fusionName || '';
    const source = item._source || 'pass';
    const key = `${source}::${name}`;
    if (!name) return;
    if (!map.has(key)) {
      map.set(key, { ...item });
    } else {
      const existing = map.get(key);
      existing.avg_junction_read_count = (existing.avg_junction_read_count || 0) + (item.avg_junction_read_count || 0);
      existing.avg_spanning_frag_count = (existing.avg_spanning_frag_count || 0) + (item.avg_spanning_frag_count || 0);
      existing.fq = (existing.fq || 0) + (item.fq || 0);
      existing._fq = (existing._fq || 0) + (item._fq || 0);
    }
  });
  return Array.from(map.values());
}

// =====================================================
// 共用 state hook
// =====================================================
const useSearchState = () => {
  const [globalSearch, setGlobalSearch] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advancedFilterMode, setAdvancedFilterMode] = useState('gene');
  const [leftChr, setLeftChr] = useState('');
  const [rightChr, setRightChr] = useState('');
  const [leftGene, setLeftGene] = useState('');
  const [rightGene, setRightGene] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [sortField, setSortField] = useState('fq');
  const [sortOrder, setSortOrder] = useState('desc');
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [circosData, setCircosData] = useState([]);
  const [circosRange, setCircosRange] = useState({ start: 0, end: 300 });
  const [junctionData, setJunctionData] = useState([]);
  const [junctionRange, setJunctionRange] = useState({ start: 0, end: 20 });
  const [networkData, setNetworkData] = useState([]);
  const [networkRange, setNetworkRange] = useState({ start: 0, end: 20 });
  const [activeTab, setActiveTab] = useState('table');
  return {
    globalSearch, setGlobalSearch,
    showAdvanced, setShowAdvanced,
    advancedFilterMode, setAdvancedFilterMode,
    leftChr, setLeftChr, rightChr, setRightChr,
    leftGene, setLeftGene, rightGene, setRightGene,
    hasSearched, setHasSearched,
    sortField, setSortField, sortOrder, setSortOrder,
    results, setResults, total, setTotal,
    loading, setLoading,
    currentPage, setCurrentPage,
    circosData, setCircosData, circosRange, setCircosRange,
    junctionData, setJunctionData, junctionRange, setJunctionRange,
    networkData, setNetworkData, networkRange, setNetworkRange,
    activeTab, setActiveTab,
  };
};

// ── 括号感知分割（与 Home 页完全一致）────────────────────────────────────────
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
    } else { current += ch; }
  }
  const t = current.trim();
  if (t) items.push(t);
  return items;
};

// Cell Line 列：前 10 个 + badge tooltip，position:fixed 不受 overflow 裁剪
const CfCellLineCell = ({ value }) => {
  const { t } = useLanguage();
  const T = t.search;
  const [pos, setPos] = React.useState(null);
  const ref = React.useRef(null);
  if (!value || value === 'N/A' || value === '') return <span className="text-xs text-gray-400">-</span>;
  const all = smartSplit(value);
  if (all.length === 0) return <span className="text-xs text-gray-400">-</span>;
  const shown = all.slice(0, 10);
  const hidden = all.length - shown.length;
  const shortText = shown.map(c => c.trim()).join('; ');

  const handleMouseEnter = () => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 6, left: rect.left });
    }
  };

  return (
    <div ref={ref} className="relative inline-block max-w-[180px]"
      onMouseEnter={handleMouseEnter} onMouseLeave={() => setPos(null)}>
      <span className="text-xs text-red-700 underline decoration-dotted cursor-default truncate block">
        {shortText}{hidden > 0 && <span className="text-gray-400 ml-0.5">+{hidden}</span>}
      </span>
      {pos && typeof document !== 'undefined' && createPortal(
        <div style={{ position:'fixed', top: pos.top, left: pos.left, zIndex: 9999, maxWidth: 320 }}
          className="bg-gray-900 text-white text-xs rounded-lg py-2 px-3 shadow-xl pointer-events-none">
          <div className="mb-1 text-gray-300 font-semibold">{T.cfAllCellLines(all.length)}</div>
          <div className="flex flex-wrap gap-1">
            {all.map((c, i) => <span key={i} className="px-1.5 py-0.5 bg-gray-700 rounded text-[10px]">{c.trim()}</span>)}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

// Disease 列：前 5 个 + 逐行 tooltip，position:fixed 不受 overflow 裁剪
const CfDiseaseCell = ({ value }) => {
  const { t } = useLanguage();
  const T = t.search;
  const [pos, setPos] = React.useState(null);
  const ref = React.useRef(null);
  if (!value || value === 'N/A' || value === '') return <span className="text-xs text-gray-400">-</span>;
  const all = smartSplit(value);
  if (all.length === 0) return <span className="text-xs text-gray-400">-</span>;
  const shown = all.slice(0, 5);
  const hidden = all.length - shown.length;
  const shortText = shown.map(d => d.length > 22 ? d.slice(0, 22) + '…' : d).join('; ');

  const handleMouseEnter = () => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 6, left: rect.left });
    }
  };

  return (
    <div ref={ref} className="relative inline-block max-w-[180px]"
      onMouseEnter={handleMouseEnter} onMouseLeave={() => setPos(null)}>
      <span className="text-xs text-orange-700 underline decoration-dotted cursor-default truncate block">
        {shortText}{hidden > 0 && <span className="text-gray-400 ml-0.5">+{hidden}</span>}
      </span>
      {pos && typeof document !== 'undefined' && createPortal(
        <div style={{ position:'fixed', top: pos.top, left: pos.left, zIndex: 9999, maxWidth: 380 }}
          className="bg-gray-900 text-white text-xs rounded-lg py-2 px-3 shadow-xl pointer-events-none">
          <div className="mb-1 text-gray-300 font-semibold">{T.cfAllDiseases(all.length)}</div>
          {all.map((d, i) => <div key={i} className="leading-snug py-0.5 border-b border-gray-700 last:border-0">{d}</div>)}
        </div>,
        document.body
      )}
    </div>
  );
};

// Tissue 列：前 5 个 + 逐行 tooltip，position:fixed 不受 overflow 裁剪
const CfTissueCell = ({ value }) => {
  const { t } = useLanguage();
  const T = t.search;
  const [pos, setPos] = React.useState(null);
  const ref = React.useRef(null);
  if (!value || value === 'N/A' || value === '') return <span className="text-xs text-gray-400">-</span>;
  const all = smartSplit(value);
  if (all.length === 0) return <span className="text-xs text-gray-400">-</span>;
  const shown = all.slice(0, 5);
  const hidden = all.length - shown.length;
  const shortText = shown.map(t => t.length > 20 ? t.slice(0, 20) + '…' : t).join('; ');

  const handleMouseEnter = () => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 6, left: rect.left });
    }
  };

  return (
    <div ref={ref} className="relative inline-block max-w-[180px]"
      onMouseEnter={handleMouseEnter} onMouseLeave={() => setPos(null)}>
      <span className="text-xs text-purple-700 underline decoration-dotted cursor-default truncate block">
        {shortText}{hidden > 0 && <span className="text-gray-400 ml-0.5">+{hidden}</span>}
      </span>
      {pos && typeof document !== 'undefined' && createPortal(
        <div style={{ position:'fixed', top: pos.top, left: pos.left, zIndex: 9999, maxWidth: 340 }}
          className="bg-gray-900 text-white text-xs rounded-lg py-2 px-3 shadow-xl pointer-events-none">
          <div className="mb-1 text-gray-300 font-semibold">{T.cfAllTissues(all.length)}</div>
          {all.map((t, i) => <div key={i} className="leading-snug py-0.5 border-b border-gray-700 last:border-0">{t}</div>)}
        </div>,
        document.body
      )}
    </div>
  );
};

// ======================================================
// Cell Line DB：疾病分类（与 Home 页保持一致）
// ======================================================
const CF_DISEASE_CATEGORIES = [
  {
    id: 'carcinoma', label: 'Carcinoma', labelZh: '上皮癌',
    color: { tab: 'bg-red-100 text-red-700 border-red-300', active: 'bg-red-600 text-white border-red-600' },
    diseases: [
      'carcinoma','carcinoma (adenocarcinoma)','carcinoma (anaplastic_carcinoma)',
      'carcinoma (barrett_associated_adenocarcinoma)','carcinoma (bronchioloalveolar_adenocarcinoma)',
      'carcinoma (Brenner_tumour)','carcinoma (carcinosarcoma-malignant_mesodermal_mixed_tumour)',
      'carcinoma (clear_cell_carcinoma)','carcinoma (clear_cell_renal_cell_carcinoma)',
      'carcinoma (diffuse_adenocarcinoma)','carcinoma (ductal_carcinoma)',
      'carcinoma (ductal_carcinoma, medullary)','carcinoma (ductal_carcinoma, papillary)',
      'carcinoma (ductal_carcinoma, squamous_cell_carcinoma)','carcinoma (endometrioid_carcinoma)',
      'carcinoma (follicular_carcinoma)','carcinoma (hepatocellular_carcinoma)',
      'carcinoma (intestinal_adenocarcinoma)','carcinoma (large_cell_carcinoma)',
      'carcinoma (medullary_carcinoma)','carcinoma (metaplastic_carcinoma)',
      'carcinoma (mixed_adenosquamous_carcinoma)','carcinoma (mixed_carcinoma)',
      'carcinoma (mucinous_carcinoma)','carcinoma (mucoepidermoid_carcinoma)',
      'carcinoma (non_small_cell_carcinoma)','carcinoma (papillary_carcinoma)',
      'carcinoma (renal_cell_carcinoma)','carcinoma (serous_carcinoma)',
      'carcinoma (signet_ring_adenocarcinoma)','carcinoma (small_cell_adenocarcinoma)',
      'carcinoma (small_cell_carcinoma)','carcinoma (squamous_cell_carcinoma)',
      'carcinoma (transitional_cell_carcinoma)',
      'carcinoma (transitional_cell_carcinoma, papillary_transitional_cell_carcinoma)',
      'carcinoma (tubular_adenocarcinoma)','carcinoma (undifferentiated_adenocarcinoma)',
      'carcinoma (undifferentiated_carcinoma)','carcinoid-endocrine_tumour',
    ],
  },
  {
    id: 'lymphoid', label: 'Lymphoid', labelZh: '淋巴系统',
    color: { tab: 'bg-purple-100 text-purple-700 border-purple-300', active: 'bg-purple-600 text-white border-purple-600' },
    diseases: [
      'lymphoid_neoplasm','lymphoid_neoplasm (acute_lymphoblastic_B_cell_leukaemia)',
      'lymphoid_neoplasm (acute_lymphoblastic_B_cell_leukaemia, L2)',
      'lymphoid_neoplasm (acute_lymphoblastic_T_cell_leukaemia)',
      'lymphoid_neoplasm (acute_lymphoblastic_T_cell_leukaemia, L2)',
      'lymphoid_neoplasm (adult_T_cell_lymphoma-leukaemia)',
      'lymphoid_neoplasm (anaplastic_large_cell_lymphoma)',
      'lymphoid_neoplasm (B_cell_lymphoma_unspecified)',
      'lymphoid_neoplasm (Burkitt_lymphoma)',
      'lymphoid_neoplasm (chronic_lymphocytic_leukaemia-small_lymphocytic_lymphoma)',
      'lymphoid_neoplasm (diffuse_large_B_cell_lymphoma)',
      'lymphoid_neoplasm (Hodgkin_lymphoma)','lymphoid_neoplasm (mantle_cell_lymphoma)',
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
      'glioma','glioma (astrocytoma)','glioma (astrocytoma_Grade_III)',
      'glioma (astrocytoma_Grade_III, anaplastic)','glioma (astrocytoma_Grade_III-IV)',
      'glioma (astrocytoma_Grade_IV)','glioma (astrocytoma_Grade_IV, glioblastoma_multiforme)',
      'glioma (gliosarcoma)','glioma (oligodendroglioma)','meningioma',
    ],
  },
  {
    id: 'sarcoma', label: 'Sarcoma', labelZh: '肉瘤',
    color: { tab: 'bg-amber-100 text-amber-700 border-amber-300', active: 'bg-amber-600 text-white border-amber-600' },
    diseases: [
      'chondrosarcoma','chondrosarcoma (dedifferentiated)',
      'Ewings_sarcoma-peripheral_primitive_neuroectodermal_tumour',
      'fibrosarcoma','leiomyosarcoma',
      'malignant_fibrous_histiocytoma-pleomorphic_sarcoma',
      'osteosarcoma','rhabdomyosarcoma','rhabdomyosarcoma (alveolar)',
      'rhabdomyosarcoma (embryonal)','sarcoma',
    ],
  },
  {
    id: 'other', label: 'Other', labelZh: '其他',
    color: { tab: 'bg-gray-100 text-gray-600 border-gray-300', active: 'bg-gray-600 text-white border-gray-600' },
    diseases: [
      'neuroblastoma','primitive_neuroectodermal_tumour-medulloblastoma',
      'giant_cell_tumour','malignant_melanoma','mesothelioma',
      'other (hepatoblastoma)','other (immortalized_embryonic_fibroblast)',
      'other (immortalized_epithelial)','other (metaplasia)','other (papilloma)',
      'rhabdoid_tumour','sex_cord-stromal_tumour (granulosa_cell_tumour)',
    ],
  },
];

// Cell Line DB 疾病多选组件（与 Home 页 DiseaseSelector 完全一致）
const CfDiseaseSelector = ({ onApply, disabled }) => {
  const { t, language } = useLanguage();
  const T = t.search;
  const [activeCategory, setActiveCategory] = useState(null);
  const [selected, setSelected] = useState(new Set());

  const toggleDisease = (d) => {
    setSelected(prev => { const n = new Set(prev); n.has(d) ? n.delete(d) : n.add(d); return n; });
  };
  const toggleAll = (diseases) => {
    const inSet = diseases.every(d => selected.has(d));
    setSelected(prev => { const n = new Set(prev); diseases.forEach(d => inSet ? n.delete(d) : n.add(d)); return n; });
  };
  const currentCategory = CF_DISEASE_CATEGORIES.find(c => c.id === activeCategory);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-semibold text-gray-600">{T.cfFilterByDiseaseType}</label>
        {selected.size > 0 && (
          <button onClick={() => setSelected(new Set())} className="text-xs text-gray-400 hover:text-red-500 flex items-center gap-0.5">
            <X size={10}/> {T.cfClearSelection}
          </button>
        )}
      </div>
      {/* 分类标签 */}
      <div className="flex flex-wrap gap-1.5 mb-2">
        {CF_DISEASE_CATEGORIES.map(cat => {
          const isActive = activeCategory === cat.id;
          const selectedInCat = cat.diseases.filter(d => selected.has(d)).length;
          return (
            <button key={cat.id} onClick={() => setActiveCategory(isActive ? null : cat.id)} disabled={disabled}
              className={`relative px-2 py-1 text-xs rounded-md border font-medium transition-all ${isActive ? cat.color.active : cat.color.tab} disabled:opacity-50`}>
              {language === 'zh' ? cat.labelZh : cat.label}
              {selectedInCat > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] rounded-full w-4 h-4 flex items-center justify-center font-bold">{selectedInCat}</span>
              )}
            </button>
          );
        })}
      </div>
      {/* 当前分类复选框列表 */}
      {currentCategory && (
        <div className="border border-gray-200 rounded-lg bg-white overflow-hidden mb-2">
          <div className="flex items-center justify-between px-2.5 py-1.5 bg-gray-50 border-b border-gray-200">
            <span className="text-xs font-semibold text-gray-600">{language === 'zh' ? currentCategory.labelZh : currentCategory.label}</span>
            <button onClick={() => toggleAll(currentCategory.diseases)} className="text-xs text-blue-500 hover:text-blue-700 font-medium">
              {currentCategory.diseases.every(d => selected.has(d)) ? T.cfDeselectAll : T.cfSelectAll}
            </button>
          </div>
          <div className="max-h-44 overflow-y-auto p-1.5 space-y-0.5" style={{scrollbarWidth:'thin'}}>
            {currentCategory.diseases.map(d => (
              <label key={d} className="flex items-start gap-2 px-1.5 py-1 rounded hover:bg-gray-50 cursor-pointer">
                <input type="checkbox" checked={selected.has(d)} onChange={() => toggleDisease(d)}
                  className="mt-0.5 h-3 w-3 accent-red-500 cursor-pointer flex-shrink-0" />
                <span className="text-xs text-gray-700 leading-tight break-words" title={d}>{d}</span>
              </label>
            ))}
          </div>
        </div>
      )}
      {/* 已选标签预览 */}
      {selected.size > 0 && (
        <div className="mb-2">
          <p className="text-xs text-gray-500 mb-1">{T.cfSelectedDiseasesCount(selected.size)}</p>
          <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto" style={{scrollbarWidth:'thin'}}>
            {[...selected].map(d => (
              <span key={d} className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded text-[10px] font-medium">
                <span className="max-w-[140px] truncate" title={d}>{d}</span>
                <button onClick={() => toggleDisease(d)} className="hover:text-red-900 flex-shrink-0"><X size={9}/></button>
              </span>
            ))}
          </div>
        </div>
      )}
      {/* Apply 按钮 */}
      <button
        onClick={() => onApply([...selected])}
        disabled={disabled || selected.size === 0}
        className="w-full py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed">
        {selected.size === 0 ? T.cfPleaseSelectDisease : T.cfFilterSelectedDiseases(selected.size)}
      </button>
    </div>
  );
};

const Search = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t } = useLanguage();
  const T = t.search;

  // dataMode: 'pass' | 'global'（原 'filter' 改为 'global'）
  const [dataMode, setDataMode] = useState('global');
  const passState = useSearchState();
  const globalState = useSearchState();
  const s = dataMode === 'pass' ? passState : globalState;

  // =========== ID搜索开关 ===========
  const [idSearchEnabled, setIdSearchEnabled] = useState(true);

  // =========== 搜索模式：精准 / 模糊 ===========
  const [searchMode, setSearchMode] = useState('fuzzy'); // 'exact' | 'fuzzy'
  const [showSearchModeMenu, setShowSearchModeMenu] = useState(false);
  const searchModeRef = useRef(null);

  // 全局搜索表格：展开的行（key = source::fusionName）
  const [expandedRows, setExpandedRows] = useState(new Set());
  // PASS 变体懒加载缓存 { fusionName: [variant1, variant2, ...] }
  const [variantsCache, setVariantsCache] = useState({});
  const [loadingVariants, setLoadingVariants] = useState(new Set());

  // ===== Cell Line DB 模式专属 state =====
  const [cfFusionQ,          setCfFusionQ]          = useState('');
  const [cfCellLineQ,        setCfCellLineQ]         = useState('');
  const [cfSelectedDiseases, setCfSelectedDiseases]  = useState([]);   // 来自 CfDiseaseSelector
  const [cfShowDiseaseFilter,setCfShowDiseaseFilter] = useState(false);
  const [cfRawResults,  setCfRawResults]  = useState([]);
  const [cfLoading,     setCfLoading]     = useState(false);
  const [cfHasSearched, setCfHasSearched] = useState(false);
  const [cfPage,        setCfPage]        = useState(1);
  const [cfExpandedRows,setCfExpandedRows]= useState(new Set());
  const CF_PER_PAGE = 15;

  // 建议 state
  const [leftGeneSuggestions, setLeftGeneSuggestions] = useState([]);
  const [rightGeneSuggestions, setRightGeneSuggestions] = useState([]);
  const [showLeftSuggestions, setShowLeftSuggestions] = useState(false);
  const [showRightSuggestions, setShowRightSuggestions] = useState(false);
  const leftGeneRef = useRef(null);
  const rightGeneRef = useRef(null);
  const [globalSuggestions, setGlobalSuggestions] = useState([]);
  const [showGlobalSuggestions, setShowGlobalSuggestions] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const globalSearchRef = useRef(null);
  const skipSuggestRef = useRef(false);

  const restoreSearchSnapshot = (snapshot) => {
    if (!snapshot || !snapshot.state) return;
    const target = snapshot.dataMode === 'pass' ? passState : globalState;
    const state = snapshot.state || {};
    setDataMode(snapshot.dataMode || 'global');
    setIdSearchEnabled(snapshot.idSearchEnabled !== false);
    setSearchMode(snapshot.searchMode || 'fuzzy');
    target.setGlobalSearch(state.globalSearch || '');
    target.setShowAdvanced(!!state.showAdvanced);
    target.setAdvancedFilterMode(state.advancedFilterMode || 'gene');
    target.setLeftChr(state.leftChr || '');
    target.setRightChr(state.rightChr || '');
    target.setLeftGene(state.leftGene || '');
    target.setRightGene(state.rightGene || '');
    target.setHasSearched(!!state.hasSearched);
    target.setSortField(state.sortField || 'fq');
    target.setSortOrder(state.sortOrder || 'desc');
    target.setResults(Array.isArray(state.results) ? state.results : []);
    target.setTotal(Number.isFinite(state.total) ? state.total : (Array.isArray(state.results) ? state.results.length : 0));
    target.setLoading(false);
    target.setCurrentPage(state.currentPage || 1);
    target.setCircosData(Array.isArray(state.circosData) ? state.circosData : []);
    target.setCircosRange(state.circosRange || { start: 0, end: 300 });
    target.setJunctionData(Array.isArray(state.junctionData) ? state.junctionData : []);
    target.setJunctionRange(state.junctionRange || { start: 0, end: 20 });
    target.setNetworkData(Array.isArray(state.networkData) ? state.networkData : []);
    target.setNetworkRange(state.networkRange || { start: 0, end: 20 });
    target.setActiveTab(state.activeTab || 'table');
    setExpandedRows(new Set(Array.isArray(snapshot.expandedRows) ? snapshot.expandedRows : []));
    setVariantsCache(snapshot.variantsCache && typeof snapshot.variantsCache === 'object' ? snapshot.variantsCache : {});
    setLoadingVariants(new Set());
  };

  useEffect(() => {
    if (searchParams.get('q') || searchParams.get('chr')) return;
    try {
      const raw = window.sessionStorage.getItem(SEARCH_RETURN_KEY);
      if (!raw) return;
      const snapshot = JSON.parse(raw);
      window.sessionStorage.removeItem(SEARCH_RETURN_KEY);
      restoreSearchSnapshot(snapshot);
    } catch (err) {
      console.warn('[Search] failed to restore previous search state', err);
    }
  }, []);

  const rememberSearchForReturn = () => {
    const state = {
      globalSearch: s.globalSearch,
      showAdvanced: s.showAdvanced,
      advancedFilterMode: s.advancedFilterMode,
      leftChr: s.leftChr,
      rightChr: s.rightChr,
      leftGene: s.leftGene,
      rightGene: s.rightGene,
      hasSearched: s.hasSearched,
      sortField: s.sortField,
      sortOrder: s.sortOrder,
      results: s.results,
      total: s.total,
      currentPage: s.currentPage,
      circosData: s.circosData,
      circosRange: s.circosRange,
      junctionData: s.junctionData,
      junctionRange: s.junctionRange,
      networkData: s.networkData,
      networkRange: s.networkRange,
      activeTab: s.activeTab,
    };
    const snapshot = {
      dataMode,
      idSearchEnabled,
      searchMode,
      expandedRows: Array.from(expandedRows),
      variantsCache,
      state,
    };
    try {
      window.sessionStorage.setItem(SEARCH_RETURN_KEY, JSON.stringify(snapshot));
    } catch (err) {
      try {
        window.sessionStorage.setItem(SEARCH_RETURN_KEY, JSON.stringify({
          ...snapshot,
          variantsCache: {},
          expandedRows: [],
          state: { ...state, results: [], total: 0, circosData: [], junctionData: [], networkData: [] },
        }));
      } catch (fallbackErr) {
        console.warn('[Search] failed to save previous search state', fallbackErr);
      }
    }
  };

  const navigateFromSearch = (path) => {
    rememberSearchForReturn();
    navigate(path, { state: { fromSearch: true } });
  };

  const itemsPerPage = 15;
  const chromosomes = [
    'chr1','chr2','chr3','chr4','chr5','chr6','chr7','chr8','chr9','chr10','chr11','chr12',
    'chr13','chr14','chr15','chr16','chr17','chr18','chr19','chr20','chr21','chr22','chrX','chrY'
  ];
  const sortableFields = [
    { value: 'fq', label: 'Frequency (fq)' },
    { value: 'avg_ffpm', label: 'Avg FFPM' }
  ];

  // =========== 判断是否为 ID 搜索 ===========
  const isPassIdSearch = (str) => {
    if (!idSearchEnabled) return false;
    const u = str.toUpperCase();
    return u.startsWith('TP') && str.length > 2 && /^\d+$/.test(str.slice(2));
  };
  const isFilterIdSearch = (str) => {
    if (!idSearchEnabled) return false;
    const u = str.toUpperCase();
    return u.startsWith('TF') && str.length > 2 && /^\d+$/.test(str.slice(2));
  };
  const isCellLineIdSearch = (str) => {
    if (!idSearchEnabled) return false;
    const u = str.toUpperCase();
    return u.startsWith('CL') && str.length > 2 && /^\d+$/.test(str.slice(2));
  };
  const extractPassId = (str) => parseInt(str.slice(2), 10);

  // =========== 模式切换 ===========
  useEffect(() => {
    setGlobalSuggestions([]);
    setShowGlobalSuggestions(false);
    setLeftGeneSuggestions([]);
    setRightGeneSuggestions([]);
  }, [dataMode]);

  // =========== 全局搜索建议 ===========
  useEffect(() => {
    if (skipSuggestRef.current) { skipSuggestRef.current = false; return; }
    if (s.globalSearch.trim().length < 2) {
      setGlobalSuggestions([]); setShowGlobalSuggestions(false); return;
    }
    if (dataMode === 'pass' && isPassIdSearch(s.globalSearch)) return;
    if (dataMode === 'global' && (isPassIdSearch(s.globalSearch) || isFilterIdSearch(s.globalSearch) || isCellLineIdSearch(s.globalSearch))) return;

    setSuggestLoading(true);
    const timer = setTimeout(async () => {
      try {
        if (dataMode === 'pass') {
          // PASS 模式：只搜 PASS 建议（原逻辑不变）
          const res = await fetchWithAuth(`/api/fusion/search-suggest?q=${encodeURIComponent(s.globalSearch)}&limit=10`);
          if (res.ok) {
            const data = await res.json();
            setGlobalSuggestions(data?.data || []);
            setShowGlobalSuggestions(true);
          }
        } else {
          // 全局搜索模式：同时请求两个来源
          const [passRes, delRes] = await Promise.allSettled([
            fetchWithAuth(`/api/fusion/search-suggest?q=${encodeURIComponent(s.globalSearch)}&limit=6`),
            fetchWithAuth(`/api/deleted/search-suggest?q=${encodeURIComponent(s.globalSearch)}&limit=6`),
          ]);
          const passData = passRes.status === 'fulfilled' && passRes.value.ok ? await passRes.value.json() : null;
          const delData  = delRes.status === 'fulfilled' && delRes.value.ok   ? await delRes.value.json()  : null;
          const passSugg = (passData?.data || []).map(sg => ({ ...sg, _src: 'pass' }));
          const delSugg  = (delData?.data || []).map(sg => ({ ...sg, _src: 'deleted' }));
          const seen = new Set();
          const merged = [];
          for (const sg of [...passSugg, ...delSugg]) {
            const key = extractGeneName(sg.value);
            if (!seen.has(key)) { seen.add(key); merged.push(sg); }
          }
          setGlobalSuggestions(merged.slice(0, 10));
          setShowGlobalSuggestions(true);
        }
      } catch (e) { console.error(e); }
      finally { setSuggestLoading(false); }
    }, 150);
    return () => clearTimeout(timer);
  }, [s.globalSearch, dataMode, idSearchEnabled]);

  // 左侧基因建议
  useEffect(() => {
    if (s.leftGene.trim().length < 2) { setLeftGeneSuggestions([]); setShowLeftSuggestions(false); return; }
    const timer = setTimeout(async () => {
      try {
        if (dataMode === 'pass') {
          const res = await fetchWithAuth(`/api/fusion/gene-suggest?q=${encodeURIComponent(s.leftGene)}&side=left&limit=10`);
          if (res.ok) { const d = await res.json(); setLeftGeneSuggestions(d?.data || []); setShowLeftSuggestions(true); }
        } else {
          const [passRes, delRes] = await Promise.allSettled([
            fetchWithAuth(`/api/fusion/gene-suggest?q=${encodeURIComponent(s.leftGene)}&side=left&limit=6`),
            fetchWithAuth(`/api/deleted/gene-suggest?q=${encodeURIComponent(s.leftGene)}&side=left&limit=6`),
          ]);
          const p = passRes.status === 'fulfilled' && passRes.value.ok ? await passRes.value.json() : null;
          const d = delRes.status === 'fulfilled' && delRes.value.ok   ? await delRes.value.json()  : null;
          const seen = new Set(); const merged = [];
          for (const v of [...(p?.data || []), ...(d?.data || [])]) {
            if (!seen.has(v)) { seen.add(v); merged.push(v); }
          }
          setLeftGeneSuggestions(merged.slice(0, 10)); setShowLeftSuggestions(true);
        }
      } catch (e) {}
    }, 150);
    return () => clearTimeout(timer);
  }, [s.leftGene, dataMode]);

  // 右侧基因建议
  useEffect(() => {
    if (s.rightGene.trim().length < 2) { setRightGeneSuggestions([]); setShowRightSuggestions(false); return; }
    const timer = setTimeout(async () => {
      try {
        if (dataMode === 'pass') {
          const res = await fetchWithAuth(`/api/fusion/gene-suggest?q=${encodeURIComponent(s.rightGene)}&side=right&limit=10`);
          if (res.ok) { const d = await res.json(); setRightGeneSuggestions(d?.data || []); setShowRightSuggestions(true); }
        } else {
          const [passRes, delRes] = await Promise.allSettled([
            fetchWithAuth(`/api/fusion/gene-suggest?q=${encodeURIComponent(s.rightGene)}&side=right&limit=6`),
            fetchWithAuth(`/api/deleted/gene-suggest?q=${encodeURIComponent(s.rightGene)}&side=right&limit=6`),
          ]);
          const p = passRes.status === 'fulfilled' && passRes.value.ok ? await passRes.value.json() : null;
          const d = delRes.status === 'fulfilled' && delRes.value.ok   ? await delRes.value.json()  : null;
          const seen = new Set(); const merged = [];
          for (const v of [...(p?.data || []), ...(d?.data || [])]) {
            if (!seen.has(v)) { seen.add(v); merged.push(v); }
          }
          setRightGeneSuggestions(merged.slice(0, 10)); setShowRightSuggestions(true);
        }
      } catch (e) {}
    }, 150);
    return () => clearTimeout(timer);
  }, [s.rightGene, dataMode]);

  // 点击外部关闭建议
  useEffect(() => {
    const fn = (e) => {
      if (globalSearchRef.current && !globalSearchRef.current.contains(e.target)) setShowGlobalSuggestions(false);
      if (leftGeneRef.current && !leftGeneRef.current.contains(e.target)) setShowLeftSuggestions(false);
      if (rightGeneRef.current && !rightGeneRef.current.contains(e.target)) setShowRightSuggestions(false);
      if (searchModeRef.current && !searchModeRef.current.contains(e.target)) setShowSearchModeMenu(false);
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);

  // ===== Cell Line DB：搜索 =====
  const executeCfSearch = useCallback(async (overrideDiseases) => {
    const diseases = overrideDiseases !== undefined ? overrideDiseases : cfSelectedDiseases;
    if (!cfFusionQ.trim() && !cfCellLineQ.trim() && diseases.length === 0) return;
    setCfLoading(true);
    setCfHasSearched(true);
    setCfPage(1);
    setCfExpandedRows(new Set());
    setCfRawResults([]);
    try {
      const params = new URLSearchParams();
      if (cfFusionQ.trim())   params.append('q',         cfFusionQ.trim());
      if (cfCellLineQ.trim()) params.append('cell_line', cfCellLineQ.trim());
      if (diseases.length > 0) params.append('diseases', diseases.join('|'));
      const res = await fetchWithAuth(`/api/cellfusion/search?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        setCfRawResults(json?.data?.items || []);
      }
    } catch (e) { console.error('[CfSearch]', e); }
    finally { setCfLoading(false); }
  }, [cfFusionQ, cfCellLineQ, cfSelectedDiseases]);

  const handleCfDiseaseApply = (diseases) => {
    setCfSelectedDiseases(diseases);
    executeCfSearch(diseases);
  };

  const handleCfReset = () => {
    setCfFusionQ(''); setCfCellLineQ(''); setCfSelectedDiseases([]);
    setCfRawResults([]); setCfHasSearched(false);
    setCfPage(1); setCfExpandedRows(new Set());
  };

  // ===== Cell Line DB：按 fusion_name 分组 =====
  const cfGrouped = useMemo(() => {
    const map = new Map();
    cfRawResults.forEach(row => {
      const name = row.fusion_name || '';
      if (!map.has(name)) {
        map.set(name, { ...row, _variants: [] });
      } else {
        const g = map.get(name);
        if ((row.fq || 0) > (g.fq || 0)) {
          const vars = [...g._variants, { ...g, _variants: undefined }];
          Object.assign(g, row, { _variants: vars });
        } else {
          g._variants.push(row);
        }
      }
    });
    return Array.from(map.values()).sort((a, b) => (b.fq || 0) - (a.fq || 0));
  }, [cfRawResults]);

  const cfTotalPages = Math.ceil(cfGrouped.length / CF_PER_PAGE);
  const cfPageData   = cfGrouped.slice((cfPage - 1) * CF_PER_PAGE, cfPage * CF_PER_PAGE);

  const abortControllerRef = useRef(null);

  // =========== 核心搜索函数 ===========
  const executeSearch = useCallback(async (overrides) => {
    const {
      search = s.globalSearch,
      leftChrParam = s.leftChr,
      rightChrParam = s.rightChr,
      leftGeneParam = s.leftGene,
      rightGeneParam = s.rightGene,
      sortFieldParam = s.sortField,
      sortOrderParam = s.sortOrder,
    } = overrides || {};

    const searchTrimmed = search.trim();
    if (!searchTrimmed && !leftChrParam && !rightChrParam && !leftGeneParam.trim() && !rightGeneParam.trim()) return;

    if (abortControllerRef.current) abortControllerRef.current.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const signal = abortController.signal;

    s.setLoading(true);
    s.setResults([]);
    s.setTotal(0);
    s.setCurrentPage(1);
    s.setHasSearched(true);

    try {
      const token = await ensureToken();

      // ========== PASS 模式：TP前缀 ID 精确搜索（原逻辑不变） ==========
      if (dataMode === 'pass' && searchTrimmed && isPassIdSearch(searchTrimmed)) {
        const passId = extractPassId(searchTrimmed);
        console.log(`[PASS ID搜索] id=${passId}`);
        const res = await fetch(`/api/fusion/by-id/${passId}`, { headers: { Authorization: `Bearer ${token}` }, signal });
        if (signal.aborted) return;
        if (res.ok) {
          const json = await res.json();
          const item = json?.data;
          if (item) {
            s.setResults([item]); s.setTotal(1);
            s.setCircosData([item]); s.setJunctionData([item]); s.setNetworkData([item]);
          } else { s.setResults([]); s.setTotal(0); }
        } else { s.setResults([]); s.setTotal(0); }
        if (!signal.aborted) s.setLoading(false);
        return;
      }

      // ========== 全局搜索：TP前缀 → 仅搜 Fusion DB ==========
      if (dataMode === 'global' && searchTrimmed && isPassIdSearch(searchTrimmed)) {
        const passId = extractPassId(searchTrimmed);
        console.log(`[全局 TP ID] id=${passId}`);
        const res = await fetch(`/api/fusion/by-id/${passId}`, { headers: { Authorization: `Bearer ${token}` }, signal });
        if (signal.aborted) return;
        if (res.ok) {
          const json = await res.json();
          const item = json?.data;
          if (item) {
            const normalized = [normalizePassItemForGlobal(item)];
            s.setResults(normalized); s.setTotal(1);
            s.setCircosData(normalized); s.setJunctionData(normalized); s.setNetworkData(normalized);
          } else { s.setResults([]); s.setTotal(0); }
        } else { s.setResults([]); s.setTotal(0); }
        if (!signal.aborted) s.setLoading(false);
        return;
      }

      // ========== 全局搜索：TF前缀 → 仅搜 fusiondeleted CSV ==========
      if (dataMode === 'global' && searchTrimmed && isFilterIdSearch(searchTrimmed)) {
        console.log(`[全局 TF ID] squeue=${searchTrimmed.slice(2)}`);
        const res = await fetch(
          `/api/deleted/search/advanced?search=${encodeURIComponent(searchTrimmed)}&id_search=true`,
          { headers: { Authorization: `Bearer ${token}` }, signal }
        );
        if (signal.aborted) return;
        if (res.ok) {
          const json = await res.json();
          const items = (json?.data?.items || []).map(normalizeDeletedItemForGlobal);
          s.setResults(items); s.setTotal(items.length);
          s.setCircosData(items); s.setJunctionData(items); s.setNetworkData(items);
        } else { s.setResults([]); s.setTotal(0); }
        if (!signal.aborted) s.setLoading(false);
        return;
      }

      // ========== 全局搜索：CL前缀 → 仅搜 Cell Line DB ==========
      if (dataMode === 'global' && searchTrimmed && isCellLineIdSearch(searchTrimmed)) {
        console.log(`[全局 CL ID] squeue=${searchTrimmed.slice(2)}`);
        const res = await fetch(
          `/api/cellfusion/search?q=${encodeURIComponent(searchTrimmed)}`,
          { headers: { Authorization: `Bearer ${token}` }, signal }
        );
        if (signal.aborted) return;
        if (res.ok) {
          const json = await res.json();
          const items = (json?.data?.items || []).map(normalizeCellfusionItemForGlobal);
          s.setResults(items); s.setTotal(items.length);
          s.setCircosData(items); s.setJunctionData(items); s.setNetworkData(items);
        } else { s.setResults([]); s.setTotal(0); }
        if (!signal.aborted) s.setLoading(false);
        return;
      }

      // ========== 常规搜索 ==========
      const params = new URLSearchParams();
      const networkParams = new URLSearchParams();

      if (searchTrimmed) {
        params.append('search', searchTrimmed);
        params.append('exact_gene', 'true');
        params.append('strict_match', searchMode === 'exact' ? 'true' : 'false');
        networkParams.append('search', searchTrimmed);
        networkParams.append('exact_gene', 'true');
        networkParams.append('strict_match', searchMode === 'exact' ? 'true' : 'false');
      }
      if (s.advancedFilterMode === 'chromosome') {
        if (leftChrParam) { params.append('left_chr', leftChrParam); networkParams.append('left_chr', leftChrParam); }
        if (rightChrParam) { params.append('right_chr', rightChrParam); networkParams.append('right_chr', rightChrParam); }
      } else {
        if (leftGeneParam.trim()) { params.append('left_gene', leftGeneParam.trim()); networkParams.append('left_gene', leftGeneParam.trim()); }
        if (rightGeneParam.trim()) { params.append('right_gene', rightGeneParam.trim()); networkParams.append('right_gene', rightGeneParam.trim()); }
      }
      params.append('sort_by', sortFieldParam);
      params.append('sort_order', sortOrderParam);
      networkParams.append('limit', '2000');

      if (dataMode === 'pass') {
        // ===== PASS 模式：原逻辑完全不变 =====
        const url = `/api/fusion/search/advanced?${params.toString()}`;
        const networkUrl = `/api/fusion/search/network?${networkParams.toString()}`;
        console.log('[Search][PASS] URL:', url);

        const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal });
        if (signal.aborted) return;
        if (!response.ok) throw new Error('search failed');

        const result = await response.json();
        const items = result?.data?.items || [];
        if (signal.aborted) return;

        const sortedByFq = [...items].sort((a, b) => (b.fq ?? 0) - (a.fq ?? 0));
        s.setResults(items);
        s.setTotal(items.length);
        s.setCircosData(sortedByFq);
        s.setJunctionData(items);

        try {
          const netRes = await fetch(networkUrl, { headers: { Authorization: `Bearer ${token}` }, signal });
          if (signal.aborted) return;
          if (netRes.ok) {
            const text = await netRes.text();
            if (text) { const nr = JSON.parse(text); s.setNetworkData(nr?.data?.items || []); }
            else s.setNetworkData(items);
          } else s.setNetworkData(items);
        } catch (ne) {
          if (ne.name === 'AbortError') return;
          s.setNetworkData(items);
        }

      } else {
        // ===== 全局搜索模式：同时请求 Fusion DB + fusiondeleted CSV =====
        const passUrl = `/api/fusion/search/advanced?${params.toString()}`;
        const delUrl  = `/api/deleted/search/advanced?${params.toString()}`;
        const passNetUrl = `/api/fusion/search/network?${networkParams.toString()}`;
        const delNetUrl  = `/api/deleted/search/network?${networkParams.toString()}`;

        console.log('[全局搜索] PASS URL:', passUrl);
        console.log('[全局搜索] FILTER URL:', delUrl);

        const [passResp, delResp, passNetResp, delNetResp] = await Promise.allSettled([
          fetch(passUrl, { headers: { Authorization: `Bearer ${token}` }, signal }),
          fetch(delUrl,  { headers: { Authorization: `Bearer ${token}` }, signal }),
          fetch(passNetUrl, { headers: { Authorization: `Bearer ${token}` }, signal }),
          fetch(delNetUrl,  { headers: { Authorization: `Bearer ${token}` }, signal }),
        ]);
        if (signal.aborted) return;

        let passItems = [];
        let allDelItems = [];
        if (passResp.status === 'fulfilled' && passResp.value.ok) {
          const json = await passResp.value.json();
          passItems = (json?.data?.items || []).map(normalizePassItemForGlobal);
        }
        if (delResp.status === 'fulfilled' && delResp.value.ok) {
          const json = await delResp.value.json();
          allDelItems = (json?.data?.items || []).map(normalizeDeletedItemForGlobal);
        }

        // 表格用：PASS 和 FILTER 各自按融合名分组，主行取 fq 最高，其余存 _variants
        const allItems = [...passItems, ...allDelItems];
        const grouped = groupItemsByFusion(allItems);
        const reverse = (sortOrderParam === 'desc');
        if (sortFieldParam === 'avg_ffpm') {
          grouped.sort((a, b) => reverse ? b._avgFfpm - a._avgFfpm : a._avgFfpm - b._avgFfpm);
        } else {
          grouped.sort((a, b) => reverse ? b._fq - a._fq : a._fq - b._fq);
        }

        if (signal.aborted) return;
        s.setResults(grouped);
        s.setTotal(grouped.length);
        s.setCircosData([...grouped].sort((a, b) => b._fq - a._fq));

        // Junction 图用：PASS 和 FILTER 各自按融合名合并 junction/spanning
        const chartData = mergeItemsForChart(allItems);
        s.setJunctionData(chartData);

        let passNetItems = [];
        let delNetItems  = [];
        if (passNetResp.status === 'fulfilled' && passNetResp.value.ok) {
          try { const t = await passNetResp.value.text(); if (t) { const nr = JSON.parse(t); passNetItems = (nr?.data?.items || []).map(normalizePassItemForGlobal); } } catch (e) {}
        }
        if (delNetResp.status === 'fulfilled' && delNetResp.value.ok) {
          try { const t = await delNetResp.value.text(); if (t) { const nr = JSON.parse(t); delNetItems = (nr?.data?.items || []).map(normalizeDeletedItemForGlobal); } } catch (e) {}
        }
        const mergedNet = groupItemsByFusion([...passNetItems, ...delNetItems]);
        s.setNetworkData(mergedNet.length > 0 ? mergedNet : merged);
      }

    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('搜索失败:', err);
      s.setResults([]); s.setNetworkData([]);
    } finally {
      if (!signal.aborted) s.setLoading(false);
    }
  }, [s.globalSearch, s.leftChr, s.rightChr, s.leftGene, s.rightGene, s.sortField, s.sortOrder, s.advancedFilterMode, dataMode, idSearchEnabled, searchMode]);

  const doSearch = useCallback(() => executeSearch(), [executeSearch]);

  // 主搜索按钮：保留高级筛选条件，联动执行
  const doMainSearch = useCallback(() => {
    executeSearch();
  }, [executeSearch]);

  // 独立高级搜索：仅用高级筛选条件（清空主搜索关键字）
  const doAdvancedOnlySearch = useCallback(() => {
    s.setGlobalSearch('');
    executeSearch({ search: '' });
  }, [executeSearch, s]);

  // URL 参数读取（PASS 模式 + 全局搜索模式）
  useEffect(() => {
    const q = searchParams.get('q');
    const chr = searchParams.get('chr');
    if (!q && !chr) return;

    if (dataMode === 'pass') {
      if (q) passState.setGlobalSearch(q);
      if (chr) { passState.setLeftChr(chr); passState.setShowAdvanced(true); passState.setAdvancedFilterMode('chromosome'); }
      setTimeout(() => executeSearch({ search: q || '', leftChrParam: chr || '' }), 100);
    } else if (dataMode === 'global') {
      if (q) globalState.setGlobalSearch(q);
      setTimeout(() => executeSearch({ search: q || '' }), 100);
    }
  }, [searchParams, dataMode]);

  // 高级筛选变化
  const handleFilterModeChange = (mode) => {
    s.setAdvancedFilterMode(mode);
    if (mode === 'chromosome') { s.setLeftGene(''); s.setRightGene(''); if (s.hasSearched) executeSearch({ leftGeneParam: '', rightGeneParam: '' }); }
    else { s.setLeftChr(''); s.setRightChr(''); if (s.hasSearched) executeSearch({ leftChrParam: '', rightChrParam: '' }); }
  };
  const handleLeftChrChange = (v) => { s.setLeftChr(v); executeSearch({ leftChrParam: v }); };
  const handleRightChrChange = (v) => { s.setRightChr(v); executeSearch({ rightChrParam: v }); };
  const handleSortFieldChange = (v) => { s.setSortField(v); if (s.hasSearched) executeSearch({ sortFieldParam: v }); };
  const handleSortOrderChange = (v) => { s.setSortOrder(v); if (s.hasSearched) executeSearch({ sortOrderParam: v }); };

  const handleReset = () => {
    s.setGlobalSearch(''); s.setLeftChr(''); s.setRightChr(''); s.setLeftGene(''); s.setRightGene('');
    s.setResults([]); s.setTotal(0); s.setCircosData([]); s.setJunctionData([]); s.setNetworkData([]);
    s.setSortField('fq'); s.setSortOrder('desc'); s.setCurrentPage(1); s.setHasSearched(false);
    s.setAdvancedFilterMode('gene');
    setGlobalSuggestions([]);
    setExpandedRows(new Set());
    setVariantsCache({});
    setLoadingVariants(new Set());
    if (dataMode === 'pass') navigate('/search', { replace: true });
  };

  const handleFusionClick = (fusionName) => navigateFromSearch(`/fusion/${encodeURIComponent(fusionName)}`);

  const handleGlobalCircosClick = (id) => {
    const f = s.circosData.find(x => x.id === id || x._displayId === id || String(x.id) === String(id));
    if (f) {
      const name = f.fusion_name || f._fusionName;
      if (name) navigateFromSearch(`/fusion/${encodeURIComponent(name)}`);
    }
  };

  const handleChromosomeClick = (chrName) => {
    s.setLeftChr(chrName); s.setShowAdvanced(true); s.setAdvancedFilterMode('chromosome'); s.setActiveTab('table'); s.setHasSearched(true);
    executeSearch({ leftChrParam: chrName });
  };

  const handleSelectGlobalSuggestion = (suggestion) => {
    const displayValue = extractGeneName(suggestion.value);
    skipSuggestRef.current = true;
    s.setGlobalSearch(displayValue);
    setShowGlobalSuggestions(false);
    s.setLeftChr(''); s.setRightChr(''); s.setLeftGene(''); s.setRightGene('');
    s.setSortField('fq'); s.setSortOrder('desc');
    executeSearch({ search: displayValue, leftChrParam: '', rightChrParam: '', leftGeneParam: '', rightGeneParam: '', sortFieldParam: 'fq', sortOrderParam: 'desc' });
  };

  const handleSelectLeftGene = (gene) => {
    const n = extractGeneName(gene); s.setLeftGene(n); setShowLeftSuggestions(false);
    if (s.hasSearched) executeSearch({ leftGeneParam: n });
  };
  const handleSelectRightGene = (gene) => {
    const n = extractGeneName(gene); s.setRightGene(n); setShowRightSuggestions(false);
    if (s.hasSearched) executeSearch({ rightGeneParam: n });
  };

  const leftGeneTimerRef = useRef(null);
  const rightGeneTimerRef = useRef(null);
  const handleLeftGeneInputChange = (v) => {
    s.setLeftGene(v);
    if (leftGeneTimerRef.current) clearTimeout(leftGeneTimerRef.current);
    leftGeneTimerRef.current = setTimeout(() => executeSearch({ leftGeneParam: v }), 500);
  };
  const handleRightGeneInputChange = (v) => {
    s.setRightGene(v);
    if (rightGeneTimerRef.current) clearTimeout(rightGeneTimerRef.current);
    rightGeneTimerRef.current = setTimeout(() => executeSearch({ rightGeneParam: v }), 500);
  };

  // 分页
  const getCurrentPageData = () => s.results.slice((s.currentPage - 1) * itemsPerPage, s.currentPage * itemsPerPage);
  const totalPages = Math.ceil(s.results.length / itemsPerPage);
  const goToPage = (page) => { if (page >= 1 && page <= totalPages) { s.setCurrentPage(page); window.scrollTo({ top: 0, behavior: 'smooth' }); } };

  // =========== 可视化数据切片 ===========
  const getCircosDisplayData = () => s.circosData.slice(s.circosRange.start, Math.min(s.circosRange.end, s.circosData.length));
  const getJunctionDisplayData = () =>
    [...s.junctionData]
      .sort((a, b) => ((b.avg_junction_read_count || 0) + (b.avg_spanning_frag_count || 0)) - ((a.avg_junction_read_count || 0) + (a.avg_spanning_frag_count || 0)))
      .slice(s.junctionRange.start, Math.min(s.junctionRange.end, s.junctionData.length));
  const getNetworkDisplayData = () =>
    [...s.networkData]
      .sort((a, b) => (b.fq || 0) - (a.fq || 0))
      .slice(s.networkRange.start, Math.min(s.networkRange.end, s.networkData.length, 300));

  const getSearchDescription = () => {
    const parts = [];
    if (s.globalSearch) parts.push(T.descSearch(s.globalSearch));
    if (s.advancedFilterMode === 'chromosome') {
      if (s.leftChr) parts.push(T.descLeftChr(s.leftChr));
      if (s.rightChr) parts.push(T.descRightChr(s.rightChr));
    } else {
      if (s.leftGene) parts.push(T.descLeftGene(s.leftGene));
      if (s.rightGene) parts.push(T.descRightGene(s.rightGene));
    }
    return parts.length > 0 ? `(${parts.join(', ')})` : '';
  };

  const hasAdvancedFilter = () => s.advancedFilterMode === 'chromosome' ? (s.leftChr || s.rightChr) : (s.leftGene || s.rightGene);

  const handleDataModeChange = (mode) => {
    setDataMode(mode);
    setGlobalSuggestions([]); setShowGlobalSuggestions(false);
    setLeftGeneSuggestions([]); setRightGeneSuggestions([]);
  };

  const idPrefixHint = dataMode === 'pass' ? 'TP' : 'TP/TF/CL';
  const passCount = dataMode === 'global' ? s.results.filter(r => r._source === 'pass').length : 0;
  const deletedCount = dataMode === 'global' ? s.results.filter(r => r._source === 'deleted').length : 0;

  const hasSearchCondition = dataMode === 'cellline'
    ? (cfFusionQ || cfCellLineQ || cfSelectedDiseases.length > 0)
    : (s.globalSearch || s.leftChr || s.rightChr || s.leftGene || s.rightGene);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 p-6">
      <div className="max-w-[98%] mx-auto space-y-6">

        {/* 标题 */}
        <div className="text-center mb-4">
          <h1 className="text-4xl font-bold text-blue-900 mb-2">{T.pageTitle}</h1>
          <p className="text-gray-600">{T.pageSubtitle}</p>
        </div>

        {/* PASS / 全局搜索 / Cell Line DB 滑动切换 */}
        <div className="flex justify-center">
          <div className="relative flex bg-gray-200 rounded-full p-1 shadow-inner" style={{width:'520px'}}>
            <div className={`absolute top-1 bottom-1 rounded-full shadow-md transition-all duration-300 ease-in-out ${
              dataMode === 'global'   ? 'left-1 bg-gradient-to-r from-emerald-500 to-teal-600'
              : dataMode === 'pass'  ? 'bg-gradient-to-r from-blue-500 to-blue-600'
              :                        'bg-gradient-to-r from-amber-500 to-orange-500'
            }`} style={{
              width: 'calc(33.33% - 4px)',
              left: dataMode === 'global' ? '4px' : dataMode === 'pass' ? 'calc(33.33% + 2px)' : 'calc(66.66% + 0px)',
            }} />
            <button onClick={() => handleDataModeChange('global')}
              className={`relative flex-1 py-2.5 px-3 rounded-full text-sm font-bold transition-colors duration-300 z-10 flex items-center justify-center gap-1.5 ${dataMode === 'global' ? 'text-white' : 'text-gray-500 hover:text-gray-700'}`}>
              <span>🌐</span> {T.modeGlobal}
            </button>
            <button onClick={() => handleDataModeChange('pass')}
              className={`relative flex-1 py-2.5 px-3 rounded-full text-sm font-bold transition-colors duration-300 z-10 flex items-center justify-center gap-1.5 ${dataMode === 'pass' ? 'text-white' : 'text-gray-500 hover:text-gray-700'}`}>
              <span>✅</span> {T.modePass}
            </button>
            <button onClick={() => handleDataModeChange('cellline')}
              className={`relative flex-1 py-2.5 px-3 rounded-full text-sm font-bold transition-colors duration-300 z-10 flex items-center justify-center gap-1.5 ${dataMode === 'cellline' ? 'text-white' : 'text-gray-500 hover:text-gray-700'}`}>
              <span>🧫</span> Cell Line DB
            </button>
          </div>
        </div>

        {/* 模式标签 */}
        <div className="flex justify-center">
          {dataMode === 'pass'
            ? <div className="flex items-center gap-2 px-4 py-1.5 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold">{T.modeLabelPass}</div>
            : dataMode === 'global'
            ? <div className="flex items-center gap-2 px-4 py-1.5 bg-teal-100 text-teal-700 rounded-full text-xs font-semibold">{T.modeLabelGlobal}</div>
            : <div className="flex items-center gap-2 px-4 py-1.5 bg-amber-100 text-amber-700 rounded-full text-xs font-semibold">{T.cfModeLabelCellLine}</div>
          }
        </div>

        {/* ====== 搜索区域：PASS / 全局搜索 ====== */}
        {dataMode !== 'cellline' && (
        <div className={`bg-white rounded-2xl shadow-lg p-6 space-y-4 border-t-4 ${dataMode === 'pass' ? 'border-blue-500' : 'border-teal-500'}`}>
          <div className="space-y-3">
            <div className="flex gap-3">
              {/* 搜索输入框 */}
              <div className="flex-1 relative" ref={globalSearchRef}>
                <SearchIcon className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                <input
                  type="text"
                  value={s.globalSearch}
                  onChange={(e) => s.setGlobalSearch(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && doMainSearch()}
                  onFocus={() => globalSuggestions.length > 0 && setShowGlobalSuggestions(true)}
                  placeholder={dataMode === 'pass'
                    ? T.placeholderPass(idSearchEnabled)
                    : T.placeholderGlobal(idSearchEnabled)
                  }
                  className={`w-full pl-12 pr-4 py-3 border-2 rounded-lg focus:outline-none text-lg ${
                    dataMode === 'pass' ? 'border-blue-300 focus:border-blue-500' : 'border-teal-300 focus:border-teal-500'
                  }`}
                />
                {suggestLoading && (
                  <div className="absolute right-4 top-1/2 transform -translate-y-1/2">
                    <div className={`animate-spin rounded-full h-5 w-5 border-b-2 ${dataMode === 'pass' ? 'border-blue-500' : 'border-teal-500'}`}></div>
                  </div>
                )}
                {showGlobalSuggestions && globalSuggestions.length > 0 && (
                  <div className="absolute z-50 w-full mt-2 bg-white border-2 border-blue-200 rounded-lg shadow-xl max-h-80 overflow-y-auto">
                    {globalSuggestions.map((item, idx) => (
                      <div key={idx} onClick={() => handleSelectGlobalSuggestion(item)}
                        className="px-4 py-3 hover:bg-blue-50 cursor-pointer flex items-center gap-3 border-b border-gray-100 last:border-b-0">
                        <span className={`px-2 py-1 rounded text-xs font-bold ${item.type === 'gene' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'}`}>
                          {item.type === 'gene' ? T.suggestionTypeGene : T.suggestionTypeFusion}
                        </span>
                        <span className="font-medium text-gray-800">{extractGeneName(item.value)}</span>
                        {item._src === 'deleted' && <span className="ml-auto text-xs text-orange-500 bg-orange-50 px-1.5 py-0.5 rounded">FILTER</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ID搜索开关（去掉#号） */}
              <button
                onClick={() => setIdSearchEnabled(!idSearchEnabled)}
                title={idSearchEnabled ? T.idSearchTitleOn(idPrefixHint) : T.idSearchTitleOff}
                className={`flex items-center gap-1.5 px-4 py-3 rounded-lg font-semibold text-sm border-2 transition-all whitespace-nowrap ${
                  idSearchEnabled ? 'bg-teal-500 text-white border-teal-500 shadow-sm' : 'bg-white text-gray-400 border-gray-300 hover:border-gray-400'
                }`}>
                <span>{idSearchEnabled ? T.idSearchOn : T.idSearchOff}</span>
              </button>

              {/* 搜索按钮 + 下拉选择精准/模糊 */}
              <div className="relative flex" ref={searchModeRef}>
                {/* 主搜索按钮 */}
                <button onClick={doMainSearch} disabled={s.loading || !hasSearchCondition}
                  className={`px-6 py-3 text-white font-semibold rounded-l-lg disabled:opacity-50 disabled:cursor-not-allowed transition whitespace-nowrap ${
                    dataMode === 'pass' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-teal-600 hover:bg-teal-700'
                  }`}>
                  {s.loading ? T.searching : (searchMode === 'exact' ? T.exactSearch : T.fuzzySearch)}
                </button>
                {/* 下拉箭头 */}
                <button
                  onClick={() => setShowSearchModeMenu(prev => !prev)}
                  className={`px-2 py-3 text-white font-semibold rounded-r-lg border-l border-white/30 transition ${
                    dataMode === 'pass' ? 'bg-blue-700 hover:bg-blue-800' : 'bg-teal-700 hover:bg-teal-800'
                  }`}>
                  <ChevronDown size={16} />
                </button>
                {/* 下拉菜单 */}
                {showSearchModeMenu && (
                  <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden w-44">
                    <button
                      onClick={() => { setSearchMode('fuzzy'); setShowSearchModeMenu(false); if (s.hasSearched) setTimeout(() => executeSearch(), 50); }}
                      className={`w-full px-4 py-3 text-left text-sm flex items-center gap-2 hover:bg-blue-50 transition ${searchMode === 'fuzzy' ? 'bg-blue-50 font-bold text-blue-700' : 'text-gray-700'}`}>
                      {T.fuzzySearch}
                      {searchMode === 'fuzzy' && <span className="ml-auto text-blue-500">✓</span>}
                    </button>
                    <button
                      onClick={() => { setSearchMode('exact'); setShowSearchModeMenu(false); if (s.hasSearched) setTimeout(() => executeSearch(), 50); }}
                      className={`w-full px-4 py-3 text-left text-sm flex items-center gap-2 hover:bg-amber-50 transition border-t border-gray-100 ${searchMode === 'exact' ? 'bg-amber-50 font-bold text-amber-700' : 'text-gray-700'}`}>
                      {T.exactSearch}
                      {searchMode === 'exact' && <span className="ml-auto text-amber-500">✓</span>}
                    </button>
                  </div>
                )}
              </div>

              {/* 清空 */}
              <button onClick={handleReset} className="px-6 py-3 bg-gray-200 text-gray-700 font-semibold rounded-lg hover:bg-gray-300 transition">
                <X size={20} />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <p className="text-xs text-gray-500">
                {searchMode === 'exact' ? T.hintExact : T.hintFuzzy}
                {idSearchEnabled && <span className="ml-1 text-teal-600 font-medium">{T.idSearchEnabledHint(idPrefixHint)}</span>}
                {!idSearchEnabled && <span className="ml-1 text-gray-400 font-medium">{T.idSearchDisabledHint}</span>}
              </p>
            </div>
          </div>

          {/* 高级筛选切换 */}
          <div className="border-t pt-4">
            <button onClick={() => s.setShowAdvanced(!s.showAdvanced)}
              className="flex items-center gap-2 text-purple-600 hover:text-purple-800 font-semibold transition">
              {s.showAdvanced ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
              {T.advancedFilter} {hasAdvancedFilter() && T.advancedFilterActive}
            </button>
          </div>

          {/* 联动条件徽章：主搜索 + 高级筛选同时激活时显示 */}
          {s.globalSearch && hasAdvancedFilter() && (
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-xs text-gray-500 font-medium">{T.combinedSearch}</span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 border border-blue-200">
                {T.keywordBadge(s.globalSearch)}
              </span>
              <span className="text-xs text-gray-400">+</span>
              {s.advancedFilterMode === 'chromosome' ? (
                <>
                  {s.leftChr && <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-100 text-purple-700 border border-purple-200">{T.leftChrBadge(s.leftChr)}</span>}
                  {s.rightChr && <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-100 text-purple-700 border border-purple-200">{T.rightChrBadge(s.rightChr)}</span>}
                </>
              ) : (
                <>
                  {s.leftGene && <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-100 text-purple-700 border border-purple-200">{T.leftGeneBadge(s.leftGene)}</span>}
                  {s.rightGene && <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-100 text-purple-700 border border-purple-200">{T.rightGeneBadge(s.rightGene)}</span>}
                </>
              )}
              <span className="text-xs text-teal-600 font-medium">{T.andActive}</span>
            </div>
          )}

          {/* 高级搜索选项 */}
          {s.showAdvanced && (
            <div className="space-y-4 bg-purple-50 rounded-lg p-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-sm text-purple-700">
                  {T.advancedHint}
                </p>
                {/* 独立高级搜索按钮 */}
                <button
                  onClick={doAdvancedOnlySearch}
                  disabled={s.loading || !hasAdvancedFilter()}
                  className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white text-sm font-semibold rounded-lg hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed transition whitespace-nowrap"
                >
                  {T.advancedSearchOnly}
                </button>
              </div>
              <div className="flex items-center gap-6 p-3 bg-white rounded-lg border-2 border-purple-200">
                <span className="font-semibold text-gray-700">{T.filterBy}</span>
                {['gene', 'chromosome'].map(mode => (
                  <label key={mode} className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="filterMode" value={mode} checked={s.advancedFilterMode === mode}
                      onChange={() => handleFilterModeChange(mode)} className="w-4 h-4 text-purple-600" />
                    <span className={`font-medium ${s.advancedFilterMode === mode ? 'text-purple-700' : 'text-gray-600'}`}>
                      {mode === 'chromosome' ? T.byChromosome : T.byGene}
                    </span>
                  </label>
                ))}
              </div>
              {s.advancedFilterMode === 'chromosome' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[['leftChr', T.leftChromosome, handleLeftChrChange, s.leftChr], ['rightChr', T.rightChromosome, handleRightChrChange, s.rightChr]].map(([key, label, handler, val]) => (
                    <div key={key}>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">🧬 {label}</label>
                      <select value={val} onChange={(e) => handler(e.target.value)} className="w-full px-4 py-3 border-2 border-purple-300 rounded-lg focus:border-purple-500 focus:outline-none">
                        <option value="">{T.allChromosomes}</option>
                        {chromosomes.map(chr => <option key={chr} value={chr}>{chr}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              )}
              {s.advancedFilterMode === 'gene' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div ref={leftGeneRef} className="relative">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">{T.leftGeneLabel}</label>
                    <input type="text" value={s.leftGene} onChange={(e) => handleLeftGeneInputChange(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && executeSearch({ leftGeneParam: s.leftGene })}
                      onFocus={() => leftGeneSuggestions.length > 0 && setShowLeftSuggestions(true)}
                      placeholder={T.leftGenePlaceholder} className="w-full px-4 py-3 border-2 border-purple-300 rounded-lg focus:border-purple-500 focus:outline-none" />
                    {showLeftSuggestions && leftGeneSuggestions.length > 0 && (
                      <div className="absolute z-50 w-full mt-1 bg-white border-2 border-purple-200 rounded-lg shadow-xl max-h-60 overflow-y-auto">
                        {leftGeneSuggestions.map((g, i) => <div key={i} onClick={() => handleSelectLeftGene(g)} className="px-4 py-2 hover:bg-purple-50 cursor-pointer text-sm">{extractGeneName(g)}</div>)}
                      </div>
                    )}
                  </div>
                  <div ref={rightGeneRef} className="relative">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">{T.rightGeneLabel}</label>
                    <input type="text" value={s.rightGene} onChange={(e) => handleRightGeneInputChange(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && executeSearch({ rightGeneParam: s.rightGene })}
                      onFocus={() => rightGeneSuggestions.length > 0 && setShowRightSuggestions(true)}
                      placeholder={T.rightGenePlaceholder} className="w-full px-4 py-3 border-2 border-purple-300 rounded-lg focus:border-purple-500 focus:outline-none" />
                    {showRightSuggestions && rightGeneSuggestions.length > 0 && (
                      <div className="absolute z-50 w-full mt-1 bg-white border-2 border-purple-200 rounded-lg shadow-xl max-h-60 overflow-y-auto">
                        {rightGeneSuggestions.map((g, i) => <div key={i} onClick={() => handleSelectRightGene(g)} className="px-4 py-2 hover:bg-purple-50 cursor-pointer text-sm">{extractGeneName(g)}</div>)}
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">{T.sortField}</label>
                  <select value={s.sortField} onChange={(e) => handleSortFieldChange(e.target.value)} className="w-full px-4 py-3 border-2 border-purple-300 rounded-lg focus:border-purple-500 focus:outline-none">
                    {sortableFields.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">{T.sortOrder}</label>
                  <select value={s.sortOrder} onChange={(e) => handleSortOrderChange(e.target.value)} className="w-full px-4 py-3 border-2 border-purple-300 rounded-lg focus:border-purple-500 focus:outline-none">
                    <option value="desc">{T.sortDesc}</option>
                    <option value="asc">{T.sortAsc}</option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>
        )} {/* end dataMode !== 'cellline' search panel */}

        {/* ====== Cell Line DB 搜索区域 ====== */}
        {dataMode === 'cellline' && (
          <div className="bg-white rounded-2xl shadow-lg p-6 space-y-4 border-t-4 border-amber-500">

            {/* 主搜索行：Fusion Name + Cell Line + 按钮 */}
            <div className="flex gap-3">
              {/* Fusion Name */}
              <div className="flex-1 relative">
                <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                <input
                  type="text" value={cfFusionQ}
                  onChange={e => setCfFusionQ(e.target.value)}
                  onKeyPress={e => e.key === 'Enter' && executeCfSearch()}
                  placeholder={T.cfSearchPlaceholder}
                  className="w-full pl-12 pr-4 py-3 border-2 border-amber-300 rounded-lg focus:border-amber-500 focus:outline-none text-base"
                />
              </div>
              {/* Cell Line */}
              <div className="w-56 relative">
                <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                  type="text" value={cfCellLineQ}
                  onChange={e => setCfCellLineQ(e.target.value)}
                  onKeyPress={e => e.key === 'Enter' && executeCfSearch()}
                  placeholder={T.cfCellLinePlaceholder}
                  className="w-full pl-9 pr-3 py-3 border-2 border-amber-300 rounded-lg focus:border-amber-500 focus:outline-none text-sm"
                />
              </div>
              {/* 搜索按钮 */}
              <button onClick={() => executeCfSearch()}
                disabled={cfLoading || (!cfFusionQ.trim() && !cfCellLineQ.trim() && cfSelectedDiseases.length === 0)}
                className="px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-2 whitespace-nowrap">
                {cfLoading
                  ? <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> {T.cfSearching}</>
                  : <><SearchIcon size={16}/> {T.cfSearchBtn}</>}
              </button>
              {/* 清空按钮 */}
              <button onClick={handleCfReset}
                className="px-4 py-3 bg-gray-200 text-gray-700 font-semibold rounded-lg hover:bg-gray-300 transition">
                <X size={20} />
              </button>
            </div>

            {/* 搜索条件说明行 */}
            <div className="flex items-center gap-3 flex-wrap text-xs text-gray-500">
              <span>{T.cfSearchHint}</span>
              {cfSelectedDiseases.length > 0 && (
                <span className="flex flex-wrap gap-1">
                  {cfSelectedDiseases.map(d => (
                    <span key={d} className="px-1.5 py-0.5 bg-amber-100 text-amber-700 border border-amber-200 rounded font-medium max-w-[180px] truncate" title={d}>{d}</span>
                  ))}
                </span>
              )}
              {cfHasSearched && !cfLoading && (
                <span className="ml-auto font-medium text-amber-700">
                  {T.cfResultsSummary(cfRawResults.length, cfGrouped.length)}
                </span>
              )}
            </div>

            {/* 疾病筛选折叠区 */}
            <div className="border-t pt-3">
              <button onClick={() => setCfShowDiseaseFilter(v => !v)}
                className="flex items-center gap-2 text-amber-600 hover:text-amber-800 font-semibold transition text-sm">
                {cfShowDiseaseFilter ? <ChevronUp size={18}/> : <ChevronDown size={18}/>}
                {T.cfDiseaseFilterToggle}
                {cfSelectedDiseases.length > 0 && (
                  <span className="ml-1 px-2 py-0.5 bg-amber-500 text-white rounded-full text-xs font-bold">
                    {T.cfDiseasesSelected(cfSelectedDiseases.length)}
                  </span>
                )}
              </button>

              {cfShowDiseaseFilter && (
                <div className="mt-3 bg-amber-50 rounded-xl p-4 border border-amber-200">
                  <CfDiseaseSelector onApply={handleCfDiseaseApply} disabled={cfLoading} />
                </div>
              )}
            </div>
          </div>
        )}

        {/* ====== 搜索结果：PASS / 全局 ====== */}
        {dataMode !== 'cellline' && s.results.length > 0 && (
          <div className="bg-white rounded-2xl shadow-lg p-6">
            <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-1">
                  {T.resultsTitle(dataMode)} {getSearchDescription()}
                </h2>
                <p className="text-gray-600">
                  {T.totalFound(s.total)}
                  {dataMode === 'global' && passCount > 0 && <span className="ml-2 text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded">PASS: {passCount}</span>}
                  {dataMode === 'global' && deletedCount > 0 && <span className="ml-2 text-xs px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded">FILTER: {deletedCount}</span>}
                </p>
              </div>
              <div className="flex gap-2">
                {[
                  { key: 'table', label: '📊 Table', color: 'blue' },
                  { key: 'circos', label: '🎨 Circos', color: 'red' },
                  { key: 'junction', label: '📈 Junction', color: 'green' },
                  { key: 'network', label: '🌐 Network', color: 'purple' },
                ].map(tab => (
                  <button key={tab.key} onClick={() => s.setActiveTab(tab.key)}
                    className={`px-4 py-2 rounded-lg font-semibold transition ${
                      s.activeTab === tab.key ? `bg-${tab.color}-600 text-white` : `bg-${tab.color}-100 text-${tab.color}-700 hover:bg-${tab.color}-200`
                    }`}>{tab.label}</button>
                ))}
              </div>
            </div>

            <div className="mt-4">
              {/* ====== PASS 表格（原逻辑完全不变，无 FILTER 列） ====== */}
              {s.activeTab === 'table' && dataMode === 'pass' && (
                <div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gradient-to-r from-blue-100 to-purple-100">
                        <tr>
                          {T.tableHeadersPass.map(h => (
                            <th key={h} className="px-3 py-3 text-left font-bold text-gray-800 whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {getCurrentPageData().map((fusion, idx) => (
                          <tr key={fusion.id || idx} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-blue-50 transition-colors`}>
                            <td className="px-3 py-3 whitespace-nowrap">
                              <span className="inline-flex items-center justify-center px-2 h-8 bg-blue-50 text-blue-700 font-mono text-sm rounded border border-blue-200">TP{fusion.id}</span>
                            </td>
                            <td className="px-3 py-3 whitespace-nowrap">
                              <button onClick={() => handleFusionClick(fusion.fusion_name)} className="text-orange-600 hover:text-orange-800 hover:underline font-semibold">{fusion.fusion_name || 'N/A'}</button>
                            </td>
                            <td className="px-3 py-3"><span className="font-semibold text-blue-700">{extractGeneId(fusion.left_gene) || 'N/A'}</span></td>
                            <td className="px-3 py-3 text-xs">{fusion.left_breakpoint || 'N/A'}</td>
                            <td className="px-3 py-3"><span className="font-semibold text-purple-700">{extractGeneId(fusion.right_gene) || 'N/A'}</span></td>
                            <td className="px-3 py-3 text-xs">{fusion.right_breakpoint || 'N/A'}</td>
                            <td className="px-3 py-3 text-xs max-w-[150px] truncate" title={fusion.annots}>{fusion.annots || 'N/A'}</td>
                            <td className="px-3 py-3 font-semibold text-green-700">{fusion.fq || 0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ====== 全局搜索表格（含展开变体功能） ====== */}
              {s.activeTab === 'table' && dataMode === 'global' && (
                <div>
                  <div className="flex items-center gap-4 mb-3 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block w-4 h-4 rounded border border-gray-200 bg-white"></span>
                      <span className="text-gray-600">{T.legendPass}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block w-4 h-4 rounded border border-yellow-300" style={{ backgroundColor: '#FFFDE7' }}></span>
                      <span className="text-gray-600">{T.legendFilter}</span>
                    </div>
                    <span className="text-gray-400 ml-2">{T.legendExpand}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gradient-to-r from-teal-100 to-blue-100">
                        <tr>
                          {['', T.tableHeadersPass[0],'Fusion Name','Left Gene','Left Breakpoint','Right Gene','Right Breakpoint','Annots','fq','FILTER'].map(h => (
                            <th key={h} className="px-3 py-3 text-left font-bold text-gray-800 whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {getCurrentPageData().map((row, idx) => {
                          const isDeleted = row._source === 'deleted';
                          const isCellfusion = row._source === 'cellfusion';
                          const bgStyle = isDeleted ? { backgroundColor: '#FFFDE7' } : {};
                          const bgClass = isDeleted
                            ? 'hover:bg-yellow-100 transition-colors'
                            : isCellfusion
                              ? `${idx % 2 === 0 ? 'bg-amber-50/30' : 'bg-white'} hover:bg-amber-50 transition-colors`
                              : `${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-blue-50 transition-colors`;

                          // FILTER 用前端分组的 _variants；PASS 用后端 variant_count + 懒加载
                          const filterVariants = row._variants || [];
                          const passVariantCount = row._variantCount || 1;
                          const rowKey = `${row._source}::${row._fusionName}`;
                          const isExpanded = expandedRows.has(rowKey);
                          const isLoadingVars = loadingVariants.has(rowKey);

                          // PASS: 变体数 > 1 时可展开；FILTER: _variants 非空时可展开
                          const hasExpandable = isDeleted ? filterVariants.length > 0 : passVariantCount > 1;
                          const expandCount = isDeleted ? filterVariants.length : passVariantCount - 1;

                          // 获取展开后要显示的变体行
                          const getDisplayVariants = () => {
                            if (isDeleted) return filterVariants;
                            // PASS: 从缓存取懒加载的变体（排除主行 id）
                            const cached = variantsCache[row._fusionName];
                            if (cached) return cached.filter(v => v._displayId !== row._displayId);
                            return [];
                          };

                          // PASS 懒加载变体
                          const handleExpand = async () => {
                            const next = new Set(expandedRows);
                            if (next.has(rowKey)) { next.delete(rowKey); setExpandedRows(next); return; }
                            next.add(rowKey);
                            setExpandedRows(next);

                            // PASS 行且未缓存 → 懒加载
                            if (!isDeleted && !variantsCache[row._fusionName]) {
                              setLoadingVariants(prev => new Set(prev).add(rowKey));
                              try {
                                const res = await fetchWithAuth(`/api/fusion/by-name/${encodeURIComponent(row._fusionName)}`);
                                if (res.ok) {
                                  const json = await res.json();
                                  const items = (json?.data?.items || []).map(it => normalizePassItemForGlobal({
                                    ...it, fq: it.fq || 0, variant_count: 1
                                  }));
                                  items.sort((a, b) => b._fq - a._fq);
                                  setVariantsCache(prev => ({ ...prev, [row._fusionName]: items }));
                                }
                              } catch (e) { console.error('[Variants]', e); }
                              finally { setLoadingVariants(prev => { const n = new Set(prev); n.delete(rowKey); return n; }); }
                            }
                          };

                          const handleRowNav = (r) => {
                            if (r._source === 'deleted') navigateFromSearch(`/fusion-deleted/${encodeURIComponent(r._fusionName)}`);
                            else if (r._source === 'cellfusion') navigateFromSearch(`/cellfusion-detail/${encodeURIComponent(r._fusionName)}`);
                            else handleFusionClick(r._fusionName || r.fusion_name);
                          };

                          const renderCells = (r, isVariantRow = false) => (
                            <>
                              <td className="px-3 py-2 whitespace-nowrap">
                                <span className={`inline-flex items-center justify-center px-2 h-7 font-mono text-xs rounded border ${
                                  r._source === 'deleted'
                                    ? 'bg-orange-50 text-orange-700 border-orange-200'
                                    : r._source === 'cellfusion'
                                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                                      : 'bg-blue-50 text-blue-700 border-blue-200'
                                }`}>{r._idPrefix}{r._displayId}</span>
                              </td>
                              <td className="px-3 py-2 whitespace-nowrap">
                                <button onClick={() => handleRowNav(r)}
                                  className={`hover:underline font-semibold text-xs ${isVariantRow ? 'text-gray-500' : 'text-orange-600 hover:text-orange-800'}`}>
                                  {r._fusionName || r.fusion_name || 'N/A'}
                                </button>
                              </td>
                              <td className="px-3 py-2"><span className="font-semibold text-blue-700 text-xs">{extractGeneId(r._leftGene || r.left_gene) || '-'}</span></td>
                              <td className="px-3 py-2 text-xs font-mono">{r._leftBreakpoint || r.left_breakpoint || '-'}</td>
                              <td className="px-3 py-2"><span className="font-semibold text-purple-700 text-xs">{extractGeneId(r._rightGene || r.right_gene) || '-'}</span></td>
                              <td className="px-3 py-2 text-xs font-mono">{r._rightBreakpoint || r.right_breakpoint || '-'}</td>
                              <td className="px-3 py-2 text-xs max-w-[120px] truncate" title={r._annots || r.annots || ''}>{r._annots || r.annots || '-'}</td>
                              <td className="px-3 py-2 font-semibold text-green-700 text-xs">{r._fq ?? r.fq ?? 0}</td>
                              <td className="px-3 py-2">
                                {r._source === 'cellfusion'
                                  ? <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-xs font-medium">CELL LINE</span>
                                  : (r._filter === 'PASS' || r._source === 'pass')
                                  ? <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-xs font-medium">PASS</span>
                                  : r._filter
                                    ? <span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-xs font-medium">{r._filter}</span>
                                    : <span className="text-gray-300">-</span>
                                }
                              </td>
                            </>
                          );

                          const displayVariants = isExpanded ? getDisplayVariants() : [];

                          return (
                            <React.Fragment key={`${row._source}-${row._displayId}-${idx}`}>
                              {/* 主行 */}
                              <tr className={bgClass} style={bgStyle}>
                                <td className="px-2 py-2 w-8 text-center">
                                  {hasExpandable ? (
                                    <button onClick={handleExpand}
                                      className="text-gray-400 hover:text-gray-700 transition text-xs"
                                      title={T.variantsCount(expandCount)}>
                                      {isLoadingVars ? <span className="animate-spin inline-block">⟳</span> : (isExpanded ? '▼' : '▶')}
                                      {' '}<span className="text-[10px] text-gray-400">{expandCount}</span>
                                    </button>
                                  ) : <span className="text-gray-200 text-xs">·</span>}
                                </td>
                                {renderCells(row)}
                              </tr>
                              {/* 展开的变体行 */}
                              {isExpanded && displayVariants.map((v, vi) => (
                                <tr key={`${rowKey}-v-${vi}`}
                                  className={`${isDeleted ? 'bg-amber-50/60' : 'bg-slate-50/80'} border-l-4 ${isDeleted ? 'border-l-orange-200' : 'border-l-blue-200'} text-xs`}>
                                  <td className="px-2 py-1.5 text-center text-gray-300 text-[10px]">└</td>
                                  {renderCells(v, true)}
                                </tr>
                              ))}
                              {/* PASS 加载中提示 */}
                              {isExpanded && isLoadingVars && (
                                <tr className="bg-blue-50/50">
                                  <td colSpan={11} className="px-4 py-2 text-center text-xs text-blue-500">
                                    {T.loadingVariants}
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ====== Circos —— PASS ====== */}
              {s.activeTab === 'circos' && dataMode === 'pass' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between bg-red-50 rounded-lg p-4">
                    <div><h3 className="font-bold text-red-900 mb-1">{T.circosTitle}</h3></div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-red-900">{T.displayRange}</span>
                      <input type="number" min="0" max={Math.max(0, s.circosData.length - 300)} value={s.circosRange.start}
                        onChange={(e) => { const start = parseInt(e.target.value) || 0; s.setCircosRange({ start, end: start + 300 }); }}
                        className="w-20 px-2 py-1 border-2 border-red-300 rounded text-center" />
                      <span>-</span>
                      <input type="number" min="1" max={s.circosData.length} value={s.circosRange.end}
                        onChange={(e) => { const end = parseInt(e.target.value) || 300; s.setCircosRange({ start: Math.max(0, end - 300), end }); }}
                        className="w-20 px-2 py-1 border-2 border-red-300 rounded text-center" />
                      <span className="text-sm text-red-700">/ {s.circosData.length}</span>
                    </div>
                  </div>
                  <CircosChartInteractive fusions={getCircosDisplayData()}
                    onFusionClick={(id) => { const f = s.circosData.find(x => x.id === id); if (f?.fusion_name) handleFusionClick(f.fusion_name); }}
                    onChromosomeClick={handleChromosomeClick} />
                </div>
              )}

              {/* ====== Circos —— 全局搜索 ====== */}
              {s.activeTab === 'circos' && dataMode === 'global' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between bg-red-50 rounded-lg p-4 border border-teal-200">
                    <div>
                      <h3 className="font-bold text-red-900 mb-1">{T.circosGlobalTitle}</h3>
                      <p className="text-xs text-gray-600">{T.circosGlobalSubtitle}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-red-900">{T.displayRange}</span>
                      <input type="number" min="0" max={Math.max(0, s.circosData.length - 300)} value={s.circosRange.start}
                        onChange={(e) => { const start = parseInt(e.target.value) || 0; s.setCircosRange({ start, end: start + 300 }); }}
                        className="w-20 px-2 py-1 border-2 border-red-300 rounded text-center" />
                      <span>-</span>
                      <input type="number" min="1" max={s.circosData.length} value={s.circosRange.end}
                        onChange={(e) => { const end = parseInt(e.target.value) || 300; s.setCircosRange({ start: Math.max(0, end - 300), end }); }}
                        className="w-20 px-2 py-1 border-2 border-red-300 rounded text-center" />
                      <span className="text-sm text-red-700">/ {s.circosData.length}</span>
                    </div>
                  </div>
                  <CircosChartInteractive fusions={getCircosDisplayData()} onFusionClick={handleGlobalCircosClick} onChromosomeClick={handleChromosomeClick} />
                </div>
              )}

              {/* ====== Junction —— PASS ====== */}
              {s.activeTab === 'junction' && dataMode === 'pass' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between bg-green-50 rounded-lg p-4">
                    <div><h3 className="font-bold text-green-900 mb-1">{T.junctionTitle}</h3></div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-green-900">{T.showTop}</span>
                      <input type="number" min="1" max={s.junctionData.length} value={s.junctionRange.end - s.junctionRange.start}
                        onChange={(e) => { const c = Math.min(parseInt(e.target.value) || 20, s.junctionData.length); s.setJunctionRange({ start: 0, end: c }); }}
                        className="w-20 px-2 py-1 border-2 border-green-300 rounded text-center" />
                      <span className="text-sm text-green-700">{T.itemsOfTotal(s.junctionData.length)}</span>
                    </div>
                  </div>
                  <JunctionSpanningChart data={getJunctionDisplayData()} onFusionClick={handleFusionClick} useLog2Scale={true} />
                </div>
              )}

              {/* ====== Junction —— 全局搜索 ====== */}
              {s.activeTab === 'junction' && dataMode === 'global' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between bg-green-50 rounded-lg p-4 border border-teal-200">
                    <div>
                      <h3 className="font-bold text-green-900 mb-1">{T.junctionGlobalTitle}</h3>
                      <p className="text-xs text-green-700">{T.junctionGlobalSubtitle}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-green-900">{T.showTop}</span>
                      <input type="number" min="1" max={s.junctionData.length} value={s.junctionRange.end - s.junctionRange.start}
                        onChange={(e) => { const c = Math.min(parseInt(e.target.value) || 20, s.junctionData.length); s.setJunctionRange({ start: 0, end: c }); }}
                        className="w-20 px-2 py-1 border-2 border-green-300 rounded text-center" />
                      <span className="text-sm text-green-700">{T.itemsOfTotal(s.junctionData.length)}</span>
                    </div>
                  </div>
                  <JunctionSpanningChart data={getJunctionDisplayData()} onFusionClick={(name, source) => {
                    if (source === 'deleted') navigateFromSearch(`/fusion-deleted/${encodeURIComponent(name)}`);
                    else handleFusionClick(name);
                  }} useLog2Scale={true} />
                </div>
              )}

              {/* ====== Network —— PASS ====== */}
              {s.activeTab === 'network' && dataMode === 'pass' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between bg-purple-50 rounded-lg p-4 flex-wrap gap-3">
                    <div><h3 className="font-bold text-purple-900 mb-1">{T.networkTitle}</h3></div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-purple-900">{T.showTop}</span>
                      <input type="number" min="10" max="300" value={s.networkRange.end - s.networkRange.start}
                        onChange={(e) => { const c = Math.min(Math.max(parseInt(e.target.value) || 50, 10), 300); s.setNetworkRange({ start: 0, end: c }); }}
                        className="w-20 px-2 py-1 border-2 border-purple-300 rounded text-center" />
                      <span className="text-sm text-purple-700">{T.fusionsOfTotal(s.networkData.length)}</span>
                    </div>
                  </div>
                  <NetworkView data={getNetworkDisplayData()} />
                </div>
              )}

              {/* ====== Network —— 全局搜索 ====== */}
              {s.activeTab === 'network' && dataMode === 'global' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between bg-purple-50 rounded-lg p-4 flex-wrap gap-3 border border-teal-200">
                    <div>
                      <h3 className="font-bold text-purple-900 mb-1">{T.networkGlobalTitle}</h3>
                      <p className="text-xs text-purple-700">{T.networkGlobalSubtitle}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-purple-900">{T.showTop}</span>
                      <input type="number" min="10" max="300" value={s.networkRange.end - s.networkRange.start}
                        onChange={(e) => { const c = Math.min(Math.max(parseInt(e.target.value) || 50, 10), 300); s.setNetworkRange({ start: 0, end: c }); }}
                        className="w-20 px-2 py-1 border-2 border-purple-300 rounded text-center" />
                      <span className="text-sm text-purple-700">{T.fusionsOfTotal(s.networkData.length)}</span>
                    </div>
                  </div>
                  <NetworkView data={getNetworkDisplayData()} />
                </div>
              )}

              {/* 分页 */}
              {s.activeTab === 'table' && totalPages > 1 && (
                <div className="flex items-center justify-between pt-4 border-t mt-4">
                  <div className="text-sm text-gray-600">
                    {T.showingRange((s.currentPage - 1) * itemsPerPage + 1, Math.min(s.currentPage * itemsPerPage, s.total), s.total)}
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => goToPage(1)} disabled={s.currentPage === 1} className="px-3 py-2 rounded-lg border border-gray-300 hover:bg-gray-100 disabled:opacity-50">{T.firstPage}</button>
                    <button onClick={() => goToPage(s.currentPage - 1)} disabled={s.currentPage === 1} className="px-3 py-2 rounded-lg border border-gray-300 hover:bg-gray-100 disabled:opacity-50"><ChevronLeft size={18} /></button>
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      let p;
                      if (totalPages <= 5) p = i + 1;
                      else if (s.currentPage <= 3) p = i + 1;
                      else if (s.currentPage >= totalPages - 2) p = totalPages - 4 + i;
                      else p = s.currentPage - 2 + i;
                      return (
                        <button key={p} onClick={() => goToPage(p)}
                          className={`px-4 py-2 rounded-lg border ${s.currentPage === p
                            ? (dataMode === 'pass' ? 'bg-blue-600 text-white border-blue-600' : 'bg-teal-600 text-white border-teal-600')
                            : 'border-gray-300 hover:bg-gray-100'}`}>{p}</button>
                      );
                    })}
                    <button onClick={() => goToPage(s.currentPage + 1)} disabled={s.currentPage === totalPages} className="px-3 py-2 rounded-lg border border-gray-300 hover:bg-gray-100 disabled:opacity-50"><ChevronRight size={18} /></button>
                    <button onClick={() => goToPage(totalPages)} disabled={s.currentPage === totalPages} className="px-3 py-2 rounded-lg border border-gray-300 hover:bg-gray-100 disabled:opacity-50">{T.lastPage}</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 无结果 */}
        {dataMode !== 'cellline' && !s.loading && s.results.length === 0 && hasSearchCondition && s.hasSearched && (
          <div className="bg-white rounded-2xl shadow-lg p-12 text-center">
            <div className="text-6xl mb-4">🔍</div>
            <h3 className="text-2xl font-bold text-gray-800 mb-2">{T.noResultsTitle}</h3>
            <p className="text-gray-600">{T.noResultsHint}</p>
          </div>
        )}

        {/* 初始提示 */}
        {dataMode !== 'cellline' && !s.loading && s.results.length === 0 && !hasSearchCondition && (
          <div className={`rounded-2xl shadow-lg p-12 text-center ${dataMode === 'pass' ? 'bg-gradient-to-br from-blue-100 to-purple-100' : 'bg-gradient-to-br from-teal-100 to-blue-100'}`}>
            <div className="text-6xl mb-4">{dataMode === 'pass' ? '🎯' : '🌐'}</div>
            <h3 className="text-2xl font-bold text-gray-800 mb-2">
              {dataMode === 'pass' ? T.initialTitlePass : T.initialTitleGlobal}
            </h3>
            <p className="text-gray-600 mb-4">
              {dataMode === 'pass' ? T.initialSubtitlePass : T.initialSubtitleGlobal}
              {idSearchEnabled && <span className="block mt-1 text-sm text-teal-600">{T.idSearchEnabledHint(idPrefixHint)}</span>}
            </p>
          </div>
        )}

        {/* 加载中 */}
        {dataMode !== 'cellline' && s.loading && s.results.length === 0 && (
          <div className="bg-white rounded-2xl shadow-lg p-12 text-center">
            <div className={`animate-spin rounded-full h-16 w-16 border-b-2 mx-auto mb-4 ${dataMode === 'pass' ? 'border-blue-600' : 'border-teal-600'}`}></div>
            <p className={`font-semibold ${dataMode === 'pass' ? 'text-blue-600' : 'text-teal-600'}`}>
              {dataMode === 'pass' ? T.loadingPass : T.loadingGlobal}
            </p>
          </div>
        )}

        {/* ====== Cell Line DB：加载中 ====== */}
        {dataMode === 'cellline' && cfLoading && (
          <div className="bg-white rounded-2xl shadow-lg p-12 text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-amber-500 mx-auto mb-4" />
            <p className="font-semibold text-amber-600">{T.cfSearchingLoading}</p>
          </div>
        )}

        {/* ====== Cell Line DB：无结果 ====== */}
        {dataMode === 'cellline' && !cfLoading && cfHasSearched && cfGrouped.length === 0 && (
          <div className="bg-white rounded-2xl shadow-lg p-12 text-center">
            <div className="text-6xl mb-4">🔍</div>
            <h3 className="text-2xl font-bold text-gray-800 mb-2">{T.cfNoResults}</h3>
            <p className="text-gray-600">{T.cfNoResultsHint}</p>
          </div>
        )}

        {/* ====== Cell Line DB：初始提示 ====== */}
        {dataMode === 'cellline' && !cfLoading && !cfHasSearched && (
          <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-2xl shadow-lg p-12 text-center border border-amber-200">
            <div className="text-6xl mb-4">🧫</div>
            <h3 className="text-2xl font-bold text-amber-800 mb-2">CCLE Cell Line Fusion DB</h3>
            <p className="text-gray-600">{T.cfInitialHint}</p>
            <p className="text-sm text-gray-400 mt-2">{T.cfInitialHint2}</p>
          </div>
        )}

        {/* ====== Cell Line DB：结果表格 ====== */}
        {dataMode === 'cellline' && !cfLoading && cfGrouped.length > 0 && (
          <div className="bg-white rounded-2xl shadow-lg p-6">
            {/* 标题行 */}
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <div>
                <h2 className="text-xl font-bold text-gray-900">
                  {T.cfResultsTitle}
                </h2>
                <p className="text-gray-500 text-sm mt-1">
                  {T.cfResultsCount(cfGrouped.length, cfRawResults.length)}
                  {cfFusionQ && <span className="ml-2 px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-xs">{T.cfSearchContentLabel(cfFusionQ)}</span>}
                  {cfCellLineQ && <span className="ml-2 px-2 py-0.5 bg-orange-100 text-orange-700 rounded text-xs">Cell Line: {cfCellLineQ}</span>}
                  {cfSelectedDiseases.length > 0 && <span className="ml-2 px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded text-xs">{T.cfDiseasesFiltered(cfSelectedDiseases.length)}</span>}
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs text-gray-500">
                <span className="flex items-center gap-1">
                  <span className="inline-block w-3 h-3 rounded bg-amber-100 border border-amber-300" />
                  {T.cfExpandable}
                </span>
                <span className="flex items-center gap-1.5 text-blue-600 font-medium">
                  {T.cfClickHint}
                </span>
              </div>
            </div>

            {/* 表格 */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gradient-to-r from-amber-100 to-orange-100">
                  <tr>
                    {['', 'ID', 'Fusion Name', 'Left Breakpoint', 'Right Breakpoint', 'Annots', 'Avg FFPM', 'fq', 'Cell Line', 'Tissue', 'Disease'].map(h => (
                      <th key={h} className="px-3 py-3 text-left font-bold text-gray-800 whitespace-nowrap text-xs">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {cfPageData.map((row, idx) => {
                    const rowKey = row.fusion_name || String(idx);
                    const isExpanded = cfExpandedRows.has(rowKey);
                    const variants = row._variants || [];
                    const hasVariants = variants.length > 0;

                    const renderCfRow = (r, isVariant = false) => (
                      <>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="inline-flex items-center justify-center px-2 h-7 font-mono text-xs rounded border bg-amber-50 text-amber-700 border-amber-200">
                            {r.display_id || r.id || (r.squeue ? `CL${r.squeue}` : '-')}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-semibold whitespace-nowrap">
                          <button
                            onClick={() => navigateFromSearch(`/cellfusion-detail/${encodeURIComponent(r.fusion_name || '')}`)}
                            className={`hover:underline text-xs ${isVariant ? 'text-gray-500 hover:text-gray-700' : 'text-amber-700 hover:text-amber-900 font-bold'}`}
                            title={T.cfFusionClickTitle}>
                            {r.fusion_name || 'N/A'}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-xs font-mono text-gray-600 whitespace-nowrap">{r.left_breakpoint || '-'}</td>
                        <td className="px-3 py-2 text-xs font-mono text-gray-600 whitespace-nowrap">{r.right_breakpoint || '-'}</td>
                        <td className="px-3 py-2 text-xs text-gray-600 max-w-[120px] truncate" title={r.annots || ''}>{r.annots || '-'}</td>
                        <td className="px-3 py-2 text-xs text-gray-700">{r.avg_ffpm != null ? parseFloat(r.avg_ffpm).toFixed(4) : '-'}</td>
                        <td className="px-3 py-2 text-xs font-semibold text-green-700">{r.fq ?? 0}</td>
                        <td className="px-3 py-2"><CfCellLineCell value={r.cell_line || ''}/></td>
                        <td className="px-3 py-2"><CfTissueCell value={r.tissue || ''}/></td>
                        <td className="px-3 py-2"><CfDiseaseCell value={r.disease || ''}/></td>
                      </>
                    );

                    return (
                      <React.Fragment key={rowKey}>
                        <tr className={`${idx % 2 === 0 ? 'bg-white' : 'bg-amber-50/30'} hover:bg-amber-50 transition-colors`}>
                          <td className="px-2 py-2 w-8 text-center">
                            {hasVariants ? (
                              <button
                                onClick={() => {
                                  const next = new Set(cfExpandedRows);
                                  isExpanded ? next.delete(rowKey) : next.add(rowKey);
                                  setCfExpandedRows(next);
                                }}
                                className="text-gray-400 hover:text-amber-600 transition text-xs"
                                title={T.cfVariantCount(variants.length)}>
                                {isExpanded ? '▼' : '▶'}{' '}
                                <span className="text-[10px] text-gray-400">{variants.length}</span>
                              </button>
                            ) : (
                              <span className="text-gray-200 text-xs">·</span>
                            )}
                          </td>
                          {renderCfRow(row)}
                        </tr>
                        {isExpanded && variants.map((v, vi) => (
                          <tr key={`${rowKey}-v-${vi}`}
                            className="bg-amber-50/60 border-l-4 border-l-amber-200 text-xs">
                            <td className="px-2 py-1.5 text-center text-gray-300 text-[10px]">└</td>
                            {renderCfRow(v, true)}
                          </tr>
                        ))}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 分页 */}
            {cfTotalPages > 1 && (
              <div className="flex items-center justify-between pt-4 border-t mt-4">
                <span className="text-sm text-gray-600">
                  {T.cfShowingRange((cfPage - 1) * CF_PER_PAGE + 1, Math.min(cfPage * CF_PER_PAGE, cfGrouped.length), cfGrouped.length)}
                </span>
                <div className="flex items-center gap-2">
                  <button onClick={() => setCfPage(p => Math.max(1, p - 1))} disabled={cfPage === 1}
                    className="px-3 py-2 rounded-lg border border-gray-300 hover:bg-gray-100 disabled:opacity-50">
                    <ChevronLeft size={18} />
                  </button>
                  {Array.from({ length: Math.min(5, cfTotalPages) }, (_, i) => {
                    let p;
                    if (cfTotalPages <= 5) p = i + 1;
                    else if (cfPage <= 3) p = i + 1;
                    else if (cfPage >= cfTotalPages - 2) p = cfTotalPages - 4 + i;
                    else p = cfPage - 2 + i;
                    return (
                      <button key={p} onClick={() => { setCfPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                        className={`px-4 py-2 rounded-lg border ${cfPage === p ? 'bg-amber-500 text-white border-amber-500' : 'border-gray-300 hover:bg-gray-100'}`}>
                        {p}
                      </button>
                    );
                  })}
                  <button onClick={() => setCfPage(p => Math.min(cfTotalPages, p + 1))} disabled={cfPage === cfTotalPages}
                    className="px-3 py-2 rounded-lg border border-gray-300 hover:bg-gray-100 disabled:opacity-50">
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
};

export default Search;
