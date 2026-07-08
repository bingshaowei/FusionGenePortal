import React, { useState } from 'react';

const MultiVariantFusionDiagram = ({ 
  allRows, 
  selectedRow, 
  onSelectVariant,
  width = 1200,
  height = 750  // 增加高度
}) => {
  const [hoveredVariant, setHoveredVariant] = useState(null);
  const [tooltipData, setTooltipData] = useState(null);

  const cleanGeneName = (raw) => {
    if (!raw) return '';
    return String(raw).split('^')[0].split('(')[0].split(/[,\s|;]/)[0].trim();
  };

  const getVariantColor = (index) => {
    const colors = [
      '#ef4444', '#f97316', '#eab308', '#84cc16', 
      '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
      '#6366f1', '#8b5cf6', '#d946ef', '#ec4899'
    ];
    return colors[index % colors.length];
  };

  if (!allRows || allRows.length === 0) {
    return <div className="text-center text-slate-400 py-10">暂无数据</div>;
  }

  // ========== 解析逻辑 ==========
  const parsedRows = allRows.map((row) => {
    const pickField = (side) => {
      const priority = side === 'left'
        ? ['left_breakpoint', 'LeftBreakpoint', 'LEFT_BREAKPOINT', 'result_breakpoint_left']
        : ['right_breakpoint', 'RightBreakpoint', 'RIGHT_BREAKPOINT', 'result_breakpoint_right'];

      for (const key of priority) {
        if (row[key] !== undefined && row[key] !== null && row[key] !== '') {
          return row[key];
        }
      }
      return null;
    };

    const parseExon = (exonStr) => {
      if (!exonStr) return null;
      const str = String(exonStr);
      const exonMatch = str.match(/(?:exon\s*|e)(\d{1,2})/i);
      if (exonMatch) {
        const num = parseInt(exonMatch[1], 10);
        if (num >= 1 && num <= 50) return num;
      }
      const numMatch = str.match(/\b(\d{1,2})\b/);
      if (numMatch) {
        const num = parseInt(numMatch[1], 10);
        if (num >= 1 && num <= 50) return num;
      }
      return null;
    };

    const parseBreakpoint = (bp) => {
      if (!bp) return { chr: 'N/A', pos: 0, display: 'N/A', band: 'N/A' };
      const str = String(bp);
      const match = str.match(/^(?:chr)?(\d+|[XYxy]):(\d+)/);
      if (match) {
        const chr = match[1].toUpperCase();
        const pos = parseInt(match[2], 10);
        const bandNum = Math.floor(pos / 10000000);
        const band = `q${bandNum > 0 ? bandNum : 11}`;
        return {
          chr,
          pos,
          display: `chr${chr}:${pos.toLocaleString()}`,
          band
        };
      }
      return { chr: 'N/A', pos: 0, display: String(bp), band: 'N/A' };
    };

    let leftExon = parseExon(row.result_exon_left);
    let rightExon = parseExon(row.result_exon_right);
    if (!leftExon) leftExon = 9;
    if (!rightExon) rightExon = 2;

    return {
      ...row,
      leftParsed: parseBreakpoint(pickField('left')),
      rightParsed: parseBreakpoint(pickField('right')),
      leftExon: leftExon,
      rightExon: rightExon,
    };
  });

  const firstRow = parsedRows[0] || {};
  const leftGene = cleanGeneName(firstRow.left_gene) || 'Gene A';
  const rightGene = cleanGeneName(firstRow.right_gene) || 'Gene B';
  const leftChr = firstRow.leftParsed?.chr || 'N/A';
  const rightChr = firstRow.rightParsed?.chr || 'N/A';
  const leftBand = firstRow.leftParsed?.band || 'q11';
  const rightBand = firstRow.rightParsed?.band || 'q11';

  const currentVariant = selectedRow 
    ? parsedRows.find(r => r.id === selectedRow.id) || parsedRows[0]
    : parsedRows[0];
  const currentLeftExon = currentVariant?.leftExon || 9;
  const currentRightExon = currentVariant?.rightExon || 2;

  // ========== 增加间距的布局参数 ==========
  const svgWidth = width - 220;
  const margin = { top: 50, right: 60, bottom: 50, left: 60 };
  
  // 关键Y坐标 - 大幅增加间距
  const titleY = 35;
  const topArcSpace = 140;      // 上方弧线空间
  const chrY = topArcSpace + 30;
  const geneY = chrY + 50;      // 染色体和基因之间
  const geneHeight = 38;
  const bottomArcSpace = 120;   // 下方弧线空间
  const transcriptY = geneY + geneHeight + bottomArcSpace + 60;

  // X坐标
  const leftX = margin.left;
  const rightX = svgWidth - margin.right - 300;
  const geneWidth = 300;
  const totalExons = 12;

  // ========== 绘制基因外显子 ==========
  const drawGeneWithExons = (x, y, w, h, color, exonCount, highlightExon, isLeft) => {
    const elements = [];
    const exonWidth = w / (exonCount * 1.5);
    const gapWidth = (w - exonWidth * exonCount) / (exonCount - 1);
    
    // 内含子线
    elements.push(
      <line 
        key="intron-line" 
        x1={x} 
        y1={y + h/2} 
        x2={x + w}
        y2={y + h/2}
        stroke={color} 
        strokeWidth={3} 
        opacity={0.2} 
      />
    );
    
    // 外显子
    for (let i = 0; i < exonCount; i++) {
      const exX = x + i * (exonWidth + gapWidth);
      const exonNum = i + 1;
      const isHighlight = highlightExon !== null && exonNum === highlightExon;
      const isKept = isLeft ? exonNum <= highlightExon : exonNum >= highlightExon;
      
      elements.push(
        <rect
          key={`exon-${i}`}
          x={exX}
          y={y}
          width={exonWidth}
          height={h}
          fill={isHighlight ? '#fbbf24' : (isKept ? color : `${color}25`)}
          stroke={isHighlight ? '#d97706' : (isKept ? color : `${color}50`)}
          strokeWidth={isHighlight ? 2.5 : 1}
          rx={4}
        />
      );
      
      if (exonWidth > 15) {
        elements.push(
          <text
            key={`exon-num-${i}`}
            x={exX + exonWidth/2}
            y={y + h/2 + 5}
            fontSize="12"
            fill={isHighlight ? '#92400e' : (isKept ? 'white' : '#9ca3af')}
            textAnchor="middle"
            fontWeight="bold"
          >
            {exonNum}
          </text>
        );
      }
    }
    
    // 方向箭头
    elements.push(
      <polygon
        key="arrow"
        points={`${x + w + 10},${y + h/2} ${x + w + 22},${y + h/2 - 10} ${x + w + 22},${y + h/2 + 10}`}
        fill={color}
        opacity={0.5}
      />
    );
    
    return elements;
  };

  // ========== 绘制融合转录本 ==========
  const drawFusionTranscript = () => {
    const elements = [];
    const startX = leftX + 30;
    const y = transcriptY;
    const exonH = 32;
    
    const leftKeptExons = currentLeftExon;
    const rightKeptExons = totalExons - currentRightExon + 1;
    const totalFusionExons = leftKeptExons + rightKeptExons;
    const maxWidth = rightX - leftX + geneWidth - 150;
    const exonW = Math.min(34, maxWidth / (totalFusionExons * 1.35));
    const gapW = exonW * 0.2;
    
    let currentX = startX;
    
    // 背景线
    const totalTranscriptWidth = totalFusionExons * exonW + (totalFusionExons - 1) * gapW;
    elements.push(
      <line 
        key="transcript-line" 
        x1={currentX - 10} 
        y1={y + exonH/2}
        x2={currentX + totalTranscriptWidth + 30} 
        y2={y + exonH/2}
        stroke="#e2e8f0" 
        strokeWidth={2} 
      />
    );
    
    // 左基因外显子
    for (let i = 0; i < leftKeptExons; i++) {
      elements.push(
        <rect
          key={`left-exon-${i}`}
          x={currentX}
          y={y}
          width={exonW}
          height={exonH}
          fill="#dc2626"
          stroke="#b91c1c"
          strokeWidth={1}
          rx={4}
        />
      );
      if (exonW > 22) {
        elements.push(
          <text
            key={`left-num-${i}`}
            x={currentX + exonW/2}
            y={y + exonH/2 + 5}
            fontSize="11"
            fill="white"
            textAnchor="middle"
            fontWeight="bold"
          >
            {i + 1}
          </text>
        );
      }
      currentX += exonW + gapW;
    }
    
    // 断点标记
    const breakX = currentX - gapW/2;
    elements.push(
      <g key="breakpoint-marker">
        <line
          x1={breakX}
          y1={y - 18}
          x2={breakX}
          y2={y + exonH + 10}
          stroke="#6366f1"
          strokeWidth={2.5}
          strokeDasharray="5,3"
        />
        <text
          x={breakX}
          y={y - 24}
          fontSize="11"
          fill="#6366f1"
          textAnchor="middle"
          fontWeight="bold"
        >
          断点
        </text>
      </g>
    );
    
    // 右基因外显子
    for (let i = 0; i < rightKeptExons; i++) {
      const exonNum = currentRightExon + i;
      elements.push(
        <rect
          key={`right-exon-${i}`}
          x={currentX}
          y={y}
          width={exonW}
          height={exonH}
          fill="#2563eb"
          stroke="#1d4ed8"
          strokeWidth={1}
          rx={4}
        />
      );
      if (exonW > 22) {
        elements.push(
          <text
            key={`right-num-${i}`}
            x={currentX + exonW/2}
            y={y + exonH/2 + 5}
            fontSize="11"
            fill="white"
            textAnchor="middle"
            fontWeight="bold"
          >
            {exonNum}
          </text>
        );
      }
      currentX += exonW + gapW;
    }
    
    // 基因标签 - 放在外显子下方
    const leftCenter = startX + (leftKeptExons * (exonW + gapW) - gapW) / 2;
    const rightCenter = breakX + gapW + (rightKeptExons * (exonW + gapW) - gapW) / 2;
    
    elements.push(
      <g key="gene-labels">
        <rect
          x={leftCenter - 40}
          y={y + exonH + 14}
          width={80}
          height={24}
          fill="#fef2f2"
          stroke="#dc2626"
          strokeWidth={1.5}
          rx={6}
        />
        <text
          x={leftCenter}
          y={y + exonH + 31}
          fontSize="12"
          fill="#dc2626"
          textAnchor="middle"
          fontWeight="bold"
        >
          {leftGene}
        </text>
        
        <rect
          x={rightCenter - 45}
          y={y + exonH + 14}
          width={90}
          height={24}
          fill="#eff6ff"
          stroke="#2563eb"
          strokeWidth={1.5}
          rx={6}
        />
        <text
          x={rightCenter}
          y={y + exonH + 31}
          fontSize="12"
          fill="#2563eb"
          textAnchor="middle"
          fontWeight="bold"
        >
          {rightGene}
        </text>
      </g>
    );
    
    return elements;
  };

  // 计算SVG实际需要的高度
  const svgHeight = transcriptY + 120;

  return (
    <div className="relative">
      {/* ========== 右上角变体列表 ========== */}
      <div 
        className="absolute bg-white border border-slate-200 rounded-lg shadow-sm p-3 z-10 overflow-y-auto"
        style={{ top: 10, right: 10, maxHeight: svgHeight - 40, width: 175 }}
      >
        <div className="text-xs font-bold text-slate-600 mb-2 pb-1.5 border-b border-slate-200">
          变体列表 (点击选择)
        </div>
        <div className="space-y-0.5">
          {parsedRows.map((row, index) => {
            const isSelected = selectedRow && selectedRow.id === row.id;
            const isHovered = hoveredVariant === index;
            return (
              <div
                key={`legend-${row.id || index}`}
                className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-all ${
                  isSelected 
                    ? 'bg-blue-50 border border-blue-300' 
                    : isHovered 
                      ? 'bg-slate-50' 
                      : 'hover:bg-slate-50'
                }`}
                onClick={() => onSelectVariant && onSelectVariant(row)}
                onMouseEnter={() => setHoveredVariant(index)}
                onMouseLeave={() => setHoveredVariant(null)}
              >
                <div 
                  className="flex-shrink-0 rounded"
                  style={{ 
                    backgroundColor: getVariantColor(index),
                    width: 16,
                    height: isSelected ? 4 : 2
                  }}
                />
                <span className={`text-xs ${isSelected ? 'font-bold text-blue-700' : 'text-slate-600'}`}>
                  变体 {index + 1} (E{row.leftExon}→E{row.rightExon})
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <svg width={svgWidth} height={svgHeight} className="bg-white rounded-lg">
        <defs>
          <filter id="shadow">
            <feDropShadow dx="0" dy="1" stdDeviation="2" floodOpacity="0.1" />
          </filter>
          <filter id="glow">
            <feGaussianBlur stdDeviation="2" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="chrGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#e2e8f0" />
            <stop offset="50%" stopColor="#94a3b8" />
            <stop offset="100%" stopColor="#e2e8f0" />
          </linearGradient>
        </defs>

        {/* 标题 */}
        <text x={svgWidth/2} y={titleY} fontSize="16" fill="#1e293b" textAnchor="middle" fontWeight="bold">
          {leftGene}::{rightGene} 融合基因结构图
        </text>

        {/* 左侧染色体 */}
        <g>
          <text x={leftX} y={chrY - 10} fontSize="13" fill="#475569" fontWeight="bold">
            染色体 {leftChr}
          </text>
          <rect
            x={leftX}
            y={chrY}
            width={geneWidth}
            height={22}
            fill="url(#chrGradient)"
            stroke="#94a3b8"
            strokeWidth="1"
            rx="11"
          />
          <text
            x={leftX + geneWidth - 35}
            y={chrY + 15}
            fontSize="11"
            fill="#475569"
            textAnchor="middle"
            fontWeight="bold"
          >
            {leftBand}
          </text>
        </g>

        {/* 右侧染色体 */}
        <g>
          <text x={rightX} y={chrY - 10} fontSize="13" fill="#475569" fontWeight="bold">
            染色体 {rightChr}
          </text>
          <rect
            x={rightX}
            y={chrY}
            width={geneWidth}
            height={22}
            fill="url(#chrGradient)"
            stroke="#94a3b8"
            strokeWidth="1"
            rx="11"
          />
          <text
            x={rightX + 35}
            y={chrY + 15}
            fontSize="11"
            fill="#475569"
            textAnchor="middle"
            fontWeight="bold"
          >
            {rightBand}
          </text>
        </g>

        {/* 左侧基因 */}
        <g>
          {drawGeneWithExons(leftX, geneY, geneWidth, geneHeight, '#dc2626', totalExons, currentLeftExon, true)}
          <text x={leftX} y={geneY + geneHeight + 22} fontSize="15" fill="#dc2626" fontWeight="bold">
            {leftGene}
          </text>
          <text x={leftX + 80} y={geneY + geneHeight + 22} fontSize="11" fill="#94a3b8">
            5' → 3'
          </text>
        </g>

        {/* 右侧基因 */}
        <g>
          {drawGeneWithExons(rightX, geneY, geneWidth, geneHeight, '#2563eb', totalExons, currentRightExon, false)}
          <text x={rightX} y={geneY + geneHeight + 22} fontSize="15" fill="#2563eb" fontWeight="bold">
            {rightGene}
          </text>
          <text x={rightX + 100} y={geneY + geneHeight + 22} fontSize="11" fill="#94a3b8">
            5' → 3'
          </text>
        </g>

        {/* ========== 绘制弧线 - 上下交替，间距更大 ========== */}
        {parsedRows.map((row, index) => {
          const color = getVariantColor(index);
          const isSelected = selectedRow && selectedRow.id === row.id;
          const isHovered = hoveredVariant === index;

          const displayColor = isSelected || isHovered ? color : '#d1d5db';
          const strokeWidth = isSelected ? 4 : isHovered ? 3 : 1.5;
          const opacity = isSelected ? 1 : isHovered ? 0.9 : 0.35;

          // 弧线起止点
          const leftExonRatio = row.leftExon / totalExons;
          const rightExonRatio = row.rightExon / totalExons;
          const leftArcX = leftX + leftExonRatio * geneWidth;
          const rightArcX = rightX + rightExonRatio * geneWidth;

          // 上下交替 - 增加间距
          const isAbove = index % 2 === 0;
          const layerIndex = Math.floor(index / 2);
          const baseOffset = 70 + layerIndex * 35;  // 增加层间距
          
          const arcControlY = isAbove 
            ? chrY - baseOffset 
            : geneY + geneHeight + 45 + baseOffset;

          // 弧线路径
          const startY = isAbove ? geneY : geneY + geneHeight;
          const endY = isAbove ? geneY : geneY + geneHeight;
          
          const path = `M ${leftArcX} ${startY} 
                        Q ${(leftArcX + rightArcX) / 2} ${arcControlY}, 
                          ${rightArcX} ${endY}`;

          return (
            <g key={`arc-${row.id || index}`}>
              <path
                d={path}
                fill="none"
                stroke={displayColor}
                strokeWidth={strokeWidth}
                opacity={opacity}
                strokeLinecap="round"
                style={{ cursor: 'pointer', transition: 'all 0.15s ease' }}
                filter={isSelected ? 'url(#glow)' : 'none'}
                onMouseEnter={(e) => {
                  setHoveredVariant(index);
                  const rect = e.currentTarget.getBoundingClientRect();
                  setTooltipData({ 
                    x: rect.left + rect.width / 2, 
                    y: isAbove ? rect.top : rect.bottom, 
                    row, 
                    index,
                    isAbove
                  });
                }}
                onMouseLeave={() => {
                  setHoveredVariant(null);
                  setTooltipData(null);
                }}
                onClick={() => onSelectVariant && onSelectVariant(row)}
              />

              {/* 选中或悬停时只显示断点圆点 */}
              {(isSelected || isHovered) && (
                <>
                  <circle
                    cx={leftArcX}
                    cy={startY}
                    r={isSelected ? 7 : 5}
                    fill={color}
                    stroke="white"
                    strokeWidth={2}
                    filter="url(#shadow)"
                  />
                  <circle
                    cx={rightArcX}
                    cy={endY}
                    r={isSelected ? 7 : 5}
                    fill={color}
                    stroke="white"
                    strokeWidth={2}
                    filter="url(#shadow)"
                  />
                </>
              )}
            </g>
          );
        })}

        {/* 融合转录本标题 */}
        <text x={leftX} y={transcriptY - 30} fontSize="13" fill="#475569" fontWeight="bold">
          融合转录本 (Fusion Transcript)
        </text>
        
        {/* 融合转录本 */}
        {drawFusionTranscript()}
      </svg>

      {/* 悬停提示框 - 包含断点坐标 */}
      {tooltipData && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{
            left: tooltipData.x,
            top: tooltipData.isAbove ? tooltipData.y - 10 : tooltipData.y + 10,
            transform: tooltipData.isAbove ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
          }}
        >
          <div className="bg-slate-800 text-white px-4 py-3 rounded-lg shadow-xl text-xs min-w-[200px]">
            <div className="font-bold mb-2 pb-1.5 border-b border-slate-600 flex items-center gap-2">
              <div 
                className="w-3 h-3 rounded-full" 
                style={{ backgroundColor: getVariantColor(tooltipData.index) }}
              />
              变体 {tooltipData.index + 1}
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-400">外显子:</span>
                <span className="text-green-300 font-bold">E{tooltipData.row.leftExon} → E{tooltipData.row.rightExon}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">左断点:</span>
                <span className="text-amber-300 font-mono text-xs">{tooltipData.row.leftParsed?.display || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">右断点:</span>
                <span className="text-cyan-300 font-mono text-xs">{tooltipData.row.rightParsed?.display || 'N/A'}</span>
              </div>
              {tooltipData.row.prot_fusion_type && (
                <div className="flex justify-between">
                  <span className="text-slate-400">类型:</span>
                  <span className="text-purple-300">{tooltipData.row.prot_fusion_type}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 当前选中变体信息 */}
      {selectedRow && currentVariant && (
        <div className="mt-4 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
          <div className="flex items-center gap-3 mb-3">
            <div 
              className="w-4 h-4 rounded-full" 
              style={{ backgroundColor: getVariantColor(parsedRows.findIndex(r => r.id === selectedRow.id)) }}
            />
            <span className="font-bold text-blue-800">
              当前选中: 变体 {parsedRows.findIndex(r => r.id === selectedRow.id) + 1}
            </span>
            <span className="px-2 py-1 bg-blue-600 text-white rounded text-xs font-mono">
              ID: {selectedRow.id}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div className="bg-white rounded-lg px-4 py-3 border border-slate-200">
              <span className="text-slate-500 text-xs block mb-1">左断点</span>
              <span className="font-mono text-amber-700 font-bold">
                {currentVariant.leftParsed?.display || 'N/A'}
              </span>
            </div>
            <div className="bg-white rounded-lg px-4 py-3 border border-slate-200">
              <span className="text-slate-500 text-xs block mb-1">右断点</span>
              <span className="font-mono text-cyan-700 font-bold">
                {currentVariant.rightParsed?.display || 'N/A'}
              </span>
            </div>
            <div className="bg-white rounded-lg px-4 py-3 border border-slate-200">
              <span className="text-slate-500 text-xs block mb-1">融合外显子</span>
              <span className="font-mono text-green-700 font-bold">
                {leftGene} E1-E{currentLeftExon} + {rightGene} E{currentRightExon}-E{totalExons}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MultiVariantFusionDiagram;