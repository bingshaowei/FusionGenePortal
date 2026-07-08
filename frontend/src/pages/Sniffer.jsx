// src/pages/Sniffer.jsx
// SNIFFER 融合基因检测页面 - 全新双面板设计
// 左侧: SNIFFER 分析（需登录，支持TSV/FASTQ两种模式）
// 右侧: FQ 柱状图可视化

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';

// ==================== 常量配置 ====================
const API_BASE = '/api/sniffer';

// 融合基因示例数据（用于动画）
const SAMPLE_FUSION_GENES = [
  'BCR--ABL1', 'EML4--ALK', 'TMPRSS2--ERG', 'PML--RARA',
  'ETV6--RUNX1', 'EWSR1--FLI1', 'PAX3--FOXO1', 'SS18--SSX1',
  'NPM1--ALK', 'FGFR3--TACC3', 'KMT2A--AFF1', 'TCF3--PBX1',
  'RUNX1--RUNX1T1', 'MYH11--CBFB', 'NUP98--NSD1', 'FUS--DDIT3'
];

// ==================== 工具函数 ====================
const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// ==================== 登录遮罩组件 ====================
const LoginOverlay = ({ onLoginClick }) => {
  const canvasRef = useRef(null);
  const { t } = useLanguage();
  const S = t.sniffer;
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const width = canvas.width = canvas.offsetWidth;
    const height = canvas.height = canvas.offsetHeight;
    
    let time = 0;
    let animationId;
    
    const animate = () => {
      time += 0.01;
      ctx.clearRect(0, 0, width, height);
      
      // 绘制斜线网格背景
      ctx.strokeStyle = 'rgba(100, 116, 139, 0.15)';
      ctx.lineWidth = 1;
      
      const spacing = 30;
      for (let i = -height; i < width + height; i += spacing) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + height, height);
        ctx.stroke();
      }
      
      // 添加动态扫描线
      const scanY = (time * 100) % height;
      const gradient = ctx.createLinearGradient(0, scanY - 50, 0, scanY + 50);
      gradient.addColorStop(0, 'transparent');
      gradient.addColorStop(0.5, 'rgba(16, 185, 129, 0.1)');
      gradient.addColorStop(1, 'transparent');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, scanY - 50, width, 100);
      
      animationId = requestAnimationFrame(animate);
    };
    
    animate();
    return () => cancelAnimationFrame(animationId);
  }, []);
  
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center overflow-hidden rounded-3xl">
      {/* 背景动画画布 */}
      <canvas 
        ref={canvasRef} 
        className="absolute inset-0 w-full h-full"
        style={{ background: 'rgba(15, 23, 42, 0.95)' }}
      />
      
      {/* 锁定图标和提示 */}
      <div className="relative z-10 text-center p-8">
        <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-white/20 border-2 border-white/40 flex items-center justify-center">
          <svg className="w-12 h-12 text-white/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} 
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        
        <h3 className="text-2xl font-bold text-white mb-3">
          {S.loginRequired}
        </h3>
        <p className="text-white/70 mb-6 max-w-sm">
          {S.loginDesc}
        </p>
        
        <button
          onClick={onLoginClick}
          className="px-8 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold rounded-xl transition-all shadow-lg shadow-emerald-600/20 flex items-center gap-2 mx-auto"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
              d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
          </svg>
          {S.loginBtn}
        </button>
      </div>
    </div>
  );
};

// ==================== 放大镜动画组件 ====================
const SnifferAnimation = ({ progress, message }) => {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  
  const stateRef = useRef({
    magnifierX: 200,
    magnifierY: 150,
    targetX: 200,
    targetY: 150,
    time: 0,
    genes: SAMPLE_FUSION_GENES.map((name, i) => ({
      name,
      x: 50 + (i % 4) * 140 + Math.random() * 40,
      y: 60 + Math.floor(i / 4) * 80 + Math.random() * 20,
      opacity: 0.15 + Math.random() * 0.15,
      scale: 0.8 + Math.random() * 0.4,
      pulsePhase: Math.random() * Math.PI * 2
    }))
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const width = 500;
    const height = 350;
    
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);
    
    const state = stateRef.current;
    
    const drawMagnifier = (x, y, radius, time) => {
      // 光晕
      const glowGradient = ctx.createRadialGradient(x, y, radius * 0.8, x, y, radius * 1.5);
      glowGradient.addColorStop(0, 'rgba(16, 185, 129, 0.35)');
      glowGradient.addColorStop(0.5, 'rgba(16, 185, 129, 0.15)');
      glowGradient.addColorStop(1, 'transparent');
      ctx.fillStyle = glowGradient;
      ctx.beginPath();
      ctx.arc(x, y, radius * 1.5, 0, Math.PI * 2);
      ctx.fill();
      
      // 镜片
      const lensGradient = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.3, 0, x, y, radius);
      lensGradient.addColorStop(0, 'rgba(167, 243, 208, 0.2)');
      lensGradient.addColorStop(0.7, 'rgba(16, 185, 129, 0.1)');
      lensGradient.addColorStop(1, 'rgba(6, 95, 70, 0.25)');
      ctx.fillStyle = lensGradient;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      
      // 镜框
      ctx.strokeStyle = 'rgba(167, 243, 208, 0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.stroke();
      
      // 扫描线
      const scanAngle = time * 2;
      ctx.strokeStyle = 'rgba(52, 211, 153, 0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(scanAngle) * radius * 0.9, y + Math.sin(scanAngle) * radius * 0.9);
      ctx.stroke();
      
      // 手柄
      const handleAngle = Math.PI * 0.75;
      const handleStartX = x + Math.cos(handleAngle) * radius;
      const handleStartY = y + Math.sin(handleAngle) * radius;
      
      ctx.strokeStyle = 'rgba(167, 243, 208, 0.9)';
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(handleStartX, handleStartY);
      ctx.lineTo(handleStartX + Math.cos(handleAngle) * 45, handleStartY + Math.sin(handleAngle) * 45);
      ctx.stroke();
      
      // SNIFFER 文字
      ctx.font = 'bold 14px "SF Mono", "Fira Code", monospace';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(16, 185, 129, 0.8)';
      ctx.shadowBlur = 15;
      ctx.fillText('SNIFFER', x, y - 8);
      
      // 进度百分比
      ctx.font = 'bold 18px "SF Mono", monospace';
      ctx.fillStyle = 'rgba(52, 211, 153, 1)';
      ctx.fillText(`${Math.round(progress)}%`, x, y + 15);
      ctx.shadowBlur = 0;
    };
    
    const animate = () => {
      state.time += 0.016;
      
      const centerX = width / 2;
      const centerY = height / 2;
      state.targetX = centerX + Math.cos(state.time * 0.4) * (width * 0.25);
      state.targetY = centerY + Math.sin(state.time * 0.6) * (height * 0.2);
      state.magnifierX += (state.targetX - state.magnifierX) * 0.025;
      state.magnifierY += (state.targetY - state.magnifierY) * 0.025;
      
      ctx.clearRect(0, 0, width, height);
      
      // 背景
      const bgGradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, width * 0.8);
      bgGradient.addColorStop(0, 'rgba(15, 23, 42, 0.98)');
      bgGradient.addColorStop(1, 'rgba(2, 6, 23, 1)');
      ctx.fillStyle = bgGradient;
      ctx.fillRect(0, 0, width, height);
      
      // 网格
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.06)';
      ctx.lineWidth = 1;
      for (let x = 0; x < width; x += 35) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += 35) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
      
      // 融合基因名称
      const magnifierRadius = 60;
      state.genes.forEach((gene) => {
        const dx = gene.x - state.magnifierX;
        const dy = gene.y - state.magnifierY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const isInMagnifier = dist < magnifierRadius;
        
        let alpha = gene.opacity;
        let color = 'rgba(148, 163, 184, ';
        let fontSize = 10 * gene.scale;
        
        if (isInMagnifier) {
          const intensity = 1 - (dist / magnifierRadius);
          alpha = 0.75 + intensity * 0.25;
          if (gene.name.includes('ALK') || gene.name.includes('ROS1')) {
            color = 'rgba(52, 211, 153, ';
          } else if (gene.name.includes('ABL') || gene.name.includes('BCR')) {
            color = 'rgba(251, 146, 60, ';
          } else {
            color = 'rgba(96, 165, 250, ';
          }
          fontSize = 12 * gene.scale;
          ctx.shadowColor = color + '0.8)';
          ctx.shadowBlur = 12;
        } else {
          ctx.shadowBlur = 0;
        }
        
        const pulse = Math.sin(state.time * 2 + gene.pulsePhase) * 0.08 + 1;
        ctx.font = `${fontSize * pulse}px "SF Mono", "Fira Code", monospace`;
        ctx.fillStyle = color + alpha + ')';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(gene.name, gene.x, gene.y);
        ctx.shadowBlur = 0;
      });
      
      drawMagnifier(state.magnifierX, state.magnifierY, magnifierRadius, state.time);
      
      // 底部进度条
      const barWidth = width * 0.7;
      const barX = (width - barWidth) / 2;
      const barY = height - 45;
      
      ctx.fillStyle = 'rgba(30, 41, 59, 0.9)';
      ctx.beginPath();
      ctx.roundRect(barX, barY, barWidth, 8, 4);
      ctx.fill();
      
      const progressWidth = Math.max(4, (barWidth - 4) * (progress / 100));
      const progressGradient = ctx.createLinearGradient(barX, 0, barX + barWidth, 0);
      progressGradient.addColorStop(0, '#10b981');
      progressGradient.addColorStop(0.5, '#34d399');
      progressGradient.addColorStop(1, '#6ee7b7');
      ctx.fillStyle = progressGradient;
      ctx.beginPath();
      ctx.roundRect(barX + 2, barY + 2, progressWidth, 4, 2);
      ctx.fill();
      
      // 状态文字
      ctx.font = '12px "Inter", system-ui, sans-serif';
      ctx.fillStyle = 'rgba(148, 163, 184, 0.95)';
      ctx.textAlign = 'center';
      ctx.fillText(message, width / 2, height - 20);
      
      animationRef.current = requestAnimationFrame(animate);
    };
    
    animate();
    
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [progress, message]);
  
  return (
    <canvas
      ref={canvasRef}
      className="rounded-xl shadow-xl mx-auto"
      style={{ 
        background: 'linear-gradient(135deg, #0f172a 0%, #020617 100%)',
        border: '1px solid rgba(16, 185, 129, 0.2)',
        maxWidth: '100%'
      }}
    />
  );
};

// ==================== FQ 柱状图组件 ====================
const FQChart = ({ data, maxItems = 50 }) => {
  const containerRef = useRef(null);
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const threshold = 0.1;
  const { t } = useLanguage();
  const S = t.sniffer;
  
  // 处理数据
  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];
    
    // 按融合名分组计算
    const fusionMap = new Map();
    
    data.forEach(row => {
      const fusionName = row['Fusion.Name'] || row['FusionName'] || row['fusion_name'];
      const ffpm = parseFloat(row['Avg.FFPM'] || row['FFPM'] || row['ffpm'] || 0);
      const fq = parseInt(row['fq'] || row['FQ'] || 1);
      
      if (!fusionName) return;
      
      if (!fusionMap.has(fusionName)) {
        fusionMap.set(fusionName, { fq_red: 0, fq_gray: 0 });
      }
      
      const entry = fusionMap.get(fusionName);
      if (ffpm >= threshold) {
        entry.fq_gray += fq;
      } else {
        entry.fq_red += fq;
      }
    });
    
    // 转换为数组并排序
    const result = Array.from(fusionMap.entries())
      .map(([name, counts]) => ({
        name,
        fq_red: counts.fq_red,
        fq_gray: counts.fq_gray,
        fq_total: counts.fq_red + counts.fq_gray,
        total_log: Math.log2(counts.fq_red + counts.fq_gray + 1)
      }))
      .sort((a, b) => b.fq_total - a.fq_total)
      .slice(0, maxItems);
    
    // 计算比例
    result.forEach(item => {
      item.red_ratio = item.fq_total > 0 ? item.fq_red / item.fq_total : 0;
      item.gray_ratio = item.fq_total > 0 ? item.fq_gray / item.fq_total : 0;
      item.red_length = item.total_log * item.red_ratio;
      item.gray_length = item.total_log * item.gray_ratio;
    });
    
    return result.reverse(); // 从小到大排列，底部最大
  }, [data, maxItems]);
  
  const maxLog = useMemo(() => {
    return chartData.length > 0 ? Math.max(...chartData.map(d => d.total_log)) : 1;
  }, [chartData]);
  
  if (chartData.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-400">
        <svg className="w-16 h-16 mb-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        <p>{S.noData}</p>
        <p className="text-sm text-gray-400 mt-1">{S.noDataHint}</p>
      </div>
    );
  }
  
  return (
    <div ref={containerRef} className="w-full overflow-y-auto" style={{ maxHeight: 'calc(100vh - 400px)' }}>
      {/* 图例 */}
      <div className="flex items-center gap-6 mb-4 px-2 sticky top-0 bg-white/90 backdrop-blur py-2 z-10">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-gray-400"></div>
          <span className="text-sm text-gray-600">FFPM ≥ 0.1</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-red-500"></div>
          <span className="text-sm text-gray-600">FFPM &lt; 0.1</span>
        </div>
      </div>
      
      {/* 柱状图 */}
      <div className="space-y-1.5 pr-2">
        {chartData.map((item, index) => {
          const barWidthPercent = (item.total_log / maxLog) * 70;
          const grayWidth = (item.gray_length / item.total_log) * barWidthPercent;
          const redWidth = (item.red_length / item.total_log) * barWidthPercent;
          const isOnlyRed = item.fq_gray === 0;
          
          return (
            <div 
              key={item.name}
              className="flex items-center gap-2 group cursor-pointer"
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              {/* 融合名 */}
              <div 
                className={`w-32 text-right text-xs truncate transition-colors ${
                  isOnlyRed ? 'italic text-gray-400' : 'text-gray-700'
                } ${hoveredIndex === index ? 'text-white font-medium' : ''}`}
                title={item.name}
              >
                {item.name}
              </div>
              
              {/* 柱状条 */}
              <div className="flex-1 flex items-center h-5">
                {/* 灰色部分 (FFPM >= 0.1) */}
                {item.fq_gray > 0 && (
                  <div 
                    className="h-full bg-gray-400 rounded-l transition-all group-hover:bg-gray-500"
                    style={{ width: `${grayWidth}%` }}
                  />
                )}
                {/* 红色部分 (FFPM < 0.1) */}
                {item.fq_red > 0 && (
                  <div 
                    className={`h-full bg-red-500 transition-all group-hover:bg-red-400 ${
                      item.fq_gray === 0 ? 'rounded-l' : ''
                    } rounded-r`}
                    style={{ width: `${redWidth}%` }}
                  />
                )}
                
                {/* 数值标签 */}
                <span className="ml-2 text-xs text-gray-500 whitespace-nowrap">
                  {item.fq_gray > 0 && item.fq_red > 0 ? (
                    <>{item.fq_gray}<span className="text-gray-400">/</span><span className="text-red-500">{item.fq_red}</span></>
                  ) : item.fq_gray > 0 ? (
                    item.fq_gray
                  ) : (
                    <span className="text-red-500">{item.fq_red}</span>
                  )}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      
      {/* X轴标签 */}
      <div className="mt-4 pt-2 border-t border-gray-200 text-center text-sm text-gray-500">
        Fq (log₂ scale)
      </div>
    </div>
  );
};

// ==================== 结果展示组件 ====================
const ResultPanel = ({ result, taskId, onDownload, onNewAnalysis }) => {
  const { t } = useLanguage();
  const S = t.sniffer;
  return (
    <div className="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-2xl p-6 border border-emerald-200">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center">
          <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div>
          <h3 className="text-lg font-semibold text-gray-800">{S.analysisComplete}</h3>
          <p className="text-sm text-gray-500">{S.snifferResults}</p>
        </div>
      </div>
      
      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-2xl font-bold text-emerald-600">{result?.total || 0}</p>
          <p className="text-sm text-gray-500">{S.fusionRecords}</p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-2xl font-bold text-teal-600">{result?.unique_fusions || 0}</p>
          <p className="text-sm text-gray-500">{S.uniqueFusions}</p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-2xl font-bold text-cyan-600">{result?.genes || 0}</p>
          <p className="text-sm text-gray-500">{S.genesInvolved}</p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-2xl font-bold text-sky-600">{result?.chromosomes || 0}</p>
          <p className="text-sm text-gray-500">{S.chromosomes}</p>
        </div>
      </div>
      
      {/* Top fusions list */}
      {result?.fusion_list && result.fusion_list.length > 0 && (
        <div className="mb-6">
          <h4 className="text-sm font-medium text-gray-700 mb-3">{S.topFusionsTitle}</h4>
          <div className="flex flex-wrap gap-2">
            {result.fusion_list.slice(0, 10).map((fusion, idx) => (
              <span key={idx} className="px-3 py-1.5 bg-white rounded-lg text-sm text-emerald-700 border border-emerald-200">
                {fusion}
              </span>
            ))}
          </div>
        </div>
      )}
      
      {/* Action buttons */}
      <div className="flex gap-3">
        <button
          onClick={onDownload}
          className="flex-1 py-3 rounded-xl font-medium text-white bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 transition-all flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          {S.downloadResults}
        </button>
        <button
          onClick={onNewAnalysis}
          className="px-6 py-3 rounded-xl font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-all"
        >
          {S.newAnalysis}
        </button>
      </div>
    </div>
  );
};

// ==================== 主组件 ====================
const Sniffer = () => {
  const { user, token } = useAuth();
  const { t } = useLanguage();
  const S = t.sniffer;
  const navigate = useNavigate();
  
  // 登录状态
  const isLoggedIn = user && user !== 'guest' && token;
  
  // SNIFFER 状态
  const [activeMode, setActiveMode] = useState('tsv'); // 'tsv' | 'fastq'
  const [files, setFiles] = useState({ file1: null, file2: null, tsv: null });
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [taskId, setTaskId] = useState(null);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  
  // FQ 图表状态
  const [fqData, setFqData] = useState([]);
  const [fqFile, setFqFile] = useState(null);
  const [fqLoading, setFqLoading] = useState(false);
  const [fqError, setFqError] = useState(null);
  const [maxChartItems, setMaxChartItems] = useState(50);
  
  // 恢复任务状态
  useEffect(() => {
    const savedTask = localStorage.getItem('sniffer_task');
    if (savedTask) {
      try {
        const task = JSON.parse(savedTask);
        if (task.taskId && task.status !== 'completed' && task.status !== 'failed') {
          setTaskId(task.taskId);
          setAnalyzing(true);
          setProgress(task.progress || 0);
          setStatusMessage(task.message || S.taskResuming);
        } else if (task.status === 'completed' && task.result) {
          setResult(task.result);
          setTaskId(task.taskId);
        }
      } catch (e) {
        localStorage.removeItem('sniffer_task');
      }
    }
  }, []);
  
  // 保存任务状态
  const saveTaskState = useCallback((state) => {
    localStorage.setItem('sniffer_task', JSON.stringify(state));
  }, []);
  
  // 轮询任务状态
  useEffect(() => {
    if (!taskId || !analyzing || !token) return;
    
    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`${API_BASE}/status/${taskId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!response.ok) {
          if (response.status === 401) {
            setError(S.errLoginExpired);
            setAnalyzing(false);
            localStorage.removeItem('sniffer_task');
            clearInterval(pollInterval);
            return;
          }
          return;
        }
        
        const data = await response.json();
        
        if (data.success) {
          setProgress(data.data.progress);
          setStatusMessage(data.data.message);
          
          saveTaskState({
            taskId,
            status: data.data.status,
            progress: data.data.progress,
            message: data.data.message
          });
          
          if (data.data.status === 'completed') {
            setResult(data.data.result);
            setAnalyzing(false);
            saveTaskState({
              taskId,
              status: 'completed',
              result: data.data.result
            });
            clearInterval(pollInterval);
          } else if (data.data.status === 'failed') {
            setError(data.data.message);
            setAnalyzing(false);
            localStorage.removeItem('sniffer_task');
            clearInterval(pollInterval);
          }
        }
      } catch (err) {
        console.error('轮询状态失败:', err);
      }
    }, 2000);
    
    return () => clearInterval(pollInterval);
  }, [taskId, analyzing, token, saveTaskState]);
  
  // 文件处理
  const handleFileChange = (e, fileKey) => {
    const file = e.target.files[0];
    if (file) {
      setFiles(prev => ({ ...prev, [fileKey]: file }));
      setError(null);
    }
  };
  
  // 拖拽处理
  const handleDrag = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);
  
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    const droppedFiles = Array.from(e.dataTransfer.files);
    
    if (activeMode === 'tsv') {
      const tsvFile = droppedFiles.find(f => 
        f.name.endsWith('.tsv') || f.name.endsWith('.txt') || f.name.endsWith('.csv')
      );
      if (tsvFile) {
        setFiles(prev => ({ ...prev, tsv: tsvFile }));
        setError(null);
      }
    } else {
      if (droppedFiles.length >= 2) {
        setFiles({ file1: droppedFiles[0], file2: droppedFiles[1], tsv: null });
        setError(null);
      } else if (droppedFiles.length === 1) {
        if (!files.file1) {
          setFiles(prev => ({ ...prev, file1: droppedFiles[0] }));
        } else {
          setFiles(prev => ({ ...prev, file2: droppedFiles[0] }));
        }
      }
    }
  }, [activeMode, files.file1]);
  
  // FASTQ 分析
  const handleFastqAnalysis = async () => {
    if (!files.file1 || !files.file2 || !token) return;
    
    setError(null);
    setUploading(true);
    setUploadProgress(0);
    
    const formData = new FormData();
    formData.append('file1', files.file1);
    formData.append('file2', files.file2);
    
    try {
      const xhr = new XMLHttpRequest();
      
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100);
          setUploadProgress(percent);
        }
      });
      
      xhr.onload = () => {
        setUploading(false);
        if (xhr.status === 200) {
          const data = JSON.parse(xhr.responseText);
          if (data.success) {
            setTaskId(data.task_id);
            setAnalyzing(true);
            setProgress(0);
            setStatusMessage(S.taskStarting);
            saveTaskState({ taskId: data.task_id, status: 'running', progress: 0 });
          } else {
            setError(data.message || S.errUploadFailed);
          }
        } else {
          setError(S.errUploadRetry);
        }
      };
      
      xhr.onerror = () => {
        setUploading(false);
        setError(S.errNetwork);
      };
      
      xhr.open('POST', `${API_BASE}/upload`);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.send(formData);
      
    } catch (err) {
      setUploading(false);
      setError(err.message || S.errUploadFailed);
    }
  };
  
  // TSV 分析
  const handleTsvAnalysis = async () => {
    if (!files.tsv || !token) return;
    
    setError(null);
    setUploading(true);
    setUploadProgress(0);
    
    const formData = new FormData();
    formData.append('fusion_file', files.tsv);
    
    try {
      const xhr = new XMLHttpRequest();
      
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100);
          setUploadProgress(percent);
        }
      });
      
      xhr.onload = () => {
        setUploading(false);
        if (xhr.status === 200) {
          const data = JSON.parse(xhr.responseText);
          if (data.success) {
            setTaskId(data.task_id);
            setAnalyzing(true);
            setProgress(0);
            setStatusMessage(S.taskStarting);
            saveTaskState({ taskId: data.task_id, status: 'running', progress: 0 });
          } else {
            setError(data.message || S.errUploadFailed);
          }
        } else {
          setError(S.errUploadRetry);
        }
      };
      
      xhr.onerror = () => {
        setUploading(false);
        setError(S.errNetwork);
      };
      
      xhr.open('POST', `${API_BASE}/upload-tsv`);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.send(formData);
      
    } catch (err) {
      setUploading(false);
      setError(err.message || S.errUploadFailed);
    }
  };
  
  // 开始分析
  const handleAnalysis = () => {
    if (activeMode === 'tsv') {
      handleTsvAnalysis();
    } else {
      handleFastqAnalysis();
    }
  };
  
  // 下载结果
  const handleDownload = async () => {
    if (!taskId || !token) return;
    
    try {
      const response = await fetch(`${API_BASE}/download/${taskId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `SNIFFER_result_${taskId}.csv`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
    } catch (err) {
      setError(S.errDownload);
    }
  };
  
  // 重置
  const handleReset = () => {
    setFiles({ file1: null, file2: null, tsv: null });
    setResult(null);
    setTaskId(null);
    setAnalyzing(false);
    setProgress(0);
    setStatusMessage('');
    setError(null);
    localStorage.removeItem('sniffer_task');
  };
  
  // 处理 FQ 文件上传
  const handleFqFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    setFqFile(file);
    setFqLoading(true);
    setFqError(null);
    
    try {
      const text = await file.text();
      let parsedData = [];
      
      if (file.name.endsWith('.csv')) {
        // 解析 CSV
        const lines = text.split('\n').filter(line => line.trim());
        const headers = lines[0].split(',').map(h => h.trim().replace(/^\ufeff/, ''));
        
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',');
          const row = {};
          headers.forEach((header, idx) => {
            row[header] = values[idx]?.trim() || '';
          });
          parsedData.push(row);
        }
      } else if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
        // 对于 Excel 文件，需要使用 SheetJS
        setFqError(S.errCsvOnly);
        setFqLoading(false);
        return;
      } else {
        // 尝试作为 TSV 解析
        const lines = text.split('\n').filter(line => line.trim());
        const delimiter = lines[0].includes('\t') ? '\t' : ',';
        const headers = lines[0].split(delimiter).map(h => h.trim().replace(/^\ufeff/, ''));
        
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(delimiter);
          const row = {};
          headers.forEach((header, idx) => {
            row[header] = values[idx]?.trim() || '';
          });
          parsedData.push(row);
        }
      }
      
      setFqData(parsedData);
    } catch (err) {
      setFqError(S.errParseFailed(err.message));
    } finally {
      setFqLoading(false);
    }
  };


  // 清除 FQ 数据
  const handleClearFqData = () => {
    setFqData([]);
    setFqFile(null);
    setFqError(null);
  };
  
  return (
    <div className="min-h-screen bg-gray-50">
      {/* 页面标题 */}
      <div className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-[1800px] mx-auto px-6 py-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 tracking-tight">SNIFFER</h1>
              <p className="text-emerald-600 text-sm font-medium">Fusion Gene Detection Algorithm</p>
            </div>
          </div>
        </div>
      </div>
      
      {/* 主内容区域 - 双面板布局 */}
      <div className="max-w-[1800px] mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          {/* ==================== 左侧面板: SNIFFER 分析 ==================== */}
          <div className="relative">
            <div className={`bg-white rounded-3xl shadow-lg border border-gray-200 overflow-hidden ${!isLoggedIn ? 'min-h-[700px]' : ''}`}>
              
              {/* 未登录遮罩 */}
              {!isLoggedIn && (
                <LoginOverlay onLoginClick={() => navigate('/login')} />
              )}
              
              <div className={`p-8 ${!isLoggedIn ? 'opacity-30 pointer-events-none blur-sm' : ''}`}>
                {/* 面板标题 */}
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-semibold text-gray-800 flex items-center gap-3">
                    <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    {S.panelTitle}
                  </h2>
                  {isLoggedIn && (
                    <span className="text-sm text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">
                      {S.loggedInAs(user?.username)}
                    </span>
                  )}
                </div>
                
                {/* 分析中状态 */}
                {analyzing ? (
                  <div className="text-center py-8">
                    <SnifferAnimation progress={progress} message={statusMessage} />
                    <p className="text-gray-500 mt-4">{S.analyzing}</p>
                  </div>
                ) : result ? (
                  <ResultPanel 
                    result={result} 
                    taskId={taskId}
                    onDownload={handleDownload}
                    onNewAnalysis={handleReset}
                  />
                ) : (
                  <>
                    {/* 模式切换 Tab */}
                    <div className="flex bg-gray-100 rounded-xl p-1 mb-6">
                      <button
                        onClick={() => setActiveMode('tsv')}
                        className={`flex-1 py-3 px-4 rounded-lg font-medium transition-all flex items-center justify-center gap-2 ${
                          activeMode === 'tsv' 
                            ? 'bg-emerald-600 text-white shadow-lg' 
                            : 'text-gray-500 hover:text-gray-900'
                        }`}
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        {S.tabTsv}
                      </button>
                      <button
                        onClick={() => setActiveMode('fastq')}
                        className={`flex-1 py-3 px-4 rounded-lg font-medium transition-all flex items-center justify-center gap-2 ${
                          activeMode === 'fastq' 
                            ? 'bg-emerald-600 text-white shadow-lg' 
                            : 'text-gray-500 hover:text-gray-900'
                        }`}
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                        </svg>
                        {S.tabFastq}
                      </button>
                    </div>
                    
                    {/* 模式说明 */}
                    <div className="bg-gray-50 rounded-xl p-4 mb-6 border border-gray-200">
                      {activeMode === 'tsv' ? (
                        <div className="flex gap-3">
                          <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                            <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          </div>
                          <div>
                            <h4 className="text-gray-800 font-medium mb-1">{S.tsvModeTitle}</h4>
                            <p className="text-sm text-gray-500">
                              {S.tsvModeDesc(
                                <span className="text-emerald-600 font-medium">{S.tsvModeE1}</span>,
                                <span className="text-emerald-600 font-medium">{S.tsvModeE2}</span>
                              )}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-3">
                          <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                            <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          </div>
                          <div>
                            <h4 className="text-gray-800 font-medium mb-1">{S.fastqModeTitle}</h4>
                            <p className="text-sm text-gray-500">
                              {S.fastqModeDesc(<>
                                <code className="text-emerald-600 bg-gray-100 px-1 rounded mx-0.5">.fastq</code>
                                <code className="text-emerald-600 bg-gray-100 px-1 rounded mx-0.5">.fq</code>
                                <code className="text-emerald-600 bg-gray-100 px-1 rounded mx-0.5">.gz</code>
                              </>)}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                    
                    {/* 文件上传区域 */}
                    <div
                      className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all mb-6 ${
                        dragActive ? 'border-emerald-400 bg-emerald-50' : 'border-gray-300 hover:border-emerald-400 bg-white'
                      } ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
                      onDragEnter={handleDrag}
                      onDragLeave={handleDrag}
                      onDragOver={handleDrag}
                      onDrop={handleDrop}
                    >
                      <div className="w-14 h-14 mx-auto mb-4 bg-gray-100 rounded-2xl flex items-center justify-center">
                        <svg className="w-7 h-7 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                        </svg>
                      </div>
                      <p className="text-gray-600 mb-1">{S.dropHint}</p>
                      <p className="text-sm text-gray-400">{S.dropHint2}</p>
                    </div>
                    
                    {/* 文件选择器 - 根据模式显示不同内容 */}
                    {activeMode === 'tsv' ? (
                      <div className="mb-6">
                        <label className="block text-sm font-medium text-gray-600 mb-2">{S.fusionFileLabel}</label>
                        <label className={`flex flex-col items-center justify-center h-28 rounded-xl border-2 border-dashed cursor-pointer transition-all ${
                          files.tsv ? 'border-emerald-400 bg-emerald-50' : 'border-gray-300 hover:border-emerald-400 bg-white'
                        } ${uploading ? 'pointer-events-none' : ''}`}>
                          <input 
                            type="file" 
                            accept=".tsv,.csv,.txt" 
                            onChange={(e) => handleFileChange(e, 'tsv')} 
                            className="hidden" 
                            disabled={uploading} 
                          />
                          {files.tsv ? (
                            <>
                              <svg className="w-7 h-7 text-emerald-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                              <span className="text-sm text-emerald-600 text-center px-3 truncate max-w-full font-medium">{files.tsv.name}</span>
                              <span className="text-xs text-gray-400 mt-1">{formatFileSize(files.tsv.size)}</span>
                            </>
                          ) : (
                            <>
                              <svg className="w-7 h-7 text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                              </svg>
                              <span className="text-sm text-gray-400">star-fusion.fusion_predictions.tsv</span>
                            </>
                          )}
                        </label>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-4 mb-6">
                        {/* Read 1 */}
                        <div>
                          <label className="block text-sm font-medium text-gray-600 mb-2">{S.read1Label}</label>
                          <label className={`flex flex-col items-center justify-center h-28 rounded-xl border-2 border-dashed cursor-pointer transition-all ${
                            files.file1 ? 'border-emerald-400 bg-emerald-50' : 'border-gray-300 hover:border-emerald-400 bg-white'
                          } ${uploading ? 'pointer-events-none' : ''}`}>
                            <input 
                              type="file" 
                              accept=".fastq,.fq,.gz" 
                              onChange={(e) => handleFileChange(e, 'file1')} 
                              className="hidden" 
                              disabled={uploading} 
                            />
                            {files.file1 ? (
                              <>
                                <svg className="w-7 h-7 text-emerald-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                                <span className="text-xs text-emerald-600 text-center px-3 truncate max-w-full font-medium">{files.file1.name}</span>
                                <span className="text-xs text-gray-400 mt-1">{formatFileSize(files.file1.size)}</span>
                              </>
                            ) : (
                              <>
                                <svg className="w-7 h-7 text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                                </svg>
                                <span className="text-xs text-gray-400">*_1.fastq / *_R1.fastq</span>
                              </>
                            )}
                          </label>
                        </div>
                        
                        {/* Read 2 */}
                        <div>
                          <label className="block text-sm font-medium text-gray-600 mb-2">{S.read2Label}</label>
                          <label className={`flex flex-col items-center justify-center h-28 rounded-xl border-2 border-dashed cursor-pointer transition-all ${
                            files.file2 ? 'border-emerald-400 bg-emerald-50' : 'border-gray-300 hover:border-emerald-400 bg-white'
                          } ${uploading ? 'pointer-events-none' : ''}`}>
                            <input 
                              type="file" 
                              accept=".fastq,.fq,.gz" 
                              onChange={(e) => handleFileChange(e, 'file2')} 
                              className="hidden" 
                              disabled={uploading} 
                            />
                            {files.file2 ? (
                              <>
                                <svg className="w-7 h-7 text-emerald-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                                <span className="text-xs text-emerald-600 text-center px-3 truncate max-w-full font-medium">{files.file2.name}</span>
                                <span className="text-xs text-gray-400 mt-1">{formatFileSize(files.file2.size)}</span>
                              </>
                            ) : (
                              <>
                                <svg className="w-7 h-7 text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                                </svg>
                                <span className="text-xs text-gray-400">*_2.fastq / *_R2.fastq</span>
                              </>
                            )}
                          </label>
                        </div>
                      </div>
                    )}
                    
                    {/* 上传进度 */}
                    {uploading && (
                      <div className="mb-6 p-4 bg-gray-50 rounded-xl border border-gray-200">
                        <div className="flex justify-between text-sm mb-2">
                          <span className="text-gray-500">{S.uploading}</span>
                          <span className="text-emerald-600 font-medium">{uploadProgress}%</span>
                        </div>
                        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-300 rounded-full"
                            style={{ width: `${uploadProgress}%` }}
                          />
                        </div>
                      </div>
                    )}
                    
                    {/* 错误提示 */}
                    {error && (
                      <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl">
                        <p className="text-red-600 text-sm flex items-center gap-2">
                          <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          {error}
                        </p>
                      </div>
                    )}
                    
                    {/* 操作按钮 */}
                    <div className="flex gap-3">
                      <button
                        onClick={handleAnalysis}
                        disabled={activeMode === 'tsv' ? !files.tsv : (!files.file1 || !files.file2) || uploading}
                        className={`flex-1 py-4 rounded-xl font-semibold text-white transition-all flex items-center justify-center gap-2 ${
                          (activeMode === 'tsv' ? !files.tsv : (!files.file1 || !files.file2)) || uploading
                            ? 'bg-gray-200 cursor-not-allowed text-gray-400'
                            : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 shadow-lg shadow-emerald-600/20'
                        }`}
                      >
                        {uploading ? (
                          <>
                            <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            {S.uploadingBtn}
                          </>
                        ) : (
                          <>
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            {S.startAnalysis}
                          </>
                        )}
                      </button>
                      
                      {((activeMode === 'tsv' && files.tsv) || (activeMode === 'fastq' && (files.file1 || files.file2))) && !uploading && (
                        <button 
                          onClick={handleReset} 
                          className="px-6 py-4 rounded-xl font-medium text-gray-500 bg-gray-100 hover:bg-gray-200 transition-all"
                        >
                          {S.reset}
                        </button>
                      )}
                    </div>
                    
                    {/* 使用说明 */}
                    <div className="mt-6 p-4 bg-gray-50 rounded-xl border border-gray-200">
                      <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {S.usageTitle}
                      </h3>
                      <div className="space-y-2 text-sm text-gray-500">
                        {activeMode === 'tsv' ? (
                          <>
                            <p>{S.tsvStep1}</p>
                            <p>{S.tsvStep2}</p>
                            <p>{S.tsvStep3}</p>
                          </>
                        ) : (
                          <>
                            <p>{S.fastqStep1}</p>
                            <p>{S.fastqStep2}</p>
                            <p>{S.fastqStep3}</p>
                          </>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
          
          {/* ==================== 右侧面板: FQ 柱状图 ==================== */}
          <div className="bg-white rounded-3xl shadow-lg border border-gray-200 p-8">
            {/* 面板标题 */}
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-gray-800 flex items-center gap-3">
                <svg className="w-6 h-6 text-cyan-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                {S.fqPanelTitle}
              </h2>
              
              {fqData.length > 0 && (
                <button
                  onClick={handleClearFqData}
                  className="text-sm text-gray-400 hover:text-red-500 transition-colors flex items-center gap-1"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  {S.clearData}
                </button>
              )}
            </div>
            
            {/* 说明 */}
            <div className="bg-gray-50 rounded-xl p-4 mb-6 border border-gray-200">
              <div className="flex gap-3">
                <div className="w-10 h-10 rounded-lg bg-cyan-50 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-cyan-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h4 className="text-gray-800 font-medium mb-1">{S.fqPanelTitle}</h4>
                  <p className="text-sm text-gray-500">
                    {S.fqDesc1} <code className="text-cyan-600 bg-gray-100 px-1 rounded">Fusion.Name</code>、
                    <code className="text-cyan-600 bg-gray-100 px-1 rounded">fq</code>、
                    <code className="text-cyan-600 bg-gray-100 px-1 rounded">Avg.FFPM</code> {S.fqDesc3}
                  </p>
                </div>
              </div>
            </div>
            
            {/* 文件上传 */}
            {fqData.length === 0 && (
              <div className="mb-6">
                <label className={`flex flex-col items-center justify-center h-32 rounded-xl border-2 border-dashed cursor-pointer transition-all ${
                  fqLoading ? 'opacity-50 pointer-events-none' : 'border-gray-300 hover:border-cyan-400 bg-white'
                }`}>
                  <input 
                    type="file" 
                    accept=".csv,.xlsx,.xls,.tsv" 
                    onChange={handleFqFileChange} 
                    className="hidden" 
                    disabled={fqLoading}
                  />
                  {fqLoading ? (
                    <svg className="animate-spin w-8 h-8 text-cyan-600" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  ) : (
                    <>
                      <svg className="w-10 h-10 text-gray-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                      <span className="text-gray-600 mb-1">{S.fqUploadHint}</span>
                      <span className="text-sm text-gray-400">{S.fqUploadHint2}</span>
                    </>
                  )}
                </label>
              </div>
            )}
            
            {/* FQ 错误提示 */}
            {fqError && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl">
                <p className="text-red-600 text-sm flex items-center gap-2">
                  <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {fqError}
                </p>
              </div>
            )}
            
            {/* 文件信息和控制 */}
            {fqFile && fqData.length > 0 && (
              <div className="flex items-center justify-between mb-4 p-3 bg-gray-50 rounded-xl border border-gray-200">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-cyan-500/20 flex items-center justify-center">
                    <svg className="w-5 h-5 text-cyan-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm text-gray-800 font-medium">{fqFile.name}</p>
                    <p className="text-xs text-gray-500">{S.fqRecords(fqData.length)}</p>
                  </div>
                </div>
                
                {/* 显示数量控制 */}
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500">{S.showLabel}</span>
                  <select
                    value={maxChartItems}
                    onChange={(e) => setMaxChartItems(Number(e.target.value))}
                    className="bg-white border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  >
                    <option value={20}>Top 20</option>
                    <option value={30}>Top 30</option>
                    <option value={50}>Top 50</option>
                    <option value={100}>Top 100</option>
                  </select>
                </div>
              </div>
            )}
            
            {/* FQ 柱状图 */}
            <div className="bg-gray-50 rounded-xl p-4 border border-gray-200" style={{ minHeight: '400px' }}>
              <FQChart data={fqData} maxItems={maxChartItems} />
            </div>
            
            {/* 图表说明 */}
            {fqData.length > 0 && (
              <div className="mt-4 p-3 bg-gray-50 rounded-xl border border-gray-200 text-sm text-gray-500">
                <p>{S.chartNote1}</p>
                <p>{S.chartNote2}</p>
                <p>{S.chartNote3}</p>
              </div>
            )}
          </div>
          
        </div>
      </div>
    </div>
  );
};

export default Sniffer;