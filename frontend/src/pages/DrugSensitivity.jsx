// src/pages/DrugSensitivity.jsx
// 融合基因 GDSC 细胞系药物敏感性分析页面（纯 GDSC，无 DGIdb）

import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, FlaskConical, Info } from 'lucide-react';
import GDSCAnalysis from '../components/GDSCAnalysis';
import { useLanguage } from '../contexts/LanguageContext';

// ════════════════════════════════════════════════════════════════════════
// 主组件
// ════════════════════════════════════════════════════════════════════════
const DrugSensitivity = () => {
  const { fusionName } = useParams();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const ds = t.drugSensitivity;

  // 从融合名称中解析出左右基因（格式: GENE1--GENE2）
  const parts = (fusionName || '').split('--');
  const leftGene = (parts[0] || '').trim();
  const rightGene = (parts[1] || '').trim();

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ── 顶部栏 ────────────────────────────────────────── */}
      <div className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-100 rounded-lg">
                <FlaskConical size={20} className="text-emerald-600" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-800">{ds.pageTitle}</h1>
                <p className="text-xs text-slate-500">
                  {ds.dataSourceLabel}<a href="https://www.cancerrxgene.org/" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">GDSC</a>
                  {' '}{ds.dataSourceGDSC}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="px-3 py-1 bg-slate-100 rounded-lg font-mono font-bold text-slate-700 text-lg">{fusionName}</span>
              <button onClick={() => navigate(`/fusion/${encodeURIComponent(fusionName)}`)}
                className="flex items-center gap-1.5 text-slate-600 hover:text-blue-600 px-3 py-1.5 rounded-lg hover:bg-slate-50 transition">
                <ArrowLeft size={16} /> {ds.backToDetail}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">

        {/* ── GDSC 分析主体 ───────────────────────────────── */}
        {leftGene && rightGene ? (
          <GDSCAnalysis leftGene={leftGene} rightGene={rightGene} fusionName={fusionName} />
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
            <FlaskConical size={40} className="mx-auto text-slate-300 mb-3" />
            <p className="text-slate-500 font-medium">{ds.cannotParseGene}</p>
            <p className="text-xs text-slate-400 mt-1">{ds.expectedFormat}</p>
          </div>
        )}

        {/* ── 免责声明 ────────────────────────────────────── */}
        <div className="bg-amber-50 rounded-xl border border-amber-200 p-4">
          <div className="flex items-start gap-3">
            <Info size={18} className="text-amber-500 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-amber-700 leading-relaxed">
              <p className="font-semibold mb-1">{ds.disclaimer}</p>
              <p>{ds.disclaimerText}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 text-sm text-slate-600">
          <span>{ds.githubLabel}</span>{' '}
          <a href="https://github.com/bingshaowei/GeneDrugVisualizer" target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-600 hover:underline">
            bingshaowei/GeneDrugVisualizer
          </a>
        </div>

      </div>
    </div>
  );
};

export default DrugSensitivity;