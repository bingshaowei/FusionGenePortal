// FusionDeletedDetail.jsx - 低可信度融合基因详情页 v3
// 改进：sticky居中标题、汇总统计用均值、变体分页、点击展开详情、基因功能查询、注释换行

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, AlertCircle, Download, Database,
  FileImage, Activity, Dna, AlertTriangle,
  ChevronLeft, ChevronRight, ExternalLink, BookOpen
} from 'lucide-react';
import ArribaFusionDiagram from '../components/ArribaFusionDiagram';
import FusionProteinPredictor from '../components/FusionProteinPredictor';
import { useLanguage } from '../contexts/LanguageContext';

// --- Auth ---
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
    } catch (e) { console.error('[Auth]', e); }
  }
  return token;
}
async function fetchWithAuth(url, opts = {}, retries = 1) {
  const token = await ensureToken();
  const r = await fetch(url, { ...opts, headers: { ...opts.headers, Authorization: `Bearer ${token}` } });
  if (r.status === 401 && retries > 0) { localStorage.removeItem('token'); return fetchWithAuth(url, opts, retries - 1); }
  return r;
}

const cleanGene = (g) => (g || '').split('^')[0] || 'N/A';
const extractEnsg = (g) => { if (!g) return 'N/A'; const p = g.split('^'); return p.length > 1 ? p[1] : p[0]; };
const normalizeTfId = (id) => String(id || '').replace(/^TF/i, '');

// ==================== 基因功能查询组件 ====================
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

// ==================== 主组件 ====================
const FusionDeletedDetail = () => {
  const { fusionName } = useParams();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const DD = t.fusionDeletedDetail;
  const GF = t.geneFunction;

  const [rows, setRows] = useState([]);
  const [columns, setColumns] = useState([]);
  const [selectedRow, setSelectedRow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // 变体分页
  const [variantPage, setVariantPage] = useState(1);
  const variantsPerPage = 10;

  // 加载数据
  useEffect(() => {
    if (!fusionName) return;
    (async () => {
      try {
        setLoading(true); setError(null);
        const res = await fetchWithAuth(`/api/deleted/by-name/${encodeURIComponent(fusionName)}`);
        if (!res.ok) throw new Error(`API ${res.status}`);
        const json = await res.json();
        if (json.code === 200 && json.data) {
          const items = json.data.items || [];
          const sorted = [...items].sort((a, b) => parseFloat(b.fq || 0) - parseFloat(a.fq || 0));
          setRows(sorted);
          setColumns(json.data.columns || []);
          if (sorted.length > 0) setSelectedRow(sorted[0]);
        } else throw new Error(json.message || '');
      } catch (err) { console.error('[Deleted]', err); setError(err.message); }
      finally { setLoading(false); }
    })();
  }, [fusionName]);

  // === 字段提取 ===
  const gf = (row, ...keys) => { if (!row) return ''; for (const k of keys) { if (row[k] !== undefined && row[k] !== null && row[k] !== '') return row[k]; } return ''; };

  // 选中行字段
  const filterReason = gf(selectedRow, 'filter', 'Filter');
  const fusionNameDisplay = gf(selectedRow, 'fusionName', 'Fusion.Name') || fusionName;
  const leftGeneRaw = gf(selectedRow, 'leftGene', 'LeftGene');
  const rightGeneRaw = gf(selectedRow, 'rightGene', 'RightGene');
  const leftBp = gf(selectedRow, 'leftBreakpoint', 'LeftBreakpoint', 'LeftLocalBreakpoint');
  const rightBp = gf(selectedRow, 'rightBreakpoint', 'RightBreakpoint', 'RightLocalBreakpoint');
  const jrc = parseFloat(gf(selectedRow, 'junction', 'JunctionReadCount') || 0);
  const sfc = parseFloat(gf(selectedRow, 'spanningFrag', 'SpanningFragCount') || 0);
  const ffpmVal = parseFloat(gf(selectedRow, 'ffpm', 'FFPM.cal', 'FFPM') || 0);
  const annots = gf(selectedRow, 'annots', 'Annots');
  const squeueId = gf(selectedRow, 'squeue');
  const protFusionType = gf(selectedRow, 'PROT_FUSION_TYPE', 'prot_fusion_type');
  const spliceType = gf(selectedRow, 'SpliceType');
  const largeAnchor = gf(selectedRow, 'LargeAnchorSupport');
  const leftEntropy = gf(selectedRow, 'LeftBreakEntropy');
  const rightEntropy = gf(selectedRow, 'RightBreakEntropy');
  const leftDinuc = gf(selectedRow, 'LeftBreakDinuc');
  const rightDinuc = gf(selectedRow, 'RightBreakDinuc');
  const estJ = gf(selectedRow, 'est_J');
  const estS = gf(selectedRow, 'est_S');
  const allCount = gf(selectedRow, 'all.count');
  const estCount = gf(selectedRow, 'est_count');

  // === 全变体汇总统计（均值） ===
  const totalFq = rows.reduce((s, r) => s + parseFloat(r.fq || 0), 0);
  const avgJrc = rows.length > 0 ? (rows.reduce((s, r) => s + parseFloat(gf(r, 'junction', 'JunctionReadCount') || 0), 0) / rows.length) : 0;
  const avgSfc = rows.length > 0 ? (rows.reduce((s, r) => s + parseFloat(gf(r, 'spanningFrag', 'SpanningFragCount') || 0), 0) / rows.length) : 0;
  const avgFfpm = rows.length > 0 ? (rows.reduce((s, r) => s + parseFloat(gf(r, 'ffpm', 'FFPM.cal', 'FFPM') || 0), 0) / rows.length) : 0;

  // 第一个变体的 filter 作为主要 filter 原因
  const mainFilter = rows.length > 0 ? gf(rows[0], 'filter', 'Filter') : '';

  // Arriba 行
  const arribaRows = rows.map(r => ({
    id: normalizeTfId(r.squeue), fusion_name: r.fusionName || fusionName,
    left_gene: r.leftGene || r.LeftGene || '', right_gene: r.rightGene || r.RightGene || '',
    left_breakpoint: r.leftBreakpoint || r.LeftBreakpoint || r.LeftLocalBreakpoint || '',
    right_breakpoint: r.rightBreakpoint || r.RightBreakpoint || r.RightLocalBreakpoint || '',
    cds_left_id: r.CDS_LEFT_ID || '.', cds_right_id: r.CDS_RIGHT_ID || '.',
    prot_fusion_type: r.PROT_FUSION_TYPE || '', fusion_transl: r.FUSION_TRANSL || '',
    avg_junction_read_count: parseFloat(r.junction || r.JunctionReadCount || 0),
    avg_spanning_frag_count: parseFloat(r.spanningFrag || r.SpanningFragCount || 0),
    fq: parseFloat(r.fq || 0), avg_ffpm: parseFloat(r.ffpm || r['FFPM.cal'] || 0), ...r,
  }));
  const selectedArribaRow = selectedRow
    ? arribaRows.find(r => String(r.id) === normalizeTfId(selectedRow.squeue)) || arribaRows[0]
    : null;

  // Arriba组件选择变体时，同步到本页 selectedRow，保证下方蛋白结构预测一起切换
  const handleSelectArribaVariant = (row) => {
    const targetId = row?.id ?? row?.squeue;
    const orig = rows.find(r => normalizeTfId(r.squeue) === normalizeTfId(targetId));
    if (orig) setSelectedRow(orig);
  };

  const selectedProteinSequence = gf(selectedRow, 'FUSION_TRANSL', 'fusion_transl');
  const selectedProteinVariantId = squeueId ? normalizeTfId(squeueId) : '';
  const selectedProteinStorageId = selectedProteinVariantId ? `TF${selectedProteinVariantId}` : '';

  // 变体分页
  const totalVariantPages = Math.ceil(rows.length / variantsPerPage);
  const pagedVariants = rows.slice((variantPage - 1) * variantsPerPage, variantPage * variantsPerPage);

  // Loading
  if (loading) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500 mb-4"></div>
      <p className="text-orange-600">{DD.loading}</p>
    </div>
  );
  // Error
  if (error || rows.length === 0) return (
    <div className="min-h-screen p-10 bg-slate-50">
      <div className="max-w-2xl mx-auto bg-white rounded-xl shadow border-2 border-red-200 p-6">
        <AlertCircle className="text-red-500 mb-2" size={24} />
        <h2 className="text-xl font-bold text-red-700 mb-2">{DD.loadFailTitle}</h2>
        <p className="text-red-600 mb-4">{error || DD.notFoundData}</p>
        <button onClick={() => navigate(-1)} className="px-4 py-2 bg-slate-100 rounded hover:bg-slate-200 text-sm">{DD.backBtn}</button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-red-50">

      {/* === Sticky 顶部栏 === */}
      <div className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-orange-200 shadow-sm">
        <div className="max-w-[1400px] mx-auto px-4 py-3 flex items-center justify-between">
          <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-slate-500 hover:text-slate-800 transition text-sm">
            <ArrowLeft size={18} /> {DD.backBtn}
          </button>
          <div className="text-center">
            <h1 className="text-xl md:text-2xl font-bold text-orange-600 flex items-center justify-center gap-2">
              {fusionNameDisplay}
              <span className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded text-xs font-bold border border-orange-200">FILTER</span>
              {mainFilter && <span className="px-2 py-0.5 bg-red-100 text-red-600 rounded text-xs font-bold border border-red-200">{mainFilter}</span>}
            </h1>
            <p className="text-xs text-slate-400">{DD.variantsCount(rows.length)}</p>
          </div>
          <div className="w-16"></div>{/* spacer for centering */}
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-4 py-6 space-y-6">

        {/* === Filter 原因 === */}
        {mainFilter && (
          <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-4 flex items-start gap-3">
            <AlertTriangle className="text-amber-600 flex-shrink-0 mt-0.5" size={22} />
            <div>
              <h3 className="font-bold text-amber-800 text-sm mb-1">{DD.filterReasonTitle}</h3>
              <p className="text-amber-700 font-semibold text-lg">{mainFilter}</p>
              <p className="text-xs text-amber-600 mt-1">{DD.filterReasonHint}</p>
            </div>
          </div>
        )}

        {/* === 汇总统计卡片（全变体均值，无编号） === */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: DD.variantCount, value: rows.length, color: 'blue' },
            { label: DD.totalFq, value: totalFq, color: 'green' },
            { label: 'Avg Junction', value: avgJrc.toFixed(2), color: 'purple' },
            { label: 'Avg Spanning', value: avgSfc.toFixed(2), color: 'indigo' },
            { label: 'Avg FFPM', value: avgFfpm ? avgFfpm.toFixed(4) : 'N/A', color: 'slate' },
          ].map(c => (
            <div key={c.label} className="bg-white rounded-lg p-3 shadow-sm border border-slate-200 text-center">
              <div className="text-xs text-slate-500 mb-1">{c.label}</div>
              <div className={`text-lg font-bold text-${c.color}-600`}>{c.value}</div>
            </div>
          ))}
        </div>

        {/* === 变体列表（分页，每页10条） === */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <h3 className="font-bold text-slate-800 mb-3">{DD.variantListTitle(rows.length)}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-orange-50">
                <tr>
                  {DD.tableHeaders.map(h => (
                    <th key={h} className="px-3 py-2 text-left font-semibold text-slate-700">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pagedVariants.map((r, idx) => {
                  const isSel = selectedRow && r.squeue === selectedRow.squeue;
                  return (
                    <tr key={r.squeue || idx} onClick={() => setSelectedRow(r)}
                      className={`cursor-pointer transition border-t ${isSel ? 'bg-orange-100 font-bold ring-1 ring-orange-300' : idx % 2 === 0 ? 'bg-white hover:bg-orange-50' : 'bg-gray-50 hover:bg-orange-50'}`}>
                      <td className="px-3 py-2"><span className="font-mono text-orange-600">TF{normalizeTfId(r.squeue)}</span></td>
                      <td className="px-3 py-2 font-mono">{r.leftBreakpoint || r.LeftBreakpoint || '-'}</td>
                      <td className="px-3 py-2 font-mono">{r.rightBreakpoint || r.RightBreakpoint || '-'}</td>
                      <td className="px-3 py-2 text-green-700 font-bold">{r.fq || 0}</td>
                      <td className="px-3 py-2">{r.junction || r.JunctionReadCount || 0}</td>
                      <td className="px-3 py-2">{r.spanningFrag || r.SpanningFragCount || 0}</td>
                      <td className="px-3 py-2">{r.PROT_FUSION_TYPE || '-'}</td>
                      <td className="px-3 py-2"><span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-xs">{r.filter || r.Filter || '-'}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* 分页 */}
          {totalVariantPages > 1 && (
            <div className="flex items-center justify-between mt-3 pt-3 border-t">
              <span className="text-xs text-slate-500">
                {DD.paginationRange((variantPage - 1) * variantsPerPage + 1, Math.min(variantPage * variantsPerPage, rows.length), rows.length)}
              </span>
              <div className="flex items-center gap-1">
                <button onClick={() => setVariantPage(p => Math.max(1, p - 1))} disabled={variantPage === 1}
                  className="p-1.5 border rounded hover:bg-slate-100 disabled:opacity-40"><ChevronLeft size={14} /></button>
                {Array.from({ length: Math.min(5, totalVariantPages) }, (_, i) => {
                  let p; const tp = totalVariantPages; const cp = variantPage;
                  if (tp <= 5) p = i + 1; else if (cp <= 3) p = i + 1; else if (cp >= tp - 2) p = tp - 4 + i; else p = cp - 2 + i;
                  return (
                    <button key={p} onClick={() => setVariantPage(p)}
                      className={`w-7 h-7 rounded text-xs font-semibold ${cp === p ? 'bg-orange-500 text-white' : 'border hover:bg-slate-100'}`}>{p}</button>
                  );
                })}
                <button onClick={() => setVariantPage(p => Math.min(totalVariantPages, p + 1))} disabled={variantPage === totalVariantPages}
                  className="p-1.5 border rounded hover:bg-slate-100 disabled:opacity-40"><ChevronRight size={14} /></button>
              </div>
            </div>
          )}
        </div>

        {/* === 选中变体的基因与断点详情（点击变体后显示） === */}
        {selectedRow && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-4">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <Dna size={18} className="text-blue-500" />
              {DD.geneBreakpointTitle}
              <span className="text-xs font-mono text-orange-600 bg-orange-50 px-2 py-0.5 rounded border border-orange-200">TF{normalizeTfId(squeueId)}</span>
              {filterReason && <span className="px-2 py-0.5 bg-red-100 text-red-600 rounded text-xs">{filterReason}</span>}
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* 左侧基因 */}
              <div className="space-y-3">
                <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                  <div className="text-xs text-blue-600 font-bold mb-2">{DD.leftGeneHeader}</div>
                  <div className="space-y-1 text-sm">
                    <div><span className="text-slate-500 inline-block w-16">{DD.geneNameLabel}</span> <span className="font-bold text-blue-700">{cleanGene(leftGeneRaw)}</span></div>
                    <div><span className="text-slate-500 inline-block w-16">{DD.ensgLabel}</span> <span className="font-mono text-xs">{extractEnsg(leftGeneRaw)}</span></div>
                    <div><span className="text-slate-500 inline-block w-16">{DD.breakpointLabel}</span> <span className="font-mono text-xs">{leftBp || 'N/A'}</span></div>
                    {leftDinuc && <div><span className="text-slate-500 inline-block w-16">{DD.dinucLabel}</span> <span className="font-mono text-xs">{leftDinuc}</span></div>}
                    {leftEntropy && <div><span className="text-slate-500 inline-block w-16">{DD.entropyLabel}</span> <span className="font-mono text-xs">{leftEntropy}</span></div>}
                  </div>
                </div>
                <GeneFunctionCard geneName={leftGeneRaw} side="left" />
              </div>
              {/* 右侧基因 */}
              <div className="space-y-3">
                <div className="bg-purple-50 rounded-lg p-4 border border-purple-200">
                  <div className="text-xs text-purple-600 font-bold mb-2">{DD.rightGeneHeader}</div>
                  <div className="space-y-1 text-sm">
                    <div><span className="text-slate-500 inline-block w-16">{DD.geneNameLabel}</span> <span className="font-bold text-purple-700">{cleanGene(rightGeneRaw)}</span></div>
                    <div><span className="text-slate-500 inline-block w-16">{DD.ensgLabel}</span> <span className="font-mono text-xs">{extractEnsg(rightGeneRaw)}</span></div>
                    <div><span className="text-slate-500 inline-block w-16">{DD.breakpointLabel}</span> <span className="font-mono text-xs">{rightBp || 'N/A'}</span></div>
                    {rightDinuc && <div><span className="text-slate-500 inline-block w-16">{DD.dinucLabel}</span> <span className="font-mono text-xs">{rightDinuc}</span></div>}
                    {rightEntropy && <div><span className="text-slate-500 inline-block w-16">{DD.entropyLabel}</span> <span className="font-mono text-xs">{rightEntropy}</span></div>}
                  </div>
                </div>
                <GeneFunctionCard geneName={rightGeneRaw} side="right" />
              </div>
            </div>

            {/* 注释（完整显示，自动换行） */}
            {annots && (
              <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                <span className="text-xs font-bold text-slate-600">{DD.annotLabel}</span>
                <p className="text-xs text-slate-700 mt-1 leading-relaxed whitespace-pre-wrap break-words">{annots}</p>
              </div>
            )}

            {/* 补充指标 */}
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-600">
              {spliceType && <div><span className="font-semibold text-slate-700">{DD.spliceTypeLabel}</span> {spliceType}</div>}
              {largeAnchor && <div><span className="font-semibold text-slate-700">{DD.largeAnchorLabel}</span> {largeAnchor}</div>}
              {estJ && <div><span className="font-semibold text-slate-700">est_J:</span> {estJ}</div>}
              {estS && <div><span className="font-semibold text-slate-700">est_S:</span> {estS}</div>}
              {allCount && <div><span className="font-semibold text-slate-700">all.count:</span> {allCount}</div>}
              {estCount && <div><span className="font-semibold text-slate-700">est_count:</span> {estCount}</div>}
              {protFusionType && <div><span className="font-semibold text-slate-700">{DD.protFusionTypeLabel}</span> {protFusionType}</div>}
            </div>

            {/* 读数质量指标 */}
            <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
              {[
                { label: 'Junction', value: jrc, color: 'blue' },
                { label: 'Spanning', value: sfc, color: 'green' },
                { label: 'est_J', value: estJ || '-', color: 'slate' },
                { label: 'est_S', value: estS || '-', color: 'slate' },
                { label: 'L.Entropy', value: leftEntropy || '-', color: 'amber' },
                { label: 'R.Entropy', value: rightEntropy || '-', color: 'amber' },
              ].map(item => (
                <div key={item.label} className="bg-slate-50 rounded p-2 text-center border border-slate-200">
                  <div className="text-[10px] text-slate-400">{item.label}</div>
                  <div className={`text-sm font-bold text-${item.color}-700`}>{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* === Arriba 融合断点图 === */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4 border-b pb-3">
            <div className="flex items-center gap-2">
              <FileImage className="text-indigo-500" size={20} />
              <h2 className="text-lg font-bold text-slate-800">{DD.arribaTitle || 'Arriba fusion breakpoint diagram'}</h2>
              {selectedProteinVariantId && (
                <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded text-xs font-mono font-bold border border-orange-200">
                  TF{selectedProteinVariantId}
                </span>
              )}
            </div>
          </div>
          <ArribaFusionDiagram
            fusionName={fusionName}
            allRows={arribaRows}
            selectedRow={selectedArribaRow}
            onSelectVariant={handleSelectArribaVariant}
            showVariantSelector={true}
            apiPrefix="/api/arriba/deleted"
          />
        </div>

        {/* === 融合蛋白结构预测 === */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          {selectedRow ? (
            <FusionProteinPredictor
              sequence={selectedProteinSequence}
              fusionName={fusionNameDisplay}
              leftGene={leftGeneRaw}
              rightGene={rightGeneRaw}
              variantId={selectedProteinVariantId}
              variantPrefix="TF"
              variantStorageId={selectedProteinStorageId}
              variantDisplayId={selectedProteinStorageId}
              cacheSource="deleted"
            />
          ) : (
            <div className="p-10 text-center text-slate-400">
              <Activity size={40} className="mx-auto mb-2" />
              <p>{DD.selectRecordHint}</p>
            </div>
          )}
        </div>

        {/* === 全字段数据表格 === */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4 border-b pb-2">
            <div className="flex items-center gap-2">
              <Database className="text-green-600" size={20} />
              <h2 className="text-lg font-bold text-slate-800">{DD.dataTableTitle(squeueId)}</h2>
            </div>
            <div className="flex items-center gap-2">
              {filterReason && <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded text-xs font-bold">{filterReason}</span>}
              {selectedRow && (
                <button onClick={() => {
                  const blob = new Blob([JSON.stringify(selectedRow, null, 2)], { type: 'application/json' });
                  const u = URL.createObjectURL(blob); const a = document.createElement('a');
                  a.href = u; a.download = `${fusionName}_TF${normalizeTfId(squeueId)}.json`; a.click(); URL.revokeObjectURL(u);
                }} className="flex items-center gap-1 text-xs bg-slate-100 hover:bg-slate-200 px-3 py-1 rounded text-slate-700 transition">
                  <Download size={14} /> {DD.exportJSON}
                </button>
              )}
            </div>
          </div>
          {selectedRow ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-0 border-t border-l border-slate-200">
              {Object.keys(selectedRow).filter(k => !k.startsWith('_')).map(key => {
                const val = selectedRow[key];
                const imp = ['leftBreakpoint', 'rightBreakpoint', 'fq', 'filter', 'PROT_FUSION_TYPE', 'junction', 'spanningFrag', 'squeue', 'fusionName'].includes(key);
                return (
                  <div key={key} className={`flex flex-col p-3 border-r border-b border-slate-200 hover:bg-slate-50 transition ${imp ? 'bg-orange-50' : ''}`}>
                    <span className="text-xs font-bold text-slate-500 uppercase mb-1">{key.replace(/[._]/g, ' ')}</span>
                    <span className="text-sm font-mono text-slate-800 max-h-32 overflow-y-auto break-words whitespace-pre-wrap">
                      {val === null || val === '' || val === undefined ? <span className="text-slate-300">-</span> : String(val)}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : <div className="text-center py-10 text-slate-400">{DD.selectRecordHint}</div>}
        </div>

      </div>
    </div>
  );
};

export default FusionDeletedDetail;