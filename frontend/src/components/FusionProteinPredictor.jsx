import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Activity, Download, Info, Loader, AlertTriangle, ExternalLink, Zap, Copy, CheckCircle, RefreshCw, XCircle, Play, Sparkles, Database, RotateCcw, Maximize2, Layers } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

// ========== 序列清理函数 ==========
const VALID_AA = new Set('ACDEFGHIKLMNPQRSTVWY'.split(''));

const cleanSequence = (seq) => {
  if (!seq) return '';
  return seq.toUpperCase().split('').filter(char => VALID_AA.has(char)).join('');
};

// ========== 3Dmol.js 查看器组件 ==========
const MolstarViewer = ({ pdbContent, variantId, displayId, sourceLabel }) => {
  const viewerRef = useRef(null);
  const viewerInstanceRef = useRef(null);
  const [viewerReady, setViewerReady] = useState(false);
  const [baseStyle, setBaseStyle] = useState('cartoon');
  const [showSurface, setShowSurface] = useState(false);
  const [isSpinning, setIsSpinning] = useState(true);
  const { t } = useLanguage();
  const P = t.fusionProtein;

  // 动态加载 3Dmol.js
  useEffect(() => {
    if (window.$3Dmol) {
      setViewerReady(true);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/3Dmol/2.0.3/3Dmol-min.js';
    script.async = true;
    script.onload = () => {
      console.log('[3Dmol] 加载完成');
      setViewerReady(true);
    };
    script.onerror = () => {
      console.error('[3Dmol] 加载失败');
    };
    document.head.appendChild(script);
  }, []);

  // 应用渲染样式（基础样式 + 可选表面）
  const applyStyles = useCallback((viewer, style, withSurface) => {
    if (!viewer) return;
    
    // 先清除所有样式和表面
    viewer.setStyle({}, {});
    viewer.removeAllSurfaces();
    
    // 应用基础样式
    switch (style) {
      case 'cartoon':
        viewer.setStyle({}, { cartoon: { color: 'spectrum' } });
        break;
      case 'stick':
        viewer.setStyle({}, { stick: { colorscheme: 'Jmol' } });
        break;
      case 'sphere':
        viewer.setStyle({}, { sphere: { colorscheme: 'Jmol', scale: 0.3 } });
        break;
      default:
        viewer.setStyle({}, { cartoon: { color: 'spectrum' } });
    }
    
    // 如果开启表面，添加半透明表面层
    if (withSurface) {
      viewer.addSurface(window.$3Dmol.SurfaceType.VDW, { 
        opacity: 0.4, 
        color: 'white'
      });
    }
    
    viewer.render();
  }, []);

  // 初始化查看器
  useEffect(() => {
    if (!viewerReady || !pdbContent || !viewerRef.current) return;

    // 清理旧的查看器
    if (viewerInstanceRef.current) {
      viewerInstanceRef.current.clear();
    }

    try {
      const config = { backgroundColor: '0xf8fafc' };
      const viewer = window.$3Dmol.createViewer(viewerRef.current, config);
      
      viewer.addModel(pdbContent, 'pdb');
      
      // 应用初始样式
      applyStyles(viewer, baseStyle, showSurface);
      
      viewer.zoomTo();
      viewer.render();
      viewer.spin('y', 0.5);
      
      viewerInstanceRef.current = viewer;
      
      console.log('[3Dmol] 结构渲染成功');
    } catch (err) {
      console.error('[3Dmol] 渲染失败:', err);
    }

    return () => {
      if (viewerInstanceRef.current) {
        viewerInstanceRef.current.clear();
      }
    };
  }, [viewerReady, pdbContent]);

  // 当样式或表面状态改变时更新
  useEffect(() => {
    if (viewerInstanceRef.current) {
      applyStyles(viewerInstanceRef.current, baseStyle, showSurface);
    }
  }, [baseStyle, showSurface, applyStyles]);

  // 切换基础样式
  const changeBaseStyle = (newStyle) => {
    setBaseStyle(newStyle);
  };

  // 切换表面层
  const toggleSurface = () => {
    setShowSurface(!showSurface);
  };

  // 重置视图
  const resetView = () => {
    if (viewerInstanceRef.current) {
      viewerInstanceRef.current.zoomTo();
      viewerInstanceRef.current.render();
    }
  };

  // 切换旋转
  const toggleSpin = () => {
    if (viewerInstanceRef.current) {
      if (isSpinning) {
        viewerInstanceRef.current.spin(false);
      } else {
        viewerInstanceRef.current.spin('y', 0.5);
      }
      setIsSpinning(!isSpinning);
    }
  };

  if (!viewerReady) {
    return (
      <div className="flex items-center justify-center h-96 bg-slate-100 rounded-lg">
        <div className="text-center">
          <Loader size={32} className="animate-spin text-purple-600 mx-auto mb-3" />
          <p className="text-slate-600 text-sm">{P.loading3d}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* 控制栏 */}
      <div className="absolute top-3 left-3 z-10 flex gap-2">
        {/* 基础样式选择 - 三选一 */}
        <div className="bg-white/95 backdrop-blur-sm rounded-lg shadow-lg p-1 flex gap-1">
          {[
            { id: 'cartoon', label: P.styleCartoon, icon: '🎨' },
            { id: 'stick', label: P.styleStick, icon: '📍' },
            { id: 'sphere', label: P.styleSphere, icon: '⚪' },
          ].map(({ id, label, icon }) => (
            <button
              key={id}
              onClick={() => changeBaseStyle(id)}
              className={`px-2 py-1 text-xs rounded transition flex items-center gap-1 ${
                baseStyle === id 
                  ? 'bg-purple-600 text-white' 
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
              title={label}
            >
              <span>{icon}</span>
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>

        {/* 表面叠加层开关 - 独立切换 */}
        <button
          onClick={toggleSurface}
          className={`px-2 py-1 text-xs rounded transition flex items-center gap-1 shadow-lg ${
            showSurface 
              ? 'bg-blue-600 text-white' 
              : 'bg-white/95 hover:bg-slate-100 text-slate-700'
          }`}
          title={showSurface ? P.surfaceOn : P.surfaceOff}
        >
          <Layers size={14} />
          <span className="hidden sm:inline">{P.surfaceLabel}</span>
          {showSurface && <span className="text-[10px]">✓</span>}
        </button>
      </div>

      {/* 右上角控制 */}
      <div className="absolute top-3 right-3 z-10 flex gap-2">
        <button
          onClick={toggleSpin}
          className={`p-2 rounded-lg shadow-lg transition ${
            isSpinning 
              ? 'bg-purple-600 text-white' 
              : 'bg-white/95 text-slate-700 hover:bg-slate-100'
          }`}
          title={isSpinning ? P.spinStop : P.spinStart}
        >
          <RotateCcw size={16} />
        </button>
        <button
          onClick={resetView}
          className="p-2 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg text-slate-700 hover:bg-slate-100 transition"
          title={P.resetView}
        >
          <Maximize2 size={16} />
        </button>
      </div>

      {/* 3D 查看器容器 */}
      <div 
        ref={viewerRef} 
        className="w-full rounded-lg border-2 border-slate-200 shadow-inner"
        style={{ height: '450px', position: 'relative' }}
      />

      {/* 底部信息 */}
      <div className="absolute bottom-3 left-3 right-3 z-10">
        <div className="bg-black/70 backdrop-blur-sm text-white text-xs px-3 py-2 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span>{(typeof P.footerStructure(variantId) === 'string' && displayId) ? P.footerStructure(variantId).split(`T${variantId}`).join(displayId) : P.footerStructure(variantId)}</span>
            <span className="text-slate-300">|</span>
            <span className={(sourceLabel || P.localAf2Label || LOCAL_AF2_LABEL).includes('ESMFold') ? 'text-cyan-400' : 'text-green-400'}>
                {sourceLabel || P.localAf2Label || LOCAL_AF2_LABEL}
              </span>
            {showSurface && (
              <>
                <span className="text-slate-300">|</span>
                <span className="text-blue-400">{P.footerSurface}</span>
              </>
            )}
          </div>
          <div className="text-slate-300">
            {P.footerHint}
          </div>
        </div>
      </div>

      {/* 置信度图例 */}
      <div className="absolute bottom-16 right-3 z-10 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg p-3">
        <div className="text-xs font-bold text-slate-700 mb-2">{P.colorLegendTitle}</div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-3 rounded" style={{ background: 'linear-gradient(90deg, #0000ff, #00ffff, #00ff00, #ffff00, #ff0000)' }} />
          <span className="text-xs text-slate-500 ml-1">{P.colorLegendLabel}</span>
        </div>
      </div>
    </div>
  );
};

const ZJU_AF3_CONFIG = { websiteUrl: 'https://alphafold.zjuaim.com' };
const API_BASE_URL = '/api/protein';
const getAuthToken = () => localStorage.getItem('token');
const LOCAL_AF2_LABEL = 'ESMFold';
const FRONTEND_MAX_AA = 2000;

// ========== ESMFold 快速预览配置 ==========
// 注意：ESMFold 外部 API 有 CORS 限制，浏览器无法直接调用。
// 改为调用后端代理路由 /api/protein/esm-fold，由 Python 服务端转发请求。
const ESM_FOLD_MAX_AA = 600;       // 超过此长度不再启动本地 ColabFold，提示用户点击下方按钮到外部网站预测
const ESM_FOLD_TIMEOUT_MS = 100000; // 100 秒前端超时（后端代理本身有 90s 超时）
const ESM_FOLD_LABEL = 'ESMFold prediction';

const fetchEsmFold = async (sequence) => {
  if (!sequence || sequence.length > ESM_FOLD_MAX_AA) {
    return { success: false, reason: 'tooLong' };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ESM_FOLD_TIMEOUT_MS);
    // 调用后端代理，由 Flask 服务端转发至 ESMFold API，规避浏览器 CORS 限制
    const response = await fetch(`${API_BASE_URL}/esm-fold`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}`,
      },
      body: JSON.stringify({ sequence }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) return { success: false, reason: 'httpError', status: response.status };
    const data = await response.json().catch(() => ({}));
    if (!data.success || !data.pdb_content) return { success: false, reason: 'invalidResponse' };
    if (!data.pdb_content.includes('ATOM')) return { success: false, reason: 'invalidPdb' };
    return { success: true, pdbContent: data.pdb_content };
  } catch (err) {
    return { success: false, reason: err.name === 'AbortError' ? 'timeout' : 'fetchError', message: err.message };
  }
};

const FusionProteinPredictor = ({
  sequence,
  leftGene,
  rightGene,
  variantId,
  variantPrefix = 'TP',
  variantDisplayId
}) => {
  // 前端展示编号：普通融合蛋白由 T{id} 改为 TP{id}
  // 兼容父组件仍传 variantPrefix="T" 或 variantDisplayId="T{id}" 的情况
  const displayPrefix = variantPrefix === 'T' ? 'TP' : variantPrefix;
  const normalizeDisplayId = (id) => {
    if (!id) return id;
    const idText = String(id);
    return idText === `T${variantId}` ? `TP${variantId}` : idText;
  };
  const displayId = normalizeDisplayId(variantDisplayId) || `${displayPrefix}${variantId}`;

  // 修正 i18n 函数内部拼接的 "T{id}" 前缀，使界面统一显示为 displayId
  const fixId = (text) => typeof text === 'string' ? text.split(`T${variantId}`).join(displayId) : text;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [structureInfo, setStructureInfo] = useState(null);
  const [uniprotIds, setUniprotIds] = useState({ left: null, right: null });
  const [selectedView, setSelectedView] = useState('left');
  const [copied, setCopied] = useState(false);
  const { t } = useLanguage();
  const P = t.fusionProtein;
  const esmPreviewLabel = P.esmPreviewLabel || ESM_FOLD_LABEL;
  const predictionRunRef = useRef(0);
  
  const [fusionPrediction, setFusionPrediction] = useState({
    status: 'idle',          // 'idle'|'esm_loading'|'success'|'error'
    pdbUrl: null,
    pdbContent: null,        // 当前展示的 PDB（ESMFold 结果）
    esmPdbContent: null,     // ESMFold PDB
    structureSource: null,   // 'esm'
    colabfoldStatus: null,   // 本版本不再启动 ColabFold
    errorCode: '', errorParam: null, cached: false, message: ''
  });

  const canonicalGeneSymbol = (raw) => {
    if (!raw) return '';
    return String(raw).split('^')[0].split('(')[0].split(/[,\s\|\;]/)[0].trim();
  };

  const searchUniProtID = async (rawGeneName) => {
    const geneName = canonicalGeneSymbol(rawGeneName);
    if (!geneName) return null;
    try {
      const response = await fetch(`https://rest.uniprot.org/uniprotkb/search?query=gene:${encodeURIComponent(geneName)}+AND+organism_id:9606&format=json&size=1`);
      if (!response.ok) return null;
      const data = await response.json();
      return data.results?.[0]?.primaryAccession || null;
    } catch (e) {
      return null;
    }
  };

  const startPrediction = useCallback(async () => {
    if (!variantId || !sequence) return;

    const cleanedSeq = cleanSequence(sequence);
    const runId = ++predictionRunRef.current;

    if (!cleanedSeq) {
      setFusionPrediction(prev => ({ ...prev, status: 'error', errorCode: 'noAA', errorParam: null }));
      return;
    }

    // 前端整体保护：极长序列不自动提交，避免浏览器/网络卡住。
    if (cleanedSeq.length > FRONTEND_MAX_AA) {
      setFusionPrediction(prev => ({
        ...prev,
        status: 'error',
        errorCode: 'seqTooLong',
        errorParam: `${cleanedSeq.length} / ${FRONTEND_MAX_AA}`,
        pdbUrl: null,
        pdbContent: null,
        esmPdbContent: null,
        structureSource: null,
        colabfoldStatus: null,
        cached: false,
        message: ''
      }));
      return;
    }

    // 只使用 ESMFold 自动预测。超过 ESMFold 范围时，不再启动本地 ColabFold。
    if (cleanedSeq.length > ESM_FOLD_MAX_AA) {
      setFusionPrediction(prev => ({
        ...prev,
        status: 'error',
        errorCode: 'esmTooLong',
        errorParam: `${cleanedSeq.length} / ${ESM_FOLD_MAX_AA}`,
        pdbUrl: null,
        pdbContent: null,
        esmPdbContent: null,
        structureSource: null,
        colabfoldStatus: null,
        cached: false,
        message: ''
      }));
      return;
    }

    setFusionPrediction(prev => ({
      ...prev,
      status: 'esm_loading',
      pdbUrl: null,
      pdbContent: null,
      esmPdbContent: null,
      structureSource: null,
      colabfoldStatus: null,
      errorCode: '',
      errorParam: null,
      cached: false,
      message: ''
    }));

    const esmResult = await fetchEsmFold(cleanedSeq);
    if (predictionRunRef.current !== runId) return;

    if (esmResult.success) {
      setFusionPrediction({
        status: 'success',
        pdbUrl: null,
        pdbContent: esmResult.pdbContent,
        esmPdbContent: esmResult.pdbContent,
        structureSource: 'esm',
        colabfoldStatus: null,
        errorCode: '',
        errorParam: null,
        cached: false,
        message: ''
      });
      return;
    }

    setFusionPrediction({
      status: 'error',
      pdbUrl: null,
      pdbContent: null,
      esmPdbContent: null,
      structureSource: null,
      colabfoldStatus: null,
      errorCode: 'esmFailed',
      errorParam: esmResult.message || esmResult.reason || null,
      cached: false,
      message: ''
    });
  }, [variantId, sequence]);

  const resetPrediction = () => {
    predictionRunRef.current += 1;
    setFusionPrediction({
      status: 'idle', pdbUrl: null, pdbContent: null, esmPdbContent: null,
      structureSource: null, colabfoldStatus: null,
      errorCode: '', errorParam: null, cached: false, message: ''
    });
  };

  useEffect(() => {
    const init = async () => {
      if (!leftGene && !rightGene) return;
      setLoading(true);
      setError('');
      try {
        const [leftId, rightId] = await Promise.all([searchUniProtID(leftGene), searchUniProtID(rightGene)]);
        setUniprotIds({ left: leftId, right: rightId });
        if (leftId) setSelectedView('left');
        else if (rightId) setSelectedView('right');
        if (leftId || rightId) {
          setStructureInfo({ leftGene, rightGene, leftUniprot: leftId, rightUniprot: rightId, sequenceLength: sequence?.length || 0 });
        } else {
          setError(P.errNoUniProt);
        }
      } catch (err) {
        setError(P.errUniProtQuery(err.message));
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [leftGene, rightGene, sequence]);

  useEffect(() => {
    if (structureInfo && variantId && sequence) {
      resetPrediction();
      startPrediction();
    }
  }, [variantId, structureInfo]);

  // AlphaFold links (iframe removed, using direct links instead)

  const handleDownloadFusionPDB = () => {
    if (fusionPrediction.pdbContent && variantId) {
      const blob = new Blob([fusionPrediction.pdbContent], { type: 'chemical/x-pdb' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${displayId}.pdb`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const copySequenceAndOpen = (targetSite) => {
    const cleanedSeq = cleanSequence(sequence);
    if (!cleanedSeq) { alert(P.alertNoSeq); return; }
    
    navigator.clipboard.writeText(cleanedSeq).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
      
      const urls = {
        zjuaf3: ZJU_AF3_CONFIG.websiteUrl,
        esmfold: 'https://esmatlas.com/resources?action=fold',
        colabfold: 'https://colab.research.google.com/github/sokrypton/ColabFold/blob/main/AlphaFold2.ipynb'
      };
      const messages = {
        zjuaf3: P.alertCopiedZju(cleanedSeq.length),
        esmfold: P.alertCopiedEsm(cleanedSeq.length),
        colabfold: P.alertCopiedColab(cleanedSeq.length)
      };
      window.open(urls[targetSite], '_blank');
      alert(messages[targetSite]);
    }).catch(() => alert(P.alertCopyFailed));
  };

  const openInAlphaFold = (type) => {
    const id = type === 'left' ? uniprotIds.left : uniprotIds.right;
    if (id) window.open(`https://alphafold.ebi.ac.uk/entry/${id}`, '_blank');
  };

  const cleanedSequence = sequence ? cleanSequence(sequence) : '';
  const hasInvalidChars = sequence && cleanedSequence.length !== sequence.length;

  if (!sequence) {
    return (
      <div className="p-10 text-center">
        <AlertTriangle className="mx-auto mb-3 text-amber-500" size={40} />
        <p className="text-slate-600 font-bold mb-2">{P.noSequence}</p>
        <p className="text-sm text-slate-500">{P.noSequenceHint}</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* 标题栏 - 删除了下载按钮 */}
      <div className="flex items-center justify-between mb-4 border-b pb-3">
        <div className="flex items-center gap-2">
          <Activity className="text-purple-600" size={20} />
          <h2 className="text-lg font-bold text-slate-800">{P.sectionTitle}</h2>
        </div>
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader size={40} className="animate-spin text-purple-600 mb-4" />
          <p className="text-slate-600">{P.loadingAlphafold}</p>
        </div>
      )}

      {error && !loading && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 mb-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="text-red-500 mt-1" size={24} />
            <div>
              <p className="font-bold text-red-800 mb-2">{P.loadFailed}</p>
              <p className="text-sm text-red-600">{error}</p>
            </div>
          </div>
        </div>
      )}

      {structureInfo && !loading && (
        <>
          {fusionPrediction.status === 'checking' && (
            <div className="mb-6 bg-blue-50 border-2 border-blue-300 rounded-xl p-5">
              <div className="flex items-center gap-3">
                <Loader size={20} className="animate-spin text-blue-600" />
                <span className="font-medium text-blue-800">{fixId(P.checkingPdb(variantId))}</span>
              </div>
            </div>
          )}

          {/* ESMFold 快速预览加载中 */}
          {fusionPrediction.status === 'esm_loading' && (
            <div className="mb-6 bg-gradient-to-r from-cyan-50 to-sky-50 border-2 border-cyan-300 rounded-xl p-5">
              <div className="flex items-center gap-3">
                <div className="relative w-5 h-5 flex-shrink-0">
                  <div className="absolute inset-0 bg-cyan-400 rounded-full animate-ping opacity-60" />
                  <Loader size={20} className="animate-spin text-cyan-600 relative" />
                </div>
                <div>
                  <span className="font-bold text-cyan-800">{P.esmPreviewLoadingTitle || '⚡ Loading ESMFold quick preview...'}</span>
                  <p className="text-sm text-cyan-600 mt-0.5">{P.esmPreviewLoadingDesc || 'Fetching an ESMFold prediction. Local ColabFold is disabled.'}</p>
                </div>
              </div>
            </div>
          )}

          {/* ========== 预测成功 - 嵌入式3D查看器 ========== */}
          {fusionPrediction.status === 'success' && (
            <div className="mb-6">
              {/* 标题栏 */}
              <div className="bg-gradient-to-r from-green-500 to-emerald-600 rounded-t-xl p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                    <CheckCircle size={24} className="text-white" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-lg flex items-center gap-2">
                      🎉 {displayId} {fixId(P.predictionDone(variantId)).replace(`🎉 ${displayId} `, '').replace(`${displayId} `, '')}
                    </h3>
                    <div className="flex items-center gap-2 mt-1">
                      {fusionPrediction.cached && (
                        <span className="text-xs text-green-100 flex items-center gap-1 bg-white/20 px-2 py-0.5 rounded">
                          <Database size={12} />{P.fromCache}
                        </span>
                      )}
                      {fusionPrediction.structureSource === 'esm' && (
                        <span className="text-xs text-green-100 flex items-center gap-1 bg-white/20 px-2 py-0.5 rounded">
                          <Zap size={12} />{P.esmPredictionLabel || 'ESMFold'}
                        </span>
                      )}
                      <span className="text-xs text-green-100">
                        {P.aaCount(cleanedSequence.length)}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={handleDownloadFusionPDB} className="flex items-center gap-2 px-4 py-2 bg-white text-green-700 rounded-lg font-medium hover:bg-green-50 transition shadow-lg">
                    <Download size={16} />
                    {fixId(P.downloadPdb(variantId))}
                  </button>
                  <button onClick={resetPrediction} className="flex items-center gap-1 px-3 py-2 bg-white/20 hover:bg-white/30 text-white rounded-lg transition">
                    <RefreshCw size={14} />
                    {P.repredict}
                  </button>
                </div>
              </div>

              {/* 3D 查看器 */}
              <div className="border-2 border-t-0 border-green-400 rounded-b-xl overflow-hidden bg-slate-50">
                {fusionPrediction.pdbContent ? (
                  <MolstarViewer 
                    pdbContent={fusionPrediction.pdbContent} 
                    variantId={variantId}
                    displayId={displayId}
                    sourceLabel={fusionPrediction.structureSource === 'esm' ? esmPreviewLabel : undefined}
                  />
                ) : (
                  <div className="h-96 flex items-center justify-center">
                    <div className="text-center">
                      <AlertTriangle size={40} className="text-amber-500 mx-auto mb-3" />
                      <p className="text-slate-600">{P.load3dFailed}</p>
                      <button onClick={startPrediction} className="mt-3 px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition">
                        {P.refetch}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {fusionPrediction.status === 'error' && (
            <div className="mb-6 bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-400 rounded-xl p-5 shadow-md">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <AlertTriangle size={24} className="text-amber-600" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-amber-800 text-lg mb-2">{fixId(P.autoPredictFailed(variantId))}</h3>
                  <p className="text-sm text-amber-700 mb-0">{
                    fusionPrediction.errorCode === 'noAA' ? P.errNoAA
                    : fusionPrediction.errorCode === 'seqTooLong' ? (P.errAutoSeqTooLong ? P.errAutoSeqTooLong(fusionPrediction.errorParam) : `Sequence length ${fusionPrediction.errorParam} aa exceeds the current automatic prediction range.`)
                    : fusionPrediction.errorCode === 'esmTooLong' ? (P.errEsmTooLong ? P.errEsmTooLong(fusionPrediction.errorParam) : `Sequence length ${fusionPrediction.errorParam} aa exceeds the ESMFold automatic prediction range, so automatic prediction is skipped.`)
                    : fusionPrediction.errorCode === 'esmFailed' ? (P.errEsmFailed ? P.errEsmFailed(fusionPrediction.errorParam) : (fusionPrediction.errorParam ? `ESMFold automatic prediction failed: ${fusionPrediction.errorParam}.` : 'ESMFold automatic prediction failed.'))
                    : fusionPrediction.errorCode === 'predictFailed' ? (fusionPrediction.errorParam || P.errPredictFailed)
                    : P.useManualTools
                  }</p>
                  {!(fusionPrediction.errorCode === 'esmTooLong' || fusionPrediction.errorCode === 'seqTooLong') && (
                    <div className="flex flex-wrap gap-3 mt-4">
                      <button onClick={startPrediction} className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium transition">
                        <RefreshCw size={16} />{P.retry}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {fusionPrediction.status === 'idle' && (
            <div className="mb-6 bg-gradient-to-r from-purple-50 to-blue-50 border-2 border-purple-300 rounded-xl p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-blue-600 rounded-full flex items-center justify-center shadow-lg">
                    <Sparkles size={24} className="text-white" />
                  </div>
                  <div>
                    <h3 className="font-bold text-purple-800 text-lg">{P.sectionTitle}</h3>
                    <p className="text-sm text-purple-600">{P.onlinePredictDesc}</p>
                  </div>
                </div>
                <button onClick={startPrediction} disabled={!variantId} className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 disabled:from-slate-400 disabled:to-slate-500 text-white rounded-xl font-bold transition shadow-lg hover:shadow-xl">
                  <Play size={20} />{fixId(P.startPredict(variantId))}
                </button>
              </div>
            </div>
          )}

          {/* 在线预测功能区 */}
          <div className="bg-gradient-to-r from-blue-50 to-purple-50 border-2 border-blue-300 rounded-lg p-5 mb-6">
            <div className="flex items-start gap-3 mb-4">
              <Zap size={24} className="text-blue-600 mt-1" />
              <div className="flex-1">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-blue-800 text-lg">{P.onlinePredictTitle}</h3>
                  {variantId && (
                    <span className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm font-bold flex items-center gap-1">
                      <Database size={14} />{fixId(P.currentVariant(variantId))}
                    </span>
                  )}
                </div>
                <p className="text-sm text-blue-700 mb-3">{P.onlinePredictDesc}</p>
                
                <div className="mb-4 p-3 bg-white rounded-lg border border-slate-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-bold text-slate-700">{P.sequenceLabel}</span>
                      <span className="font-mono text-blue-600 font-bold">{cleanedSequence.length} aa</span>
                      {hasInvalidChars && <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded">{P.filteredChars((sequence?.length || 0) - cleanedSequence.length)}</span>}
                      {cleanedSequence.length > ESM_FOLD_MAX_AA && <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded">{P.esmLimitLabel || `ESMFold > ${ESM_FOLD_MAX_AA} aa`}</span>}
                      {cleanedSequence.length > FRONTEND_MAX_AA && <span className="ml-2 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded">{P.overLimit}</span>}
                    </div>
                    <button onClick={() => { navigator.clipboard.writeText(cleanedSequence); setCopied(true); setTimeout(() => setCopied(false), 2000); }} className="flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded text-slate-700 text-sm transition">
                      {copied ? <CheckCircle size={14} className="text-green-600" /> : <Copy size={14} />}
                      {copied ? P.copied : P.copySequence}
                    </button>
                  </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-white rounded-lg p-4 border-2 border-blue-400 shadow-sm relative">
                    <div className="absolute -top-2 -right-2 bg-blue-600 text-white text-xs px-2 py-0.5 rounded-full font-bold">{P.recommended}</div>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                        <span className="text-white font-bold text-xs">ZJU</span>
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-800 text-sm">{P.zjuAF3Name}</h4>
                        <span className="text-xs text-green-600">{P.zjuAF3Tagline}</span>
                      </div>
                    </div>
                    <p className="text-xs text-slate-600 mb-3">{P.zjuAF3Desc}<br/><span className="text-green-600">{P.zjuAF3Access}</span></p>
                    <button onClick={() => copySequenceAndOpen('zjuaf3')} disabled={!cleanedSequence} className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 disabled:from-slate-300 disabled:to-slate-400 text-white rounded font-bold transition shadow-md">
                      <ExternalLink size={16} />{P.zjuAF3Btn}
                    </button>
                  </div>

                  <div className="bg-white rounded-lg p-4 border border-slate-200">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center"><span className="text-green-600 font-bold text-sm">ES</span></div>
                      <div>
                        <h4 className="font-bold text-slate-800 text-sm">{P.esmfoldName}</h4>
                        <span className="text-xs text-blue-600">{P.esmfoldTagline}</span>
                      </div>
                    </div>
                    <p className="text-xs text-slate-600 mb-3">{P.esmfoldDesc}<br/><span className="text-slate-500">{P.esmfoldAutoLimit || `Auto preview ≤ ${ESM_FOLD_MAX_AA} aa`}</span></p>
                    <button onClick={() => copySequenceAndOpen('esmfold')} disabled={!cleanedSequence} className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-300 text-white rounded font-bold transition">
                      <ExternalLink size={16} />{P.esmfoldBtn}
                    </button>
                  </div>

                  <div className="bg-white rounded-lg p-4 border border-slate-200">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-8 h-8 bg-orange-100 rounded-full flex items-center justify-center"><span className="text-orange-600 font-bold text-sm">CF</span></div>
                      <div>
                        <h4 className="font-bold text-slate-800 text-sm">{P.colabfoldName}</h4>
                        <span className="text-xs text-purple-600">{P.colabfoldTagline}</span>
                      </div>
                    </div>
                    <p className="text-xs text-slate-600 mb-3">{P.colabfoldDesc}</p>
                    <button onClick={() => copySequenceAndOpen('colabfold')} disabled={!cleanedSequence} className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-300 text-white rounded font-bold transition">
                      <ExternalLink size={16} />{P.colabfoldBtn}
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* Left: Usage Tips */}
                  <div className="p-3 bg-slate-100 rounded-lg text-xs text-slate-600">
                    <p className="font-bold mb-1">{P.usageTips}</p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>{P.tip1}</li>
                      <li>{P.tip2}</li>
                      <li>{P.tip3}</li>
                    </ul>
                  </div>
                  {/* Right: Fusion Protein Amino Acid Sequence (compact) */}
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <div className="flex items-center justify-between mb-1.5">
                      <h4 className="font-bold text-slate-700 text-xs flex items-center gap-1">
                        <span>{P.seqSectionTitle}</span>
                        <span className="text-[10px] font-normal text-slate-400">{P.seqOriginalValid(sequence?.length || 0, cleanedSequence.length)}</span>
                        {hasInvalidChars && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">{P.hasInvalidChars}</span>}
                      </h4>
                      <div className="flex gap-1">
                        <button onClick={() => { navigator.clipboard.writeText(cleanedSequence); alert(P.copiedAlert); }} className="text-[10px] px-2 py-0.5 bg-green-100 hover:bg-green-200 rounded text-green-700 transition">{P.copyValidSeq}</button>
                        <button onClick={() => { navigator.clipboard.writeText(sequence || ''); alert(P.copiedAlert); }} className="text-[10px] px-2 py-0.5 bg-blue-100 hover:bg-blue-200 rounded text-blue-700 transition">{P.copyRawSeq}</button>
                      </div>
                    </div>
                    <div className="font-mono text-[10px] bg-white p-2 rounded border border-slate-300 overflow-x-auto max-h-24 overflow-y-auto">
                      {cleanedSequence && cleanedSequence.length > 0 ? (
                        cleanedSequence.match(/.{1,60}/g)?.map((chunk, i) => (
                          <div key={i} className="leading-tight">
                            <span className="text-slate-400 mr-1">{(i * 60).toString().padStart(5, ' ')}:</span>
                            <span className="text-slate-800">{chunk}</span>
                          </div>
                        ))
                      ) : <div className="text-slate-400 text-center py-2">{P.noValidSeq}</div>}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default FusionProteinPredictor;
