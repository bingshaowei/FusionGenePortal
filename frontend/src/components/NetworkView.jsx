// NetworkView.jsx - 修复版：箭头固定大小、放置在线中间

import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { useLanguage } from '../contexts/LanguageContext';

const NetworkView = ({ data }) => {
  const containerRef = useRef();
  const svgRef = useRef();
  const [dimensions, setDimensions] = useState({ width: 1000, height: 700 });
  const { t } = useLanguage();
  const N = t.network;
  // Capture for use inside d3 callbacks
  const totalFqLabel = N.tooltipTotalFq;
  const connectionsLabel = N.tooltipConnections;
  const centerLabel = N.tooltipCenter;

  // 响应式尺寸
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const { width } = containerRef.current.getBoundingClientRect();
        setDimensions({
          width: Math.max(800, width - 40),
          height: 700
        });
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  useEffect(() => {
    if (!data || data.length === 0) return;

    // 清除之前的内容
    d3.select(svgRef.current).selectAll('*').remove();

    const { width, height } = dimensions;
    const margin = { top: 20, right: 20, bottom: 20, left: 20 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    // 创建 SVG
    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height);

    // 添加缩放功能的容器
    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const zoom = d3.zoom()
      .scaleExtent([0.3, 3])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);

    // 【修复】辅助函数：清理基因名 - 只保留纯基因名，去掉所有后缀
    const cleanGeneName = (gene) => {
      if (!gene) return '';
      let cleaned = gene;
      // 去掉 ^ENSG... 部分
      cleaned = cleaned.split('^')[0];
      // 去掉 ENSG 前缀（如果有）
      cleaned = cleaned.replace(/ENSG\d+_/g, '');
      cleaned = cleaned.replace(/\^ENS[GT]\d+/g, '');
      // 【关键修复】去掉任何 .数字 后缀
      cleaned = cleaned.replace(/\.\d+$/, '');
      return cleaned.trim();
    };

    // ==================== 数据处理 ====================
    
    // 【修复】统计每个融合基因对的出现次数（按 fusion_name 统计）
    const fusionCounts = new Map(); // fusion_name -> count
    const geneStats = new Map();    // gene -> { totalFq, connections }
    
    // 先按 fusion_name 分组统计
    data.forEach(d => {
      const fusionName = d.fusion_name || '';
      if (!fusionName) return;
      
      // 统计每个 fusion_name 的出现次数（数据条数）
      fusionCounts.set(fusionName, (fusionCounts.get(fusionName) || 0) + 1);
    });

    // 按基因对统计
    const edgeStats = new Map(); // "geneA->geneB" -> { count, fq }
    
    // 使用 fusion_name 去重统计
    const processedFusions = new Set();
    
    data.forEach(d => {
      const fusionName = d.fusion_name || '';
      if (!fusionName || processedFusions.has(fusionName)) return;
      processedFusions.add(fusionName);
      
      const leftGene = cleanGeneName(d.left_gene || '');
      const rightGene = cleanGeneName(d.right_gene || '');
      const fq = d.fq || 1; // 这个 fq 已经是总和了
      
      if (!leftGene || !rightGene || leftGene === rightGene) return;

      // 更新基因统计
      if (!geneStats.has(leftGene)) {
        geneStats.set(leftGene, { totalFq: 0, connectionCount: 0, connections: new Set() });
      }
      if (!geneStats.has(rightGene)) {
        geneStats.set(rightGene, { totalFq: 0, connectionCount: 0, connections: new Set() });
      }

      const leftStats = geneStats.get(leftGene);
      const rightStats = geneStats.get(rightGene);
      
      leftStats.totalFq += fq;
      rightStats.totalFq += fq;
      
      leftStats.connections.add(rightGene);
      rightStats.connections.add(leftGene);

      // 【关键修复】统计有向边的次数（fq）
      const edgeKey = `${leftGene}->${rightGene}`;
      
      if (!edgeStats.has(edgeKey)) {
        edgeStats.set(edgeKey, { 
          source: leftGene, 
          target: rightGene, 
          count: 0  // 这里存的是 fq 值
        });
      }
      
      edgeStats.get(edgeKey).count += fq;
    });

    // 更新连接数
    geneStats.forEach((stats, gene) => {
      stats.connectionCount = stats.connections.size;
    });

    // 找出连接数最多的基因（中心基因）
    let maxConnections = 0;
    let centerGenes = new Set();
    
    geneStats.forEach((stats, gene) => {
      if (stats.connectionCount > maxConnections) {
        maxConnections = stats.connectionCount;
        centerGenes = new Set([gene]);
      } else if (stats.connectionCount === maxConnections) {
        centerGenes.add(gene);
      }
    });

    // 创建节点数组
    const nodes = Array.from(geneStats.entries()).map(([id, stats]) => ({
      id,
      totalFq: stats.totalFq,
      connectionCount: stats.connectionCount,
      isCenter: centerGenes.has(id)
    }));

    // 【关键修复】合并双向边，记录各自的次数
    const linkMap = new Map();
    edgeStats.forEach((edge, key) => {
      const reverseKey = `${edge.target}->${edge.source}`;
      const sortedKey = edge.source < edge.target 
        ? `${edge.source}<->${edge.target}` 
        : `${edge.target}<->${edge.source}`;
      
      if (!linkMap.has(sortedKey)) {
        linkMap.set(sortedKey, {
          source: edge.source < edge.target ? edge.source : edge.target,
          target: edge.source < edge.target ? edge.target : edge.source,
          forwardCount: 0,   // A->B 的次数
          backwardCount: 0,  // B->A 的次数
          forwardLabel: '',  // A->B 的标签
          backwardLabel: '', // B->A 的标签
          bidirectional: false
        });
      }
      
      const link = linkMap.get(sortedKey);
      if (edge.source < edge.target) {
        link.forwardCount = edge.count;
        link.forwardLabel = `${edge.source}→${edge.target}`;
      } else {
        link.backwardCount = edge.count;
        link.backwardLabel = `${edge.source}→${edge.target}`;
      }
      
      // 检查是否有反向边
      if (edgeStats.has(reverseKey)) {
        link.bidirectional = true;
      }
    });

    // 转换为链接数组
    const links = Array.from(linkMap.values()).map(link => ({
      source: link.source,
      target: link.target,
      // 【关键修复】线的大小按最大次数
      maxCount: Math.max(link.forwardCount, link.backwardCount),
      forwardCount: link.forwardCount,
      backwardCount: link.backwardCount,
      bidirectional: link.bidirectional
    }));

    // ==================== 比例尺 ====================
    
    const maxFq = d3.max(nodes, d => d.totalFq) || 1;
    const nodeRadiusScale = d3.scaleSqrt()
      .domain([1, maxFq])
      .range([15, 40])
      .clamp(true);

    // 【关键修复】线条粗细按次数
    const maxCount = d3.max(links, d => d.maxCount) || 1;
    const strokeScale = d3.scaleLinear()
      .domain([1, maxCount])
      .range([2, 12])
      .clamp(true);

    // ==================== 创建力导向模拟 ====================
    
    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id(d => d.id).distance(140))
      .force('charge', d3.forceManyBody().strength(-400))
      .force('center', d3.forceCenter(innerWidth / 2, innerHeight / 2))
      .force('collision', d3.forceCollide().radius(d => nodeRadiusScale(d.totalFq) + 15))
      .force('x', d3.forceX(innerWidth / 2).strength(0.05))
      .force('y', d3.forceY(innerHeight / 2).strength(0.05));

    // ==================== 【不再使用marker，改用手动绘制箭头】 ====================

    // ==================== 绘制连接线 ====================
    
    const link = g.append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(links)
      .enter()
      .append('line')
      .attr('stroke', d => d.bidirectional ? '#ec4899' : '#6366f1')
      .attr('stroke-width', d => strokeScale(d.maxCount))
      .attr('stroke-opacity', 0.7);
    // 不再使用 marker-end 和 marker-start

    // 【新增】手动绘制箭头的组
    const arrowGroup = g.append('g')
      .attr('class', 'arrows');

    // 固定箭头大小
    const ARROW_SIZE = 8;

    // 为每条边创建箭头
    const arrows = arrowGroup.selectAll('g')
      .data(links)
      .enter()
      .append('g');

    // 单向箭头（紫色）- 指向 target
    arrows.filter(d => !d.bidirectional)
      .append('path')
      .attr('d', `M0,${-ARROW_SIZE} L${ARROW_SIZE * 1.5},0 L0,${ARROW_SIZE} Z`)
      .attr('fill', '#6366f1')
      .attr('stroke', '#4338ca')
      .attr('stroke-width', 1);

    // 双向箭头（粉色）- 指向 target
    arrows.filter(d => d.bidirectional)
      .append('path')
      .attr('class', 'arrow-forward')
      .attr('d', `M0,${-ARROW_SIZE} L${ARROW_SIZE * 1.5},0 L0,${ARROW_SIZE} Z`)
      .attr('fill', '#ec4899')
      .attr('stroke', '#be185d')
      .attr('stroke-width', 1);

    // 双向箭头（粉色）- 指向 source
    arrows.filter(d => d.bidirectional)
      .append('path')
      .attr('class', 'arrow-backward')
      .attr('d', `M0,${-ARROW_SIZE} L${ARROW_SIZE * 1.5},0 L0,${ARROW_SIZE} Z`)
      .attr('fill', '#ec4899')
      .attr('stroke', '#be185d')
      .attr('stroke-width', 1);

    // 【关键修复】连接线标签 - 显示各方向的次数
    const linkLabel = g.append('g')
      .attr('class', 'link-labels')
      .selectAll('g')
      .data(links)
      .enter()
      .append('g');

    // 主标签（显示次数）
    linkLabel.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', d => d.bidirectional ? -12 : -8)
      .style('font-size', '12px')
      .style('fill', d => d.bidirectional ? '#be185d' : '#4338ca')
      .style('font-weight', 'bold')
      .style('pointer-events', 'none')
      .style('text-shadow', '0 0 4px white, 0 0 4px white, 0 0 4px white')
      .text(d => {
        if (d.bidirectional) {
          // 双向：显示两个方向的次数
          return `${d.forwardCount} ⇄ ${d.backwardCount}`;
        } else {
          // 单向：只显示次数（如果 > 1）
          const count = d.forwardCount || d.backwardCount;
          return count > 1 ? count : '';
        }
      });

    // ==================== 绘制节点 ====================
    
    const node = g.append('g')
      .attr('class', 'nodes')
      .selectAll('g')
      .data(nodes)
      .enter()
      .append('g')
      .call(d3.drag()
        .on('start', dragstarted)
        .on('drag', dragged)
        .on('end', dragended));

    // 节点圆圈
    node.append('circle')
      .attr('r', d => nodeRadiusScale(d.totalFq))
      .attr('fill', d => d.isCenter ? '#ef4444' : '#3b82f6')
      .attr('stroke', d => d.isCenter ? '#991b1b' : '#1e40af')
      .attr('stroke-width', 2.5)
      .style('cursor', 'pointer')
      .on('mouseover', function(event, d) {
        d3.select(this)
          .transition()
          .duration(200)
          .attr('r', nodeRadiusScale(d.totalFq) + 5)
          .attr('stroke-width', 3.5);
        
        // 高亮相关连接
        link.attr('stroke-opacity', l => 
          (l.source.id === d.id || l.target.id === d.id) ? 1 : 0.15
        );
        
        // 显示tooltip
        tooltip
          .style('opacity', 1)
          .html(`
            <strong style="font-size: 14px;">${d.id}</strong><br/>
            <span style="color: #059669;">${totalFqLabel}: ${d.totalFq}</span><br/>
            <span style="color: #2563eb;">${connectionsLabel}: ${d.connectionCount}</span>
            ${d.isCenter ? `<br/><span style="color:#ef4444; font-weight: bold;">${centerLabel}</span>` : ''}
          `)
          .style('left', (event.pageX + 15) + 'px')
          .style('top', (event.pageY - 15) + 'px');
      })
      .on('mouseout', function(event, d) {
        d3.select(this)
          .transition()
          .duration(200)
          .attr('r', nodeRadiusScale(d.totalFq))
          .attr('stroke-width', 2.5);
        
        link.attr('stroke-opacity', 0.7);
        tooltip.style('opacity', 0);
      });

    // 【修复】节点文本 - 只显示纯基因名
    node.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', d => nodeRadiusScale(d.totalFq) + 14)
      .style('font-size', '11px')
      .style('font-weight', 'bold')
      .style('fill', '#1f2937')
      .style('pointer-events', 'none')
      .style('text-shadow', '0 0 3px white, 0 0 3px white')
      .text(d => d.id); // 直接显示基因名，不截断

    // Tooltip
    const tooltip = d3.select('body').append('div')
      .attr('class', 'network-tooltip')
      .style('position', 'absolute')
      .style('background', 'white')
      .style('border', '2px solid #e5e7eb')
      .style('border-radius', '8px')
      .style('padding', '10px 14px')
      .style('font-size', '12px')
      .style('box-shadow', '0 4px 12px rgba(0,0,0,0.15)')
      .style('pointer-events', 'none')
      .style('opacity', 0)
      .style('z-index', 1000);

    // ==================== 更新位置 ====================
    
    simulation.on('tick', () => {
      // 限制节点在可视区域内
      nodes.forEach(d => {
        const r = nodeRadiusScale(d.totalFq);
        d.x = Math.max(r, Math.min(innerWidth - r, d.x));
        d.y = Math.max(r, Math.min(innerHeight - r, d.y));
      });

      link
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y);

      linkLabel
        .attr('transform', d => `translate(${(d.source.x + d.target.x) / 2}, ${(d.source.y + d.target.y) / 2})`);

      // 【关键修复】更新箭头位置 - 放在线的中间
      arrows.each(function(d) {
        const midX = (d.source.x + d.target.x) / 2;
        const midY = (d.source.y + d.target.y) / 2;
        const angle = Math.atan2(d.target.y - d.source.y, d.target.x - d.source.x) * 180 / Math.PI;
        
        if (d.bidirectional) {
          // 双向：两个箭头沿着线的方向分开
          const separation = 15; // 箭头之间的间距
          const offsetX = Math.cos(angle * Math.PI / 180) * separation;
          const offsetY = Math.sin(angle * Math.PI / 180) * separation;
          
          // 指向 target 的箭头（forward）- 放在中点靠近 target 的一侧
          d3.select(this).select('.arrow-forward')
            .attr('transform', `translate(${midX + offsetX}, ${midY + offsetY}) rotate(${angle})`);
          
          // 指向 source 的箭头（backward）- 放在中点靠近 source 的一侧，旋转180度
          d3.select(this).select('.arrow-backward')
            .attr('transform', `translate(${midX - offsetX}, ${midY - offsetY}) rotate(${angle + 180})`);
        } else {
          // 单向：箭头放在中间
          d3.select(this).select('path')
            .attr('transform', `translate(${midX}, ${midY}) rotate(${angle})`);
        }
      });

      node.attr('transform', d => `translate(${d.x},${d.y})`);
    });

    // ==================== 拖拽函数 ====================
    
    function dragstarted(event, d) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }

    function dragged(event, d) {
      d.fx = event.x;
      d.fy = event.y;
    }

    function dragended(event, d) {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }

    // 清理
    return () => {
      simulation.stop();
      tooltip.remove();
    };

  }, [data, dimensions]);

  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-96 bg-gray-50 rounded-lg">
        <div className="text-center">
          <div className="text-4xl mb-3">🌐</div>
          <p className="text-gray-600">{N.noData}</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="bg-white rounded-lg p-4 w-full overflow-hidden">
      <svg 
        ref={svgRef} 
        className="border border-gray-200 rounded w-full"
        style={{ maxWidth: '100%', height: dimensions.height }}
      />
      <div className="mt-4 space-y-3">
        {/* 图例 */}
        <div className="flex items-center gap-6 justify-center text-sm flex-wrap">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-red-500 border-2 border-red-800"></div>
            <span className="text-gray-700 font-medium">{N.legendCenter}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-blue-500 border-2 border-blue-800"></div>
            <span className="text-gray-700 font-medium">{N.legendNormal}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-16 h-2 bg-indigo-500 rounded relative">
              <div className="absolute right-0 top-1/2 transform -translate-y-1/2 translate-x-1 w-0 h-0 border-l-8 border-l-indigo-500 border-y-4 border-y-transparent"></div>
            </div>
            <span className="text-gray-700 font-medium">{N.legendUnidirectional}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-16 h-2 bg-pink-500 rounded relative">
              <div className="absolute left-0 top-1/2 transform -translate-y-1/2 -translate-x-1 w-0 h-0 border-r-8 border-r-pink-500 border-y-4 border-y-transparent"></div>
              <div className="absolute right-0 top-1/2 transform -translate-y-1/2 translate-x-1 w-0 h-0 border-l-8 border-l-pink-500 border-y-4 border-y-transparent"></div>
            </div>
            <span className="text-gray-700 font-medium">{N.legendBidirectional}</span>
          </div>
        </div>
        
        {/* 说明 */}
        <div className="bg-purple-50 rounded-lg p-3">
          <p className="text-center text-xs text-purple-800"
            dangerouslySetInnerHTML={{ __html: N.hint }}
          />
        </div>
      </div>
    </div>
  );
};

export default NetworkView;