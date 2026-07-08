// src/pages/ClinicalAnalysis.jsx
// 临床数据分析页面 - KM生存曲线 + Cox回归分析
import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, Activity, AlertCircle, Info, Download, 
  TrendingUp, TrendingDown, Users, Clock, BarChart3,
  ChevronDown, ChevronUp, RefreshCw
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, 
  Legend, ResponsiveContainer, ReferenceLine, Area
} from 'recharts';
import { useLanguage } from '../contexts/LanguageContext';

// ==================== 辅助函数 ====================
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
      if (token) {
        localStorage.setItem('token', token);
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
    localStorage.removeItem('token');
    return fetchWithAuth(url, options, retries - 1);
  }
  
  return response;
}

// ==================== 格式化函数 ====================
const formatPValue = (p) => {
  if (p === null || p === undefined) return 'N/A';
  if (p < 0.001) return '< 0.001';
  if (p < 0.01) return p.toFixed(3);
  return p.toFixed(3);
};

const formatHR = (hr, ciLower, ciUpper) => {
  if (hr === null || hr === undefined) return 'N/A';
  return `${hr.toFixed(2)} (${ciLower?.toFixed(2) || '?'} - ${ciUpper?.toFixed(2) || '?'})`;
};

// ==================== 自定义Tooltip ====================
const KMTooltip = ({ active, payload }) => {
  const { t } = useLanguage();
  const C = t.clinical;
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-white p-3 shadow-lg rounded-lg border border-slate-200 text-sm">
        <div className="font-bold text-slate-700 mb-2">{C.tooltipTime} {data.time?.toFixed(2)} {C.tooltipTimeUnit}</div>
        {payload.map((entry, index) => (
          <div key={index} className="flex items-center gap-2" style={{ color: entry.color }}>
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: entry.color }}></div>
            <span>{entry.name}: {(entry.value * 100).toFixed(1)}%</span>
          </div>
        ))}
        {data.at_risk_pos !== undefined && (
          <div className="mt-2 pt-2 border-t border-slate-100 text-xs text-slate-500">
            {C.tooltipAtRisk(data.at_risk_pos, data.at_risk_neg)}
          </div>
        )}
      </div>
    );
  }
  return null;
};

// ==================== KM曲线组件 ====================
const KaplanMeierChart = ({ data, title, pValue, showFiveYear = true }) => {
  const { t } = useLanguage();
  const C = t.clinical;
  const chartData = useMemo(() => {
    if (!data?.positive_curve || !data?.negative_curve) return [];
    
    const allTimes = new Set();
    data.positive_curve.forEach(d => allTimes.add(d.time));
    data.negative_curve.forEach(d => allTimes.add(d.time));
    
    const sortedTimes = Array.from(allTimes).sort((a, b) => a - b);
    
    let lastPos = 1, lastNeg = 1;
    let lastPosRisk = data.positive_curve[0]?.at_risk || 0;
    let lastNegRisk = data.negative_curve[0]?.at_risk || 0;
    
    return sortedTimes.map(time => {
      const posPoint = data.positive_curve.find(d => d.time === time);
      const negPoint = data.negative_curve.find(d => d.time === time);
      
      if (posPoint) {
        lastPos = posPoint.survival;
        lastPosRisk = posPoint.at_risk;
      }
      if (negPoint) {
        lastNeg = negPoint.survival;
        lastNegRisk = negPoint.at_risk;
      }
      
      return {
        time,
        positive: lastPos,
        negative: lastNeg,
        at_risk_pos: lastPosRisk,
        at_risk_neg: lastNegRisk
      };
    });
  }, [data]);

  if (!data || chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-80 bg-slate-50 rounded-lg">
        <div className="text-center text-slate-400">
          <BarChart3 size={48} className="mx-auto mb-2 opacity-50" />
          <p>{C.noKmData}</p>
        </div>
      </div>
    );
  }

  const isSignificant = pValue !== null && pValue < 0.05;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-slate-800">{title}</h3>
        <div className={`mr-4 shrink-0 whitespace-nowrap px-3 py-1 rounded-full text-sm font-bold ${
          isSignificant 
            ? 'bg-green-100 text-green-700' 
            : 'bg-slate-100 text-slate-600'
        }`}>
          p = {formatPValue(pValue)}
        </div>
      </div>
      
      <ResponsiveContainer width="100%" height={350}>
        <LineChart data={chartData} margin={{ top: 20, right: 30, left: 40, bottom: 60 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis 
            dataKey="time" 
            label={{ value: C.followupTime, position: 'bottom', offset: 40 }}
            tickFormatter={(v) => v.toFixed(1)}
            stroke="#64748b"
          />
          <YAxis 
            domain={[0, 1]}
            tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
            label={{
              value: C.survivalProb,
              angle: -90,
              position: 'insideLeft',
              offset: -20,
              dy: 34,
              style: { textAnchor: 'middle' }
            }}
            stroke="#64748b"
          />
          <Tooltip content={<KMTooltip />} />
          <Legend 
            verticalAlign="top" 
            height={36}
            formatter={(value) => (
              <span className="text-sm font-medium">
                {value === 'positive' ? C.fusionPositiveLabel : C.fusionNegativeLabel}
              </span>
            )}
          />
          <ReferenceLine y={0.5} stroke="#94a3b8" strokeDasharray="5 5" />
          
          {/* 融合阳性组 - 红色 */}
          <Line 
            type="stepAfter"
            dataKey="positive" 
            name="positive"
            stroke="#ef4444" 
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 6, fill: '#ef4444' }}
          />
          
          {/* 融合阴性组 - 蓝色 */}
          <Line 
            type="stepAfter"
            dataKey="negative" 
            name="negative"
            stroke="#3b82f6" 
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 6, fill: '#3b82f6' }}
          />
        </LineChart>
      </ResponsiveContainer>
      
      {/* 风险表 */}
      {data?.summary && (
        <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div className="bg-red-50 rounded-lg p-3 border border-red-200">
            <div className="font-bold text-red-700 mb-1">{C.positiveGroup}</div>
            <div className="text-red-600 space-y-1">
              <div>{C.sampleN} {data.summary.positive?.n || 'N/A'}</div>
              <div>{C.events} {data.summary.positive?.events || 'N/A'}</div>
              <div>{C.medianSurvival} {data.summary.positive?.median_survival?.toFixed(2) || C.medianNotReached} {C.survivalYears}</div>
              {showFiveYear && (
                <div>{C.survival5y} {data.summary.positive?.survival_5y?.toFixed(1) || 'N/A'}%</div>
              )}
            </div>
          </div>
          <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
            <div className="font-bold text-blue-700 mb-1">{C.negativeGroup}</div>
            <div className="text-blue-600 space-y-1">
              <div>{C.sampleN} {data.summary.negative?.n || 'N/A'}</div>
              <div>{C.events} {data.summary.negative?.events || 'N/A'}</div>
              <div>{C.medianSurvival} {data.summary.negative?.median_survival?.toFixed(2) || C.medianNotReached} {C.survivalYears}</div>
              {showFiveYear && (
                <div>{C.survival5y} {data.summary.negative?.survival_5y?.toFixed(1) || 'N/A'}%</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ==================== 森林图组件（多融合比较） ====================
const ForestPlotRow = ({ item, scale, isCurrent }) => {
  const { t } = useLanguage();
  const C = t.clinical;
  if (!item || item.hr === null) return null;
  const { hr, ci_lower, ci_upper, p_value, name, n, warning } = item;
  const hasWarning = !!warning;
  const logHR = Math.log(Math.max(0.01, Math.min(100, hr)));
  const logCIL = Math.log(Math.max(0.01, ci_lower));
  const logCIU = Math.log(Math.min(100, ci_upper));

  const toPercent = (logVal) => 50 + (logVal / scale) * 40;
  const hrPos = toPercent(logHR);
  const ciLPos = Math.max(2, toPercent(logCIL));
  const ciUPos = Math.min(98, toPercent(logCIU));
  const isSignificant = p_value !== null && p_value < 0.05;
  const isProtective = hr < 1;

  const dotColor = hasWarning
    ? 'bg-amber-400 ring-2 ring-amber-200'
    : isCurrent
      ? 'bg-purple-600 ring-2 ring-purple-300'
      : isProtective ? 'bg-green-500' : 'bg-red-500';

  const lineColor = hasWarning ? 'bg-amber-300' : isCurrent ? 'bg-purple-400' : 'bg-slate-400';

  const rowBg = hasWarning
    ? 'bg-amber-50 border border-dashed border-amber-300 rounded-lg -mx-2 px-2 py-1'
    : isCurrent ? 'bg-purple-50 rounded-lg -mx-2 px-2 py-1' : 'py-1';

  return (
    <div>
      <div className={`flex items-center gap-0 text-sm ${rowBg} ${hasWarning ? 'opacity-75' : ''}`}>
        {/* 左侧标签 */}
        <div className="w-44 flex-shrink-0 truncate pr-2">
          {hasWarning && <AlertCircle size={12} className="inline text-amber-500 mr-1" />}
          <span className={`font-medium ${hasWarning ? 'text-amber-700' : isCurrent ? 'text-purple-700' : 'text-slate-700'}`}>
            {name}
          </span>
          {n !== undefined && <span className="text-xs text-slate-400 ml-1">(n={n})</span>}
        </div>
        {/* 图形区域 */}
        <div className="flex-1 relative h-6">
          {/* HR=1 参考线 */}
          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-300 z-0"></div>
          {/* CI 线 */}
          <div
            className={`absolute top-1/2 h-0.5 ${lineColor} z-10`}
            style={{
              left: `${ciLPos}%`,
              width: `${Math.max(0, ciUPos - ciLPos)}%`,
              transform: 'translateY(-50%)'
            }}
          ></div>
          {/* HR 点 */}
          <div
            className={`absolute top-1/2 z-20 rounded-full transform -translate-x-1/2 -translate-y-1/2 ${dotColor} ${isCurrent || hasWarning ? 'w-3.5 h-3.5' : 'w-2.5 h-2.5'}`}
            style={{ left: `${Math.max(2, Math.min(98, hrPos))}%` }}
          ></div>
        </div>
        {/* 右侧数值 */}
        <div className="w-64 flex-shrink-0 flex items-center gap-3 pl-2 text-xs">
          <span className={`font-bold ${hasWarning ? 'text-amber-600' : isProtective ? 'text-green-600' : 'text-red-600'}`}>
            {hr.toFixed(2)}
          </span>
          <span className="text-slate-500">
            ({ci_lower.toFixed(2)}-{ci_upper.toFixed(2)})
          </span>
          <span className={`px-1.5 py-0.5 rounded ${hasWarning ? 'bg-amber-100 text-amber-600' : isSignificant ? 'bg-green-100 text-green-700 font-bold' : 'bg-slate-100 text-slate-500'}`}>
            {hasWarning ? '⚠' : formatPValue(p_value)}
          </span>
        </div>
      </div>
      {/* 警告提示 */}
      {hasWarning && (
        <div className="flex items-start gap-1.5 ml-2 mt-1 mb-1 text-xs text-amber-600 bg-amber-50 rounded px-2 py-1.5">
          <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
          <span>{C.forestWarningText}</span>
        </div>
      )}
    </div>
  );
};

const ForestPlot = ({ fusionName, forestData, loading: forestLoading }) => {
  const { t } = useLanguage();
  const C = t.clinical;

  if (forestLoading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h3 className="text-lg font-bold text-slate-800 mb-4">{C.forestTitle}</h3>
        <div className="flex items-center justify-center h-40 text-slate-400">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-green-600 mr-3"></div>
          {C.forestLoadingRef}
        </div>
      </div>
    );
  }

  if (!forestData) return null;

  const { current, oncogenic_references = [], favorable_references = [] } = forestData;

  // 没有任何数据
  if (!current && oncogenic_references.length === 0 && favorable_references.length === 0) return null;

  const scale = 2.5; // log scale range

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-bold text-slate-800">{C.forestTitle}</h3>
          <p className="mt-1 text-xs text-slate-500">{C.hrExplain}</p>
        </div>
        <div className="flex items-center gap-6 text-xs text-slate-500">
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 bg-purple-600 rounded-full"></div>
            <span>{C.forestCurrentFusion}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 bg-red-500 rounded-full"></div>
            <span>{C.forestOncogenicRef}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 bg-green-500 rounded-full"></div>
            <span>{C.forestFavorableRef}</span>
          </div>
        </div>
      </div>

      {/* 表头 */}
      <div className="flex items-center gap-0 text-xs text-slate-500 font-bold border-b border-slate-200 pb-2 mb-2">
        <div className="w-44 flex-shrink-0">Fusion</div>
        <div className="flex-1 flex justify-between px-1">
          <span>0.25</span><span>0.5</span>
          <span className="text-slate-700">1.0</span>
          <span>2.0</span><span>4.0</span>
        </div>
        <div className="w-64 flex-shrink-0 flex gap-3 pl-2">
          <span>HR</span><span>95% CI</span><span>P value</span>
        </div>
      </div>

      {/* 当前融合 */}
      {current && (
        <>
          <ForestPlotRow item={current} scale={scale} isCurrent={true} />
          {(oncogenic_references.length > 0 || favorable_references.length > 0) && (
            <div className="border-t border-dashed border-slate-200 my-2"></div>
          )}
        </>
      )}

      {/* 致癌参考融合 */}
      {oncogenic_references.length > 0 && (
        <>
          <div className="text-xs text-red-500 font-bold mt-1 mb-1 flex items-center gap-1">
            <TrendingUp size={12} /> {C.forestOncogenicLabel}
          </div>
          {oncogenic_references.map((item, idx) => (
            <ForestPlotRow key={`onc-${idx}`} item={item} scale={scale} isCurrent={false} />
          ))}
        </>
      )}

      {/* 抑癌参考融合 */}
      {favorable_references.length > 0 && (
        <>
          <div className="text-xs text-green-600 font-bold mt-2 mb-1 flex items-center gap-1">
            <TrendingDown size={12} /> {C.forestFavorableLabel}
          </div>
          {favorable_references.map((item, idx) => (
            <ForestPlotRow key={`fav-${idx}`} item={item} scale={scale} isCurrent={false} />
          ))}
        </>
      )}

      {/* 底部说明 */}
      <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-center gap-8 text-xs text-slate-400">
        <span>← HR &lt; 1 {C.favorablePrognosis}</span>
        <span className="font-bold text-slate-500">HR = 1</span>
        <span>HR &gt; 1 {C.unfavorablePrognosis} →</span>
      </div>
    </div>
  );
};

// ==================== 临床摘要组件 ====================
const ClinicalSummary = ({ data }) => {
  const [expanded, setExpanded] = useState(true);
  const { t } = useLanguage();
  const C = t.clinical;
  if (!data) return null;

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 flex items-center justify-between bg-gradient-to-r from-green-50 to-teal-50 hover:from-green-100 hover:to-teal-100 transition"
      >
        <div className="flex items-center gap-2">
          <Users size={20} className="text-green-600" />
          <h3 className="text-lg font-bold text-slate-800">{C.clinicalSummaryTitle}</h3>
          <span className="text-sm text-slate-500">{C.patientsCount(data.sample_count)}</span>
        </div>
        {expanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
      </button>
      
      {expanded && (
        <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* 人口学特征 */}
          {data.demographics && (
            <div className="bg-slate-50 rounded-lg p-4">
              <h4 className="font-bold text-slate-700 mb-3">{C.demographicsTitle}</h4>
              
              {data.demographics.gender && (
                <div className="mb-3">
                  <div className="text-xs text-slate-500 mb-1">{C.genderDist}</div>
                  <div className="flex gap-2">
                    {Object.entries(data.demographics.gender).map(([key, val]) => (
                      <span key={key} className="px-2 py-1 bg-white rounded text-sm">
                        {key}: {val}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              
              {data.demographics.age_years && (
                <div className="mb-3">
                  <div className="text-xs text-slate-500 mb-1">{C.diagnosisAge}</div>
                  <div className="text-sm">
                    {C.median} {data.demographics.age_years.median?.toFixed(1) || 'N/A'} 
                    ({data.demographics.age_years.min?.toFixed(1)} - {data.demographics.age_years.max?.toFixed(1)})
                  </div>
                </div>
              )}
              
              {data.demographics.fab_category && (
                <div>
                  <div className="text-xs text-slate-500 mb-1">{C.fabClassification}</div>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(data.demographics.fab_category).slice(0, 5).map(([key, val]) => (
                      <span key={key} className="px-2 py-0.5 bg-white rounded text-xs">
                        {key}: {val}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          
          {/* 风险分层 */}
          {data.risk_stratification?.risk_group && (
            <div className="bg-slate-50 rounded-lg p-4">
              <h4 className="font-bold text-slate-700 mb-3">{C.riskStratTitle}</h4>
              <div className="space-y-2">
                {Object.entries(data.risk_stratification.risk_group).map(([key, val]) => {
                  const colors = {
                    'Low': 'bg-green-100 text-green-700',
                    'Standard': 'bg-yellow-100 text-yellow-700',
                    'High': 'bg-red-100 text-red-700'
                  };
                  return (
                    <div key={key} className="flex items-center justify-between">
                      <span className={`px-2 py-1 rounded text-sm ${colors[key] || 'bg-slate-100'}`}>
                        {key}
                      </span>
                      <span className="font-bold">{val}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          
          {/* 预后结局 */}
          {data.outcomes && (
            <div className="bg-slate-50 rounded-lg p-4">
              <h4 className="font-bold text-slate-700 mb-3">{C.outcomesTitle}</h4>
              
              {data.outcomes.vital_status && (
                <div className="mb-3">
                  <div className="text-xs text-slate-500 mb-1">{C.survivalStatus}</div>
                  <div className="flex gap-2">
                    {Object.entries(data.outcomes.vital_status).map(([key, val]) => (
                      <span 
                        key={key} 
                        className={`px-2 py-1 rounded text-sm ${
                          key === 'Alive' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {key}: {val}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              
              {data.outcomes.overall_survival_years && (
                <div>
                  <div className="text-xs text-slate-500 mb-1">{C.overallSurvivalTime}</div>
                  <div className="text-sm">
                    {C.medianYears(data.outcomes.overall_survival_years.median?.toFixed(2) || 'N/A')}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ==================== 主组件 ====================
const ClinicalAnalysis = () => {
  const { fusionName } = useParams();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const C = t.clinical;
  
  // 状态 — 同时加载 OS 和 EFS
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [osData, setOsData] = useState(null);
  const [efsData, setEfsData] = useState(null);
  const [summaryData, setSummaryData] = useState(null);
  const [availability, setAvailability] = useState(null);
  const [forestData, setForestData] = useState(null);
  const [forestLoading, setForestLoading] = useState(false);

  // 加载可用性检查
  useEffect(() => {
    const checkAvailability = async () => {
      try {
        const res = await fetchWithAuth(
          `/api/clinical/availability/${encodeURIComponent(fusionName)}`
        );
        const json = await res.json();
        if (json.code === 200) {
          setAvailability(json.data);
        }
      } catch (err) {
        console.error('[Clinical] 可用性检查失败:', err);
      }
    };
    checkAvailability();
  }, [fusionName]);

  // 加载生存分析数据（OS + EFS 同时加载）
  useEffect(() => {
    const loadSurvivalData = async () => {
      try {
        setLoading(true);
        setError('');
        
        console.log(`[Clinical] 加载生存分析: ${fusionName}, OS + EFS`);
        
        const [osRes, efsRes] = await Promise.all([
          fetchWithAuth(`/api/clinical/survival/${encodeURIComponent(fusionName)}?type=os`),
          fetchWithAuth(`/api/clinical/survival/${encodeURIComponent(fusionName)}?type=efs`),
        ]);
        
        if (osRes.ok) {
          const osJson = await osRes.json();
          if (osJson.code === 200 && osJson.data) {
            setOsData(osJson.data);
          }
        }
        
        if (efsRes.ok) {
          const efsJson = await efsRes.json();
          if (efsJson.code === 200 && efsJson.data) {
            setEfsData(efsJson.data);
          }
        }
        
        if (!osRes.ok && !efsRes.ok) {
          throw new Error(C.loadBothFailed || 'OS and EFS data both failed to load');
        }
      } catch (err) {
        console.error('[Clinical] 生存分析加载失败:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    
    loadSurvivalData();
  }, [fusionName]);

  // 加载森林图比较数据（参考融合）— 带 fallback
  useEffect(() => {
    const loadForest = async () => {
      try {
        setForestLoading(true);
        const res = await fetchWithAuth(
          `/api/clinical/forest-compare/${encodeURIComponent(fusionName)}?type=os`
        );
        if (res.ok) {
          const json = await res.json();
          if (json.code === 200 && json.data) {
            setForestData(json.data);
            return;
          }
        }
        // API 不可用（404等），使用 cox_analysis fallback
        console.warn('[Clinical] forest-compare 接口不可用，使用 cox_analysis fallback');
        buildForestFallback();
      } catch (err) {
        console.error('[Clinical] 森林图比较数据加载失败:', err);
        buildForestFallback();
      } finally {
        setForestLoading(false);
      }
    };

    const buildForestFallback = () => {
      const coxData = osData?.cox_analysis;
      if (!coxData?.coefficients) return;
      const fusionCoef = coxData.coefficients.find(c => c.variable === 'fusion_status');
      if (fusionCoef) {
        const { hr, ci_lower, ci_upper } = fusionCoef;
        // 检测不可靠 HR（与后端逻辑一致）
        let warning = null;
        if (hr > 10 || hr < 0.1) {
          warning = 'quasi-separation';
        } else if (ci_upper / Math.max(ci_lower, 0.001) > 50) {
          warning = 'wide-ci';
        }
        setForestData({
          fusion_name: fusionName,
          current: {
            name: fusionName,
            hr: fusionCoef.hr,
            ci_lower: fusionCoef.ci_lower,
            ci_upper: fusionCoef.ci_upper,
            p_value: fusionCoef.p_value,
            n: osData?.sample_info?.positive_samples,
            category: 'current',
            warning,
          },
          oncogenic_references: [],
          favorable_references: [],
        });
      }
    };

    // 只在 osData 加载完成后才尝试（确保 fallback 可用）
    if (!loading) {
      loadForest();
    }
  }, [fusionName, loading, osData]);

  // 加载临床摘要
  useEffect(() => {
    const loadSummary = async () => {
      try {
        const res = await fetchWithAuth(
          `/api/clinical/summary/${encodeURIComponent(fusionName)}`
        );
        const json = await res.json();
        if (json.code === 200) {
          setSummaryData(json.data);
        }
      } catch (err) {
        console.error('[Clinical] 临床摘要加载失败:', err);
      }
    };
    loadSummary();
  }, [fusionName]);

  // 导出报告
  const handleExportReport = () => {
    const report = {
      fusion_name: fusionName,
      analysis_date: new Date().toISOString(),
      os_analysis: osData ? {
        km_analysis: osData.km_analysis,
        sample_info: osData.sample_info
      } : null,
      efs_analysis: efsData ? {
        km_analysis: efsData.km_analysis,
        sample_info: efsData.sample_info
      } : null,
      forest_comparison: forestData,
      clinical_summary: summaryData
    };
    
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clinical_analysis_${fusionName}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 加载中状态
  if (loading && !osData && !efsData) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mb-4"></div>
        <p className="text-green-600">{C.loading}</p>
        <p className="text-xs text-slate-400 mt-2">{C.loadingFusionLabel} {fusionName}</p>
      </div>
    );
  }

  // 不可用状态
  if (availability && !availability.available) {
    return (
      <div className="min-h-screen p-10 bg-slate-50">
        <div className="max-w-2xl mx-auto">
          <div className="bg-white rounded-xl shadow-sm border-2 border-amber-200 p-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="text-amber-500 mt-1" size={24} />
              <div className="flex-1">
                <h2 className="text-xl font-bold text-amber-700 mb-2">{C.unavailableTitle}</h2>
                <p className="text-amber-600 mb-4">{availability.reason}</p>
                
                <div className="bg-amber-50 rounded-lg p-4 mb-4 text-sm">
                  <div className="space-y-1">
                    <div>{C.unavailableFusion} {fusionName}</div>
                    <div>{C.unavailablePositive} {availability.positive_samples || 0}</div>
                    <div>{C.unavailableNegative} {availability.negative_samples || 0}</div>
                    <div>{C.unavailableLifelines(availability.lifelines_available)}</div>
                  </div>
                </div>
                
                <button 
                  onClick={() => navigate(-1)} 
                  className="px-4 py-2 bg-amber-100 hover:bg-amber-200 rounded text-amber-700 transition"
                >
                  {C.backToDetail}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 用于头部展示的数据（优先用 OS）
  const headerData = osData || efsData;

  return (
    <div className="min-h-screen bg-slate-50 py-6 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* 顶部导航栏 — 无 tab 切换 */}
        <div className="flex items-center justify-between">
          <button 
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-slate-600 hover:text-green-600 px-4 py-2 rounded-lg hover:bg-white transition"
          >
            <ArrowLeft size={18} /> {C.backToFusionDetail}
          </button>
          <button
            onClick={handleExportReport}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition"
          >
            <Download size={16} />
            {C.exportReport}
          </button>
        </div>

        {/* 标题区域 */}
        <div className="bg-gradient-to-r from-green-600 to-teal-600 rounded-xl p-6 text-white">
          <div className="flex items-center gap-3 mb-2">
            <Activity size={28} />
            <h1 className="text-2xl font-bold">{C.pageTitle}</h1>
          </div>
          <p className="text-green-100 text-lg">{fusionName}</p>
          <div className="mt-4 flex flex-wrap gap-4 text-sm">
            <div className="flex items-center gap-2 bg-white/20 rounded-lg px-3 py-1">
              <Users size={16} />
              <span>{C.totalSamples} {headerData?.sample_info?.total_samples || 'N/A'}</span>
            </div>
            <div className="flex items-center gap-2 bg-white/20 rounded-lg px-3 py-1">
              <TrendingUp size={16} />
              <span>{C.fusionPositive} {headerData?.sample_info?.positive_samples || 'N/A'}</span>
            </div>
            <div className="flex items-center gap-2 bg-white/20 rounded-lg px-3 py-1">
              <Clock size={16} />
              <span>{C.totalEvents} {headerData?.sample_info?.total_events || 'N/A'}</span>
            </div>
          </div>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-center gap-2 text-red-700">
              <AlertCircle size={20} />
              <span>{error}</span>
              <button 
                onClick={() => window.location.reload()}
                className="ml-auto flex items-center gap-1 text-sm bg-red-100 hover:bg-red-200 px-3 py-1 rounded"
              >
                <RefreshCw size={14} />
                {C.retrying}
              </button>
            </div>
          </div>
        )}

        {/* 临床摘要 */}
        <ClinicalSummary data={summaryData} />

        {/* 加载中覆盖 */}
        {loading && (
          <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 flex items-center gap-4">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
              <span className="text-slate-600">{C.switchingType}</span>
            </div>
          </div>
        )}

        {/* KM 生存曲线 — OS 与 EFS 并排 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Overall Survival */}
          {osData?.km_analysis && !osData.km_analysis.error ? (
            <KaplanMeierChart 
              data={osData.km_analysis}
              title={C.kmTitle('Overall Survival')}
              pValue={osData.km_analysis.logrank_test?.p_value}
            />
          ) : (
            <div className="flex items-center justify-center h-80 bg-white rounded-xl border border-slate-200">
              <div className="text-center text-slate-400">
                <BarChart3 size={36} className="mx-auto mb-2 opacity-50" />
                <p>{C.osUnavailable}</p>
              </div>
            </div>
          )}

          {/* Event-free Survival */}
          {efsData?.km_analysis && !efsData.km_analysis.error ? (
            <KaplanMeierChart 
              data={efsData.km_analysis}
              title={C.kmTitle('Free Survival')}
              pValue={efsData.km_analysis.logrank_test?.p_value}
              showFiveYear={false}
            />
          ) : (
            <div className="flex items-center justify-center h-80 bg-white rounded-xl border border-slate-200">
              <div className="text-center text-slate-400">
                <BarChart3 size={36} className="mx-auto mb-2 opacity-50" />
                <p>{C.efsUnavailable}</p>
              </div>
            </div>
          )}
        </div>

        {/* 森林图（含参考融合） */}
        <ForestPlot 
          fusionName={fusionName}
          forestData={forestData}
          loading={forestLoading}
        />

        {/* 分析说明 */}
        <div className="bg-slate-100 rounded-xl p-6 text-sm text-slate-600">
          <h4 className="font-bold text-slate-700 mb-3">{C.analysisNotesTitle}</h4>
          <div className="space-y-2">
            <p><strong>Kaplan-Meier:</strong> {C.kmNote}</p>
            <p><strong>HR:</strong> {C.forestNote}</p>
          </div>
        </div>

      </div>
    </div>
  );
};

export default ClinicalAnalysis;
