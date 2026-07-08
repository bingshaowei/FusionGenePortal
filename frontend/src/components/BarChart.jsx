// BarChart.jsx
import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

const BarChart = ({ fusions }) => {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current || !fusions.length) return;
    const chart = echarts.init(ref.current);

    const geneCount = {};
    fusions.forEach(f => {
      geneCount[f.leftGene] = (geneCount[f.leftGene] || 0) + 1;
      geneCount[f.rightGene] = (geneCount[f.rightGene] || 0) + 1;
    });

    const sorted = Object.entries(geneCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);

    const option = {
      title: { text: 'Top 20 融合基因频次' },
      tooltip: {},
      xAxis: { type: 'category', data: sorted.map(([gene]) => gene), axisLabel: { rotate: 45 } },
      yAxis: { type: 'value' },
      series: [{
        name: '出现次数',
        type: 'bar',
        data: sorted.map(([_, count]) => count),
        itemStyle: {
          color: '#69b3a2'
        }
      }]
    };

    chart.setOption(option);
    return () => chart.dispose();
  }, [fusions]);

  return <div ref={ref} style={{ width: '100%', height: '400px' }} />;
};

export default BarChart;
