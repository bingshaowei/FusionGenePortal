import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { useLanguage } from '../contexts/LanguageContext';

const CircosChartInteractive = ({ fusions, onFusionClick, onChromosomeClick }) => {
  const svgRef = useRef(null);
  const [tooltip, setTooltip] = useState({ show: false, content: '', x: 0, y: 0 });
  const { t } = useLanguage();
  const C = t.circos;

  useEffect(() => {
    if (!fusions || fusions.length === 0) return;

    // 清除之前的内容
    d3.select(svgRef.current).selectAll('*').remove();

    const width = 900;
    const height = 900;
    const radius = Math.min(width, height) / 2 - 80;

    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${width / 2}, ${height / 2})`);

    // 染色体数据
    const chromosomes = [
      { name: 'chr1', length: 248956422, color: '#e74c3c' },
      { name: 'chr2', length: 242193529, color: '#3498db' },
      { name: 'chr3', length: 198295559, color: '#2ecc71' },
      { name: 'chr4', length: 190214555, color: '#f39c12' },
      { name: 'chr5', length: 181538259, color: '#9b59b6' },
      { name: 'chr6', length: 170805979, color: '#1abc9c' },
      { name: 'chr7', length: 159345973, color: '#e67e22' },
      { name: 'chr8', length: 145138636, color: '#34495e' },
      { name: 'chr9', length: 138394717, color: '#16a085' },
      { name: 'chr10', length: 133797422, color: '#27ae60' },
      { name: 'chr11', length: 135086622, color: '#2980b9' },
      { name: 'chr12', length: 133275309, color: '#8e44ad' },
      { name: 'chr13', length: 114364328, color: '#f1c40f' },
      { name: 'chr14', length: 107043718, color: '#c0392b' },
      { name: 'chr15', length: 101991189, color: '#95a5a6' },
      { name: 'chr16', length: 90338345, color: '#d35400' },
      { name: 'chr17', length: 83257441, color: '#e74c3c' },
      { name: 'chr18', length: 80373285, color: '#2c3e50' },
      { name: 'chr19', length: 58617616, color: '#7f8c8d' },
      { name: 'chr20', length: 64444167, color: '#16a085' },
      { name: 'chr21', length: 46709983, color: '#27ae60' },
      { name: 'chr22', length: 50818468, color: '#2980b9' },
      { name: 'chrX', length: 156040895, color: '#8e44ad' },
      { name: 'chrY', length: 57227415, color: '#f39c12' }
    ];

    const totalLength = d3.sum(chromosomes, d => d.length);

    // 创建比例尺
    let cumulativeLength = 0;
    const chrData = chromosomes.map(chr => {
      const start = cumulativeLength;
      const end = cumulativeLength + chr.length;
      cumulativeLength = end;
      return {
        ...chr,
        start,
        end,
        startAngle: (start / totalLength) * 2 * Math.PI,
        endAngle: (end / totalLength) * 2 * Math.PI
      };
    });

    // 绘制染色体弧
    const arc = d3.arc()
      .innerRadius(radius - 25)
      .outerRadius(radius);

    const chrGroups = svg.selectAll('.chromosome')
      .data(chrData)
      .enter()
      .append('g')
      .attr('class', 'chromosome');

    chrGroups.append('path')
      .attr('d', d => arc({
        startAngle: d.startAngle,
        endAngle: d.endAngle
      }))
      .attr('fill', d => d.color)
      .attr('opacity', 0.7)
      .attr('stroke', '#fff')
      .attr('stroke-width', 2)
      .style('cursor', 'pointer')
      .on('mouseover', function(event, d) {
        d3.select(this)
          .transition()
          .duration(200)
          .attr('opacity', 1)
          .attr('stroke-width', 4);
        
        // 统计当前搜索结果中该染色体的融合数量
        const chrFusionCount = fusions.filter(f => {
          const leftChr = f.left_breakpoint?.split(':')[0];
          const rightChr = f.right_breakpoint?.split(':')[0];
          return leftChr === d.name || rightChr === d.name;
        }).length;
        
        const rect = event.target.getBoundingClientRect();
        setTooltip({
          show: true,
          content: C.tooltipChr(d.name, chrFusionCount),
          x: rect.left + rect.width / 2,
          y: rect.top - 10
        });
      })
      .on('mouseout', function() {
        d3.select(this)
          .transition()
          .duration(200)
          .attr('opacity', 0.7)
          .attr('stroke-width', 2);
        
        setTooltip({ show: false, content: '', x: 0, y: 0 });
      })
      .on('click', function(event, d) {
        event.stopPropagation();
        if (onChromosomeClick) {
          onChromosomeClick(d.name);
        }
      });

    // 添加染色体标签
    chrGroups.append('text')
      .attr('transform', d => {
        const angle = (d.startAngle + d.endAngle) / 2 - Math.PI / 2;
        const x = Math.cos(angle) * (radius + 20);
        const y = Math.sin(angle) * (radius + 20);
        return `translate(${x}, ${y}) rotate(${angle * 180 / Math.PI + 90})`;
      })
      .attr('text-anchor', 'middle')
      .attr('font-size', '11px')
      .attr('font-weight', 'bold')
      .attr('fill', d => d.color)
      .style('pointer-events', 'none')
      .text(d => d.name.replace('chr', ''));

    // 辅助函数
    const parseBreakpoint = (breakpoint) => {
      if (!breakpoint) return null;
      const match = breakpoint.match(/(chr[^:]+):(\d+)/);
      if (!match) return null;
      return {
        chr: match[1],
        position: parseInt(match[2])
      };
    };

    const getAngle = (chrName, position) => {
      const chr = chrData.find(c => c.name === chrName);
      if (!chr) return null;
      const relativePos = position / chr.length;
      const angle = chr.startAngle + relativePos * (chr.endAngle - chr.startAngle);
      return angle;
    };

    // 绘制融合连接线
    const links = fusions
      .slice(0, 300)
      .map(fusion => {
        const left = parseBreakpoint(fusion.left_breakpoint);
        const right = parseBreakpoint(fusion.right_breakpoint);
        
        if (!left || !right) return null;
        
        const leftAngle = getAngle(left.chr, left.position);
        const rightAngle = getAngle(right.chr, right.position);
        
        if (leftAngle === null || rightAngle === null) return null;
        
        return {
          fusion,
          left: { angle: leftAngle, chr: left.chr },
          right: { angle: rightAngle, chr: right.chr },
          fq: fusion.fq || 0,
          ffpm: fusion.avg_ffpm || 0
        };
      })
      .filter(link => link !== null);

    // 【关键修复】更明确的颜色分级：fq=1 单独灰色
    const getColor = (fq) => {
      if (fq <= 1) return '#94a3b8';      // 灰色 - fq = 1
      if (fq <= 5) return '#3b82f6';      // 蓝色 - fq 2-5
      if (fq <= 10) return '#22c55e';     // 绿色 - fq 6-10
      if (fq <= 20) return '#f59e0b';     // 橙色 - fq 11-20
      if (fq <= 50) return '#f97316';     // 深橙 - fq 21-50
      return '#ef4444';                    // 红色 - fq > 50
    };

    // 绘制贝塞尔曲线
    links.forEach(link => {
      const x1 = Math.cos(link.left.angle - Math.PI / 2) * (radius - 30);
      const y1 = Math.sin(link.left.angle - Math.PI / 2) * (radius - 30);
      const x2 = Math.cos(link.right.angle - Math.PI / 2) * (radius - 30);
      const y2 = Math.sin(link.right.angle - Math.PI / 2) * (radius - 30);

      const strokeColor = getColor(link.fq);
      // 线条粗细也根据 fq 调整
      const strokeWidth = link.fq <= 1 ? 0.8 : Math.max(1, Math.min(5, Math.log2(link.fq) + 1));

      svg.append('path')
        .attr('d', `M ${x1},${y1} Q 0,0 ${x2},${y2}`)
        .attr('fill', 'none')
        .attr('stroke', strokeColor)
        .attr('stroke-width', strokeWidth)
        .attr('opacity', link.fq <= 1 ? 0.3 : 0.6)
        .attr('class', 'fusion-link')
        .style('cursor', 'pointer')
        .on('mouseover', function(event) {
          d3.select(this)
            .transition()
            .duration(200)
            .attr('stroke', '#ef4444')
            .attr('stroke-width', 4)
            .attr('opacity', 0.9);
          
          const rect = event.target.getBoundingClientRect();
          const fusionName = link.fusion.fusion_name || `${link.fusion.left_gene}-${link.fusion.right_gene}`;
          setTooltip({
            show: true,
            content: C.tooltipFusion(fusionName, link.fq, link.ffpm.toFixed(3)),
            x: rect.left + rect.width / 2,
            y: rect.top - 10
          });
        })
        .on('mouseout', function() {
          d3.select(this)
            .transition()
            .duration(200)
            .attr('stroke', strokeColor)
            .attr('stroke-width', strokeWidth)
            .attr('opacity', link.fq <= 1 ? 0.3 : 0.6);
          
          setTooltip({ show: false, content: '', x: 0, y: 0 });
        })
        .on('click', function(event) {
          event.stopPropagation();
          if (onFusionClick) {
            onFusionClick(link.fusion.id);
          }
        });
    });

  }, [fusions, onFusionClick, onChromosomeClick]);

  const displayCount = Math.min(fusions?.length || 0, 300);

  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <svg ref={svgRef}></svg>
        
        {tooltip.show && (
          <div
            className="fixed bg-gray-900 text-white px-3 py-2 rounded shadow-lg text-sm z-50 pointer-events-none max-w-xs"
            style={{
              left: `${tooltip.x}px`,
              top: `${tooltip.y}px`,
              transform: 'translate(-50%, -100%)'
            }}
          >
            {tooltip.content}
            <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 translate-y-full">
              <div className="border-8 border-transparent border-t-gray-900"></div>
            </div>
          </div>
        )}
      </div>

      {/* 【修复】更清晰的图例 */}
      <div className="mt-4 text-center space-y-3">
        <div className="text-lg font-bold text-gray-800">
          {C.legendTitle}
        </div>
        <div className="text-sm text-gray-600">
          {C.legendSubtitle(displayCount)}
        </div>
        
        {/* 更清晰的颜色图例 */}
        <div className="flex items-center justify-center gap-4 text-xs flex-wrap">
          <div className="flex items-center gap-1">
            <div className="w-6 h-1 bg-slate-400 rounded opacity-50"></div>
            <span className="text-gray-500">fq=1</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-6 h-1 bg-blue-500 rounded"></div>
            <span className="text-gray-600">fq 2-5</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-6 h-1 bg-green-500 rounded"></div>
            <span className="text-gray-600">fq 6-10</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-6 h-1 bg-amber-500 rounded"></div>
            <span className="text-gray-600">fq 11-20</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-6 h-1 bg-orange-500 rounded"></div>
            <span className="text-gray-600">fq 21-50</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-6 h-1 bg-red-500 rounded"></div>
            <span className="text-gray-600">fq &gt;50</span>
          </div>
        </div>
        
        <div className="text-xs text-gray-500">
          {C.legendTip}
        </div>
      </div>
    </div>
  );
};

export default CircosChartInteractive;