// src/components/ArribaFusionDiagram.jsx
// Arriba融合基因可视化组件 - 显示后端生成的高质量融合断点图

import React, { useState, useEffect, useCallback } from 'react';
import { 
  Download, RefreshCw, AlertCircle, ChevronRight, 
  Eye, Dna, Activity, FileText, ZoomIn, ZoomOut,
  Maximize2, Loader2, Info, CheckCircle2
} from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

// 辅助函数：获取token
async function ensureToken() {
  let token = localStorage.getItem('token');
  
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && (payload.exp - now < 300)) {
        token = null;
      }
    } catch (e) {
      token = null;
    }
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
    } catch (error) {
      console.error('[Auth] Token获取失败:', error);
    }
  }
  return token;
}

// 变体颜色生成
const getVariantColor = (index) => {
  const colors = [
    '#ef4444', '#f97316', '#eab308', '#84cc16', 
    '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
    '#6366f1', '#8b5cf6', '#d946ef', '#ec4899'
  ];
  return colors[index % colors.length];
};

const ArribaFusionDiagram = ({ 
  fusionName,
  allRows = [],
  selectedRow = null,
  onSelectVariant,
  showVariantSelector = true,
  defaultPanels = 'fusion,domains,readcounts',
  apiPrefix = '/api/arriba',   // 低可信度时传 '/api/arriba/deleted'
  // ★ 新增：变体显示模式
  //   undefined / 'id-prefix'（默认）→ 显示 "TP{id}" / "TF{id}"，保持原有逻辑
  //   'numeric'                       → 显示 "变体 N" / "Variant N"（用于细胞系详情页）
  variantLabelMode
}) => {
  // 根据 apiPrefix 决定 ID 前缀（TP / TF / CL）
  const idPrefix = apiPrefix.includes('cellfusion') ? 'CL' : (apiPrefix.includes('deleted') ? 'TF' : 'TP');
  // ★ 是否启用"变体 N"数字模式
  const useNumericLabel = variantLabelMode === 'numeric';
  // 状态
  const [variants, setVariants] = useState([]);
  const [currentVariant, setCurrentVariant] = useState(null);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [arribaStatus, setArribaStatus] = useState(null);
  const [zoom, setZoom] = useState(100);
  const [panels, setPanels] = useState(defaultPanels);
  const [showFullscreen, setShowFullscreen] = useState(false);
  const { t } = useLanguage();
  const A = t.arriba;

  // 检查Arriba环境状态
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const token = await ensureToken();
        const res = await fetch('/api/arriba/status', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        setArribaStatus(data.data);
      } catch (e) {
        console.error('[Arriba] 状态检查失败:', e);
      }
    };
    checkStatus();
  }, []);

  // 使用传入的allRows作为变体数据，或从API获取
  useEffect(() => {
    if (allRows && allRows.length > 0) {
      // 使用传入的数据，按fq排序
      const sorted = [...allRows].sort((a, b) => (b.fq || 0) - (a.fq || 0));
      setVariants(sorted);
      
      // 设置默认选中的变体（FQ最高的）
      if (selectedRow) {
        setCurrentVariant(selectedRow);
      } else {
        setCurrentVariant(sorted[0]);
      }
      setLoading(false);
    } else if (fusionName) {
      // 从API获取变体列表
      fetchVariants();
    }
  }, [fusionName, allRows, selectedRow]);

  // 当selectedRow改变时更新currentVariant
  useEffect(() => {
    if (selectedRow) {
      setCurrentVariant(selectedRow);
    }
  }, [selectedRow]);

  // 当currentVariant改变时获取PDF
  useEffect(() => {
    if (currentVariant?.id) {
      fetchPdf(currentVariant.id);
    }
  }, [currentVariant?.id, panels]);

  // 获取变体列表
  const fetchVariants = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const token = await ensureToken();
      const res = await fetch(`${apiPrefix}/variants/${encodeURIComponent(fusionName)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!res.ok) throw new Error(`API错误: ${res.status}`);
      
      const data = await res.json();
      if (data.code === 200 && data.data) {
        setVariants(data.data.variants || []);
        
        // 设置默认变体
        if (data.data.variants?.length > 0) {
          const defaultId = data.data.default_variant_id;
          const defaultVar = data.data.variants.find(v => v.id === defaultId) || data.data.variants[0];
          setCurrentVariant(defaultVar);
        }
      }
    } catch (e) {
      console.error('[Arriba] 获取变体失败:', e);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // 获取PDF图
  const fetchPdf = async (fusionId, forceRegenerate = false) => {
    try {
      setGenerating(true);
      setPdfUrl(null);
      
      const token = await ensureToken();
      const params = new URLSearchParams({
        panels: panels,
        ...(forceRegenerate ? { force: 'true' } : {})
      });
      
      const res = await fetch(`${apiPrefix}/diagram/${encodeURIComponent(fusionId)}?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(errorData.message || `生成失败: ${res.status}`);
      }
      
      // 创建Blob URL
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setPdfUrl(url);
      setError(null);
      
    } catch (e) {
      console.error('[Arriba] PDF获取失败:', e);
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  // 下载PDF
  const handleDownload = async () => {
    if (!currentVariant?.id) return;
    
    try {
      const token = await ensureToken();
      const res = await fetch(`${apiPrefix}/diagram/download/${encodeURIComponent(currentVariant.id)}?panels=${encodeURIComponent(panels)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!res.ok) throw new Error('下载失败');
      
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fusionName}_${formatVariantLabel(currentVariant)}_arriba.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('[Arriba] 下载失败:', e);
    }
  };

  // 切换变体
  const handleVariantSelect = (variant) => {
    setCurrentVariant(variant);
    if (onSelectVariant) {
      onSelectVariant(variant);
    }
  };

  // 重新生成
  const handleRegenerate = () => {
    if (currentVariant?.id) {
      fetchPdf(currentVariant.id, true);
    }
  };

  // 清理Blob URL
  useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
  }, [pdfUrl]);

  // 格式化断点显示
  const formatBreakpoint = (bp) => {
    if (!bp) return 'N/A';
    const match = bp.match(/(?:chr)?([^:]+):(\d+)/);
    if (match) {
      return `chr${match[1]}:${parseInt(match[2]).toLocaleString()}`;
    }
    return bp;
  };

  // 获取融合类型标签
  const getFusionTypeBadge = (type) => {
    const types = {
      'INFRAME': { label: 'In-frame', color: 'bg-green-100 text-green-700 border-green-200' },
      'FRAMESHIFT': { label: 'Frameshift', color: 'bg-amber-100 text-amber-700 border-amber-200' },
      'in-frame': { label: 'In-frame', color: 'bg-green-100 text-green-700 border-green-200' },
      'out-of-frame': { label: 'Out-of-frame', color: 'bg-amber-100 text-amber-700 border-amber-200' },
    };
    // 检查是否有有效的类型，没有则显示NA
    const isValidType = type && type !== '.' && type !== 'unknown' && type !== '';
    const t = types[type] || { label: isValidType ? type : 'NA', color: 'bg-slate-100 text-slate-600 border-slate-200' };
    return (
      <span className={`px-2 py-0.5 rounded text-xs font-medium border ${t.color}`}>
        {t.label}
      </span>
    );
  };

  // ★ 格式化变体显示标签
  //   numeric 模式下显示 "变体 N" / "Variant N"
  //   默认模式下显示 "TP{id}" / "TF{id}"
  //   explicitIndex 优先使用，否则根据 variant.variant_num 或在 variants 数组中的位置推断
  const formatVariantLabel = (variant, explicitIndex) => {
    if (!variant) return '';
    if (useNumericLabel) {
      let num;
      if (typeof explicitIndex === 'number') {
        num = explicitIndex + 1;
      } else if (variant.variant_num) {
        num = variant.variant_num;
      } else {
        const idx = variants.findIndex(v => v.id === variant.id);
        num = idx >= 0 ? idx + 1 : 1;
      }
      return A.variantLabel(num);  // "变体 N" / "Variant N"
    }
    const rawId = String(variant.display_id || variant.id || '');
    return rawId.toUpperCase().startsWith(idPrefix) ? rawId : `${idPrefix}${rawId}`;
  };

  // 渲染加载状态
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 bg-slate-50 rounded-xl border border-slate-200">
        <Loader2 className="animate-spin text-blue-500 mb-4" size={40} />
        <p className="text-slate-600">{A.loadingVariants}</p>
      </div>
    );
  }

  // 渲染Arriba环境不可用状态
  if (arribaStatus && !arribaStatus.ready) {
    return (
      <div className="bg-amber-50 border-2 border-amber-200 rounded-xl p-6">
        <div className="flex items-start gap-3">
          <AlertCircle className="text-amber-500 mt-1" size={24} />
          <div>
            <h3 className="font-bold text-amber-800 mb-2">{A.envNotReady}</h3>
            <p className="text-amber-700 text-sm mb-4">
              {A.envCheckConfig}
            </p>
            <div className="bg-white rounded-lg p-4 border border-amber-200">
              <ul className="space-y-2 text-sm">
                <li className="flex items-center gap-2">
                  {arribaStatus.conda_available ? 
                    <CheckCircle2 size={16} className="text-green-500" /> : 
                    <AlertCircle size={16} className="text-red-500" />}
                  <span>{A.envConda(arribaStatus.conda_env)}</span>
                </li>
                <li className="flex items-center gap-2">
                  {arribaStatus.r_script_available ? 
                    <CheckCircle2 size={16} className="text-green-500" /> : 
                    <AlertCircle size={16} className="text-red-500" />}
                  <span>{A.envRScript}</span>
                </li>
                <li className="flex items-center gap-2">
                  {arribaStatus.annotation_available ? 
                    <CheckCircle2 size={16} className="text-green-500" /> : 
                    <AlertCircle size={16} className="text-red-500" />}
                  <span>{A.envAnnotation}</span>
                </li>
                <li className="flex items-center gap-2">
                  {arribaStatus.cytobands_available ? 
                    <CheckCircle2 size={16} className="text-green-500" /> : 
                    <AlertCircle size={16} className="text-red-500" />}
                  <span>{A.envCytobands}</span>
                </li>
                <li className="flex items-center gap-2">
                  {arribaStatus.protein_domains_available ? 
                    <CheckCircle2 size={16} className="text-green-500" /> : 
                    <AlertCircle size={16} className="text-red-500" />}
                  <span>{A.envProteinDomains}</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 顶部工具栏 - 当前选中信息（替代原来的显示面板） */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-50 rounded-lg p-4 border border-slate-200">
        {/* 当前选中变体信息 */}
        {currentVariant && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-600">
              {useNumericLabel ? A.currentVariantLabel : A.currentVariantId}
            </span>
            <span className="font-mono font-bold text-lg text-blue-600 bg-blue-50 px-3 py-1 rounded-lg border-2 border-blue-200">
              {formatVariantLabel(currentVariant)}
            </span>
            <span className="text-sm text-slate-500">
              FQ: <span className="font-bold text-blue-600">{currentVariant.fq || 0}</span>
            </span>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex items-center gap-2">
          {/* 缩放控制 */}
          <div className="flex items-center gap-1 bg-white rounded border border-slate-300">
            <button 
              onClick={() => setZoom(Math.max(50, zoom - 25))}
              className="p-1.5 hover:bg-slate-100 transition"
              title={A.zoomOut}
            >
              <ZoomOut size={16} className="text-slate-600" />
            </button>
            <span className="text-xs text-slate-600 min-w-[40px] text-center">{zoom}%</span>
            <button 
              onClick={() => setZoom(Math.min(200, zoom + 25))}
              className="p-1.5 hover:bg-slate-100 transition"
              title={A.zoomIn}
            >
              <ZoomIn size={16} className="text-slate-600" />
            </button>
          </div>

          {/* 全屏按钮 */}
          <button
            onClick={() => setShowFullscreen(true)}
            className="p-2 bg-white border border-slate-300 rounded hover:bg-slate-50 transition"
            title={A.fullscreen}
          >
            <Maximize2 size={16} className="text-slate-600" />
          </button>

          {/* 重新生成 */}
          <button
            onClick={handleRegenerate}
            disabled={generating}
            className="flex items-center gap-1 px-3 py-2 bg-white border border-slate-300 rounded hover:bg-slate-50 transition disabled:opacity-50"
          >
            <RefreshCw size={14} className={generating ? 'animate-spin' : ''} />
            <span className="text-xs">{A.regenerate}</span>
          </button>

          {/* 下载 */}
          <button
            onClick={handleDownload}
            disabled={!pdfUrl || generating}
            className="flex items-center gap-1 px-3 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition disabled:opacity-50"
          >
            <Download size={14} />
            <span className="text-xs">{A.downloadPdf}</span>
          </button>
        </div>
      </div>

      {/* 主内容区 */}
      <div className="flex gap-4">
        {/* PDF预览区 */}
        <div className="flex-1 bg-white rounded-xl border border-slate-200 overflow-hidden">
          {generating ? (
            <div className="flex flex-col items-center justify-center py-32 bg-slate-50">
              <Loader2 className="animate-spin text-blue-500 mb-4" size={48} />
              <p className="text-slate-600 font-medium">{A.generating}</p>
              <p className="text-slate-400 text-sm mt-1">{A.generatingHint}</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-20 bg-red-50">
              <AlertCircle className="text-red-400 mb-4" size={48} />
              <p className="text-red-600 font-medium mb-2">{A.generateFailed}</p>
              <p className="text-red-500 text-sm mb-4">{error}</p>
              <button
                onClick={handleRegenerate}
                className="px-4 py-2 bg-red-100 text-red-700 rounded hover:bg-red-200 transition"
              >
                {A.retry}
              </button>
            </div>
          ) : pdfUrl ? (
            <div 
              className="overflow-auto bg-slate-100"
              style={{ maxHeight: '600px' }}
            >
              <div 
                style={{ 
                  transform: `scale(${zoom / 100})`,
                  transformOrigin: 'top left',
                  width: `${100 / (zoom / 100)}%`
                }}
              >
                <embed
                  src={pdfUrl}
                  type="application/pdf"
                  width="100%"
                  height="600px"
                  className="border-0"
                />
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 bg-slate-50">
              <Eye className="text-slate-300 mb-4" size={48} />
              <p className="text-slate-500">{A.selectVariantHint}</p>
            </div>
          )}
        </div>

        {/* 变体选择器 */}
        {showVariantSelector && variants.length > 0 && (
          <div className="w-80 bg-white rounded-xl border border-slate-200 overflow-hidden flex flex-col">
            {/* 标题 */}
            <div className="bg-gradient-to-r from-blue-500 to-indigo-500 px-4 py-3">
              <h3 className="font-bold text-white">{A.variantSelectorTitle}</h3>
              <p className="text-blue-100 text-xs mt-0.5">
                {A.variantCount(variants.length)}
              </p>
            </div>

            {/* 变体列表 */}
            <div className="flex-1 overflow-y-auto max-h-[500px]">
              {variants.map((variant, index) => {
                const isSelected = currentVariant?.id === variant.id;
                const color = getVariantColor(index);
                
                return (
                  <div
                    key={variant.id}
                    onClick={() => handleVariantSelect(variant)}
                    className={`p-3 border-b border-slate-100 cursor-pointer transition ${
                      isSelected 
                        ? 'bg-blue-50 border-l-4 border-l-blue-500' 
                        : 'hover:bg-slate-50 border-l-4 border-l-transparent'
                    }`}
                    style={isSelected ? { borderLeftColor: color } : {}}
                  >
                    {/* 变体头部 */}
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-3 h-3 rounded-full" 
                          style={{ backgroundColor: color }}
                        />
                        <span className="font-bold text-slate-700 text-sm">
                          {A.variantLabel(index + 1)}
                        </span>
                        {index === 0 && (
                          <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-xs">
                            {A.highestFQ}
                          </span>
                        )}
                      </div>
                      {isSelected && (
                        <ChevronRight size={16} className="text-blue-500" />
                      )}
                    </div>

                    {/* 显著显示变体ID（numeric 模式下改显示 cell_line 名，更实用） */}
                    <div className="mb-2">
                      {useNumericLabel ? (
                        variant.cell_line ? (
                          <span className="inline-flex items-center px-2.5 py-1 bg-amber-100 text-amber-700 font-mono font-bold text-sm rounded border border-amber-200 max-w-full truncate" title={variant.cell_line}>
                            {variant.cell_line}
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-1 bg-blue-100 text-blue-700 font-mono font-bold text-sm rounded border border-blue-200">
                            {formatVariantLabel(variant, index)}
                          </span>
                        )
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-1 bg-blue-100 text-blue-700 font-mono font-bold text-sm rounded border border-blue-200">
                          {formatVariantLabel(variant, index)}
                        </span>
                      )}
                    </div>

                    {/* 断点信息 */}
                    <div className="space-y-1.5 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400 w-14">{A.leftBreakpoint}</span>
                        <span className="font-mono text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
                          {formatBreakpoint(variant.left_breakpoint)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400 w-14">{A.rightBreakpoint}</span>
                        <span className="font-mono text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
                          {formatBreakpoint(variant.right_breakpoint)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
                        <div className="flex items-center gap-1">
                          <span className="text-slate-400">FQ:</span>
                          <span className="font-bold text-blue-600">{variant.fq || 0}</span>
                        </div>
                        {getFusionTypeBadge(variant.prot_fusion_type || variant.reading_frame)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 底部当前选中信息 */}
            {currentVariant && (
              <div className="p-3 bg-slate-50 border-t border-slate-200">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">{A.currentVariantLabel}</span>
                  <span className="font-mono font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                    {formatVariantLabel(currentVariant)}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 全屏模态框 */}
      {showFullscreen && pdfUrl && (
        <div 
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setShowFullscreen(false)}
        >
          <div 
            className="bg-white rounded-xl max-w-6xl max-h-[90vh] w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 bg-slate-100 border-b">
              <h3 className="font-bold text-slate-700">
                {fusionName} - <span className="text-blue-600">{formatVariantLabel(currentVariant)}</span>
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDownload}
                  className="flex items-center gap-1 px-3 py-1.5 bg-blue-500 text-white rounded text-sm hover:bg-blue-600"
                >
                  <Download size={14} />
                  {A.downloadPdf}
                </button>
                <button
                  onClick={() => setShowFullscreen(false)}
                  className="px-3 py-1.5 bg-slate-200 text-slate-700 rounded text-sm hover:bg-slate-300"
                >
                  {A.close}
                </button>
              </div>
            </div>
            <div className="overflow-auto" style={{ maxHeight: 'calc(90vh - 60px)' }}>
              <embed
                src={pdfUrl}
                type="application/pdf"
                width="100%"
                height="800px"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ArribaFusionDiagram;


