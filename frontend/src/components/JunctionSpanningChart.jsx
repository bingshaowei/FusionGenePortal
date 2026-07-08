// JunctionSpanningChart.jsx - Junction/Spanning Fragment Count 柱状图组件（Log2 缩放版）

import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { useLanguage } from '../contexts/LanguageContext';

const JunctionSpanningChart = ({ data, onFusionClick, useLog2Scale = true }) => {
  const svgRef = useRef();
  const containerRef = useRef();
  const tooltipRef = useRef(null);
  const { t } = useLanguage();
  const J = t.junction;
  // Capture for use inside d3 callbacks
  const clickDetailText = J.tooltipClickDetail;

  useEffect(() => {
    if (!data || data.length === 0) return;

    // 清除之前的内容
    d3.select(svgRef.current).selectAll('*').remove();
    
    // 移除之前的 tooltip
    if (tooltipRef.current) {
      tooltipRef.current.remove();
      tooltipRef.current = null;
    }

    // 自适应宽度：取容器宽度，最小800
    const containerWidth = containerRef.current ? containerRef.current.clientWidth : 1200;
    const totalWidth = Math.max(800, containerWidth - 16);

    // 设置尺寸
    const margin = { top: 65, right: 30, bottom: 140, left: 80 };
    const width = totalWidth - margin.left - margin.right;
    const height = 600 - margin.top - margin.bottom;

    // 创建 SVG
    const svg = d3.select(svgRef.current)
      .attr('width', width + margin.left + margin.right)
      .attr('height', height + margin.top + margin.bottom)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // 准备数据 - 处理重名（同一融合名来自 PASS 和 FILTER 时加后缀区分）
    const nameCount = {};
    data.forEach(d => {
      const n = d.fusion_name || 'Unknown';
      nameCount[n] = (nameCount[n] || 0) + 1;
    });

    const chartData = data.map(d => {
      const junction = d.avg_junction_read_count || 0;
      const spanning = d.avg_spanning_frag_count || 0;
      const total = junction + spanning;
      
      // log2 转换策略：
      //   totalLog = log2(total+1)，控制整体柱高，保证总值大的柱一定更高（不改动）
      //   junction 和 spanning 各自独立 log2，再按两者 log2 之比瓜分 totalLog：
      //     这样 junction 值越大蓝色段越高（单调性正确），
      //     绿色段视觉比例也合理（不会因为按原始比例分配 log 而压缩失真）
      const totalLog = useLog2Scale ? Math.log2(total + 1) : total;
      let junctionLog, spanningLog;
      if (useLog2Scale) {
        const jRaw = Math.log2(junction + 1);
        const sRaw = Math.log2(spanning + 1);
        const sumRaw = jRaw + sRaw;
        junctionLog = sumRaw > 0 ? totalLog * (jRaw / sumRaw) : 0;
        spanningLog = sumRaw > 0 ? totalLog * (sRaw / sumRaw) : 0;
      } else {
        junctionLog = junction;
        spanningLog = spanning;
      }

      const rawName = d.fusion_name || 'Unknown';
      const source = d._source || 'pass';
      // 如果同名有多条（来自不同数据源），加后缀区分
      const displayName = nameCount[rawName] > 1 ? `${rawName} (${source === 'deleted' ? 'FILTER' : 'PASS'})` : rawName;
      
      return {
        name: displayName,
        fusionName: rawName,           // 原始名用于路由跳转
        _source: source,
        junction: junction,
        spanning: spanning,
        total: total,
        junctionLog: junctionLog,
        spanningLog: spanningLog,
        totalLog: totalLog
      };
    });

    // X 比例尺
    const x = d3.scaleBand()
      .domain(chartData.map(d => d.name))
      .range([0, width])
      .padding(0.2);

    // Y 比例尺 - 使用 log2 值
    const maxLog = d3.max(chartData, d => d.totalLog) || 1;
    const y = d3.scaleLinear()
      .domain([0, maxLog * 1.15])
      .range([height, 0]);

    // 添加网格线
    svg.append('g')
      .attr('class', 'grid')
      .call(d3.axisLeft(y)
        .tickSize(-width)
        .tickFormat('')
      )
      .style('stroke', '#e0e0e0')
      .style('stroke-dasharray', '3,3')
      .style('stroke-opacity', 0.7);

    // 创建 tooltip（需在 X 轴之前，供标签悬停使用）
    const tooltip = d3.select('body').append('div')
      .attr('class', 'junction-chart-tooltip')
      .style('position', 'absolute')
      .style('background', 'rgba(0,0,0,0.85)')
      .style('color', 'white')
      .style('padding', '10px 14px')
      .style('border-radius', '6px')
      .style('font-size', '12px')
      .style('pointer-events', 'none')
      .style('opacity', 0)
      .style('z-index', 10000)
      .style('box-shadow', '0 4px 6px rgba(0,0,0,0.3)');
    
    tooltipRef.current = tooltip.node();

    // 添加 X 轴
    const xAxisGroup = svg.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x));

    // X 轴文字样式 - 可点击，FILTER来源用橙色
    xAxisGroup.selectAll('text')
      .attr('transform', 'rotate(-45)')
      .style('text-anchor', 'end')
      .style('font-size', '10px')
      .style('cursor', 'pointer')
      .each(function(d) {
        const text = d3.select(this);
        const item = chartData.find(c => c.name === d);
        const isDeleted = item && item._source === 'deleted';
        text.style('fill', isDeleted ? '#d97706' : '#2563eb');
        const textContent = text.text();
        if (textContent.length > 20) {
          text.text(textContent.substring(0, 17) + '...');
        }
      })
      .on('click', function(event, d) {
        event.stopPropagation();
        if (onFusionClick && d) {
          const item = chartData.find(c => c.name === d);
          // 用原始 fusionName 做路由跳转，不是带后缀的 displayName
          onFusionClick(item?.fusionName || d, item?._source || 'pass');
        }
      })
      .on('mouseover', function(event, d) {
        d3.select(this)
          .style('font-weight', 'bold')
          .style('text-decoration', 'underline');
        // 显示完整名称 tooltip
        tooltip
          .style('opacity', 1)
          .html(`<div style="font-weight:bold;">${d}</div>`)
          .style('left', (event.pageX + 15) + 'px')
          .style('top', (event.pageY - 10) + 'px');
      })
      .on('mousemove', function(event) {
        tooltip
          .style('left', (event.pageX + 15) + 'px')
          .style('top', (event.pageY - 10) + 'px');
      })
      .on('mouseout', function() {
        d3.select(this)
          .style('font-weight', 'normal')
          .style('text-decoration', 'none');
        tooltip.style('opacity', 0);
      });

    // 添加 Y 轴
    svg.append('g')
      .call(d3.axisLeft(y).tickFormat(d => d.toFixed(1)))
      .append('text')
      .attr('transform', 'rotate(-90)')
      .attr('y', -60)
      .attr('x', -height / 2)
      .attr('fill', '#1f2937')
      .style('text-anchor', 'middle')
      .style('font-size', '14px')
      .style('font-weight', 'bold')
      .text(useLog2Scale ? 'Read Count (log₂ scale)' : 'Read Count');

    // tooltip 已在 X 轴之前创建

    // 绘制 Junction 柱子（底部，蓝色）
    svg.selectAll('.bar-junction')
      .data(chartData)
      .enter()
      .append('rect')
      .attr('class', 'bar-junction')
      .attr('x', d => x(d.name))
      .attr('y', d => y(d.junctionLog))
      .attr('width', x.bandwidth())
      .attr('height', d => Math.max(0, height - y(d.junctionLog)))
      .attr('fill', '#3b82f6')
      .attr('opacity', 0.85)
      .style('cursor', 'pointer')
      .on('mouseover', function(event, d) {
        d3.select(this).attr('opacity', 1).attr('stroke', '#1d4ed8').attr('stroke-width', 2);
        tooltip
          .style('opacity', 1)
          .html(`
            <div style="font-weight:bold;margin-bottom:6px;color:#60a5fa">${d.name}</div>
            <div>Junction Reads: <strong>${d.junction.toFixed(1)}</strong></div>
            <div style="color:#9ca3af;font-size:10px;margin-top:4px">${clickDetailText}</div>
          `)
          .style('left', (event.pageX + 15) + 'px')
          .style('top', (event.pageY - 10) + 'px');
      })
      .on('mousemove', function(event) {
        tooltip
          .style('left', (event.pageX + 15) + 'px')
          .style('top', (event.pageY - 10) + 'px');
      })
      .on('mouseout', function() {
        d3.select(this).attr('opacity', 0.85).attr('stroke', 'none');
        tooltip.style('opacity', 0);
      })
      .on('click', function(event, d) {
        event.stopPropagation();
        if (onFusionClick && d.fusionName) {
          onFusionClick(d.fusionName, d._source || 'pass');
        }
      });

    // 绘制 Spanning 柱子（顶部，绿色）- 堆叠在 Junction 上方
    svg.selectAll('.bar-spanning')
      .data(chartData)
      .enter()
      .append('rect')
      .attr('class', 'bar-spanning')
      .attr('x', d => x(d.name))
      .attr('y', d => y(d.totalLog))
      .attr('width', x.bandwidth())
      .attr('height', d => Math.max(0, y(d.junctionLog) - y(d.totalLog)))
      .attr('fill', '#10b981')
      .attr('opacity', 0.85)
      .style('cursor', 'pointer')
      .on('mouseover', function(event, d) {
        d3.select(this).attr('opacity', 1).attr('stroke', '#059669').attr('stroke-width', 2);
        tooltip
          .style('opacity', 1)
          .html(`
            <div style="font-weight:bold;margin-bottom:6px;color:#34d399">${d.name}</div>
            <div>Spanning Fragments: <strong>${d.spanning.toFixed(1)}</strong></div>
            <div style="color:#9ca3af;font-size:10px;margin-top:4px">${clickDetailText}</div>
          `)
          .style('left', (event.pageX + 15) + 'px')
          .style('top', (event.pageY - 10) + 'px');
      })
      .on('mousemove', function(event) {
        tooltip
          .style('left', (event.pageX + 15) + 'px')
          .style('top', (event.pageY - 10) + 'px');
      })
      .on('mouseout', function() {
        d3.select(this).attr('opacity', 0.85).attr('stroke', 'none');
        tooltip.style('opacity', 0);
      })
      .on('click', function(event, d) {
        event.stopPropagation();
        if (onFusionClick && d.fusionName) {
          onFusionClick(d.fusionName, d._source || 'pass');
        }
      });

    // 添加 Junction 数值标签（柱内）- 显示原始值
    svg.selectAll('.label-junction')
      .data(chartData)
      .enter()
      .append('text')
      .attr('class', 'label-junction')
      .attr('x', d => x(d.name) + x.bandwidth() / 2)
      .attr('y', d => {
        const barHeight = height - y(d.junctionLog);
        return barHeight > 20 ? y(d.junctionLog) + barHeight / 2 + 4 : y(d.junctionLog) - 5;
      })
      .attr('text-anchor', 'middle')
      .attr('fill', d => (height - y(d.junctionLog)) > 20 ? 'white' : '#3b82f6')
      .style('font-size', '9px')
      .style('font-weight', 'bold')
      .style('pointer-events', 'none')
      .text(d => d.junction > 0 ? d.junction.toFixed(0) : '');

    // 添加 Spanning 数值标签（柱内）- 显示原始值
    svg.selectAll('.label-spanning')
      .data(chartData)
      .enter()
      .append('text')
      .attr('class', 'label-spanning')
      .attr('x', d => x(d.name) + x.bandwidth() / 2)
      .attr('y', d => {
        const barHeight = y(d.junctionLog) - y(d.totalLog);
        return barHeight > 20 ? y(d.totalLog) + barHeight / 2 + 4 : y(d.totalLog) - 5;
      })
      .attr('text-anchor', 'middle')
      .attr('fill', d => (y(d.junctionLog) - y(d.totalLog)) > 20 ? 'white' : '#10b981')
      .style('font-size', '9px')
      .style('font-weight', 'bold')
      .style('pointer-events', 'none')
      .text(d => d.spanning > 0 ? d.spanning.toFixed(0) : '');

    // 添加总计标签（柱上方）- 显示原始值
    svg.selectAll('.label-total')
      .data(chartData)
      .enter()
      .append('text')
      .attr('class', 'label-total')
      .attr('x', d => x(d.name) + x.bandwidth() / 2)
      .attr('y', d => y(d.totalLog) - 8)
      .attr('text-anchor', 'middle')
      .attr('fill', '#1f2937')
      .style('font-size', '10px')
      .style('font-weight', 'bold')
      .style('pointer-events', 'none')
      .text(d => d.total > 0 ? d.total.toFixed(0) : '');

    // 添加图例（上下排列）
    const legend = svg.append('g')
      .attr('transform', `translate(${width - 170}, -48)`);

    // Junction 图例（第一行）
    legend.append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', 16)
      .attr('height', 16)
      .attr('fill', '#3b82f6')
      .attr('opacity', 0.85)
      .attr('rx', 3);

    legend.append('text')
      .attr('x', 22)
      .attr('y', 13)
      .text('Junction Reads')
      .style('font-size', '12px')
      .attr('fill', '#1f2937');

    // Spanning 图例（第二行）
    legend.append('rect')
      .attr('x', 0)
      .attr('y', 22)
      .attr('width', 16)
      .attr('height', 16)
      .attr('fill', '#10b981')
      .attr('opacity', 0.85)
      .attr('rx', 3);

    legend.append('text')
      .attr('x', 22)
      .attr('y', 35)
      .text('Spanning Fragments')
      .style('font-size', '12px')
      .attr('fill', '#1f2937');

    // 添加标题（居中，与图例错开）
    svg.append('text')
      .attr('x', (width - 170) / 2)
      .attr('y', -28)
      .attr('text-anchor', 'middle')
      .style('font-size', '16px')
      .style('font-weight', 'bold')
      .attr('fill', '#1f2937')
      .text(useLog2Scale 
        ? 'Junction & Spanning Fragment Distribution (Log₂ Scale)' 
        : 'Junction & Spanning Fragment Distribution');

    // 清理函数
    return () => {
      if (tooltipRef.current) {
        tooltipRef.current.remove();
        tooltipRef.current = null;
      }
      d3.selectAll('.junction-chart-tooltip').remove();
    };

  }, [data, onFusionClick, useLog2Scale]);

  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-96 bg-gray-50 rounded-lg">
        <div className="text-center">
          <div className="text-4xl mb-3">📊</div>
          <p className="text-gray-600">{J.noData}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg p-4" ref={containerRef}>
      <div className="overflow-x-auto">
        <svg ref={svgRef}></svg>
      </div>
      <div className="mt-4 bg-blue-50 rounded-lg p-3">
        <p className="text-center text-sm text-blue-800"
          dangerouslySetInnerHTML={{ __html: J.hint + ' <span class="text-blue-600 font-semibold">' + J.hintClick + '</span>' }}
        />
      </div>
    </div>
  );
};

export default JunctionSpanningChart;