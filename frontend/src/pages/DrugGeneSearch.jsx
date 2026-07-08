// src/pages/DrugGeneSearch.jsx
// Drug-Gene 药物敏感性搜索分析页面 — 完全独立，无 GDSCAnalysis 依赖
// 路由：<Route path="/drug-gene" element={<DrugGeneSearch />} />

import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import * as d3 from 'd3';
import { Search, FlaskConical, BarChart3, Info, AlertCircle, X, Dna, Layers, ChevronRight } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

// ─── Auth ────────────────────────────────────────────────────────────────
async function ensureToken() {
  let token = localStorage.getItem('token');
  if (token) {
    try {
      const p = JSON.parse(atob(token.split('.')[1]));
      if (p.exp && (p.exp - Math.floor(Date.now() / 1000) < 300)) token = null;
    } catch { token = null; }
  }
  if (!token) {
    try {
      const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin' }) });
      const d = await r.json(); token = d?.access_token;
      if (token) localStorage.setItem('token', token);
    } catch {}
  }
  return token;
}
async function fetchWithAuth(url, opts = {}, retries = 1) {
  const token = await ensureToken();
  const r = await fetch(url, { ...opts, headers: { ...opts.headers, Authorization: `Bearer ${token}` } });
  if (r.status === 401 && retries > 0) { localStorage.removeItem('token'); return fetchWithAuth(url, opts, retries - 1); }
  return r;
}

// ─── Statistics ──────────────────────────────────────────────────────────
const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
const variance = arr => { const m = mean(arr); return arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length; };
const std  = arr => Math.sqrt(variance(arr));

function logGamma(x) {
  const c = [76.18009172947146,-86.50532032941677,24.01409824083091,-1.231739572450155,0.001208650973866179,-0.000005395239384953];
  let y = x, tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp); let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += c[j] / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}
function cfBeta(a, b, x) {
  let am=1,bm=1,az=1; const qab=a+b,qap=a+1,qam=a-1; let bz=1-qab*x/qap;
  for (let m=1;m<=200;m++) {
    const em=m,tem=em*2; let d=em*(b-m)*x/((qam+tem)*(a+tem));
    const ap=az+d*am,bp=bz+d*bm; d=-(a+em)*(qab+em)*x/((a+tem)*(qap+tem));
    const app=ap+d*az,bpp=bp+d*bz,old=az; am=ap/bpp;bm=bp/bpp;az=app/bpp;bz=1;
    if (Math.abs(az-old)<1e-10*Math.abs(az)) return az;
  } return az;
}
function incompleteBeta(a, b, x) {
  if (x<=0) return 0; if (x>=1) return 1;
  const lb=logGamma(a)+logGamma(b)-logGamma(a+b);
  const front=Math.exp(Math.log(x)*a+Math.log(1-x)*b-lb);
  return x<(a+1)/(a+b+2) ? front*cfBeta(a,b,x)/a : 1-front*cfBeta(b,a,1-x)/b;
}
function tCDF(t, df) { return 1-0.5*incompleteBeta(df/2,0.5,df/(df+t*t)); }
function welchTTest(a, b) {
  if (a.length<2||b.length<2) return null;
  const n1=a.length,n2=b.length,m1=mean(a),m2=mean(b),v1=variance(a),v2=variance(b);
  const se=Math.sqrt(v1/n1+v2/n2); if (se===0) return null;
  const t=Math.abs((m1-m2)/se),df=(v1/n1+v2/n2)**2/((v1/n1)**2/(n1-1)+(v2/n2)**2/(n2-1));
  return { t, df, p: 2*(1-tCDF(t,df)) };
}
function pearsonCorrelation(x, y) {
  if (x.length!==y.length||x.length<3) return null;
  const n=x.length,sx=x.reduce((a,b)=>a+b,0),sy=y.reduce((a,b)=>a+b,0);
  const sxy=x.reduce((s,xi,i)=>s+xi*y[i],0),sx2=x.reduce((s,xi)=>s+xi*xi,0),sy2=y.reduce((s,yi)=>s+yi*yi,0);
  const num=n*sxy-sx*sy,den=Math.sqrt((n*sx2-sx*sx)*(n*sy2-sy*sy));
  if (den===0) return null;
  const r=num/den,t=r*Math.sqrt((n-2)/(1-r*r));
  return { r, p: 2*(1-tCDF(Math.abs(t),n-2)), n };
}
const sigStars = p => { if (p==null) return 'ns'; if (p<0.0001) return '****'; if (p<0.001) return '***'; if (p<0.01) return '**'; if (p<0.05) return '*'; return 'ns'; };
const fmtP    = p => { if (p==null) return '-'; if (p<0.001) return p.toExponential(2); return p.toFixed(3); };
function kernelDensity(data, ticks, bw) {
  return ticks.map(t => [t, d3.mean(data, d => Math.abs((t-d)/bw)<=3 ? (1/Math.sqrt(2*Math.PI))*Math.exp(-0.5*((t-d)/bw)**2) : 0)/bw]);
}

// ─── Constants ───────────────────────────────────────────────────────────
const PALETTE=['#636EFA','#EF553B','#00CC96','#AB63FA','#FFA15A','#19D3F3','#FF6692','#B6E880','#FF97FF','#FECB52','#636EFA','#EF553B','#00CC96','#AB63FA','#FFA15A'];
const HIGH_COLOR='rgba(255,165,0,0.7)',LOW_COLOR='rgba(135,206,235,0.7)';
const HIGH_BORDER='#f59e0b',LOW_BORDER='#38bdf8';

// ─── 示例（首位改为 RUNX1--RUNX1T1）────────────────────────────────────
const EXAMPLES=['RUNX1--RUNX1T1','BCR--ABL1','EML4--ALK','TMPRSS2--ERG','RUNX1','ALK'];
const HIST_KEY='dgsearch_v2';
const loadHist=()=>{try{return JSON.parse(sessionStorage.getItem(HIST_KEY)||'[]');}catch{return [];}};
const saveHist=l=>{try{sessionStorage.setItem(HIST_KEY,JSON.stringify(l));}catch{}};

// ─── DrugScatterPlot ─────────────────────────────────────────────────────
const DrugScatterPlot = ({highDrugStats,lowDrugStats,allDrugNames,metric,sortMode,onDrugClick,selectedDrug,labelA,labelB}) => {
  const svgRef=useRef(),containerRef=useRef();
  const [tooltip,setTooltip]=useState(null);
  useEffect(()=>{
    if (!allDrugNames?.length) return;
    const svg=d3.select(svgRef.current); svg.selectAll('*').remove();
    const W=560,H=400,m={top:46,right:20,bottom:60,left:60},w=W-m.left-m.right,h=H-m.top-m.bottom;
    svg.attr('viewBox',`0 0 ${W} ${H}`).attr('preserveAspectRatio','xMidYMid meet');
    const g=svg.append('g').attr('transform',`translate(${m.left},${m.top})`);
    let sorted=[...allDrugNames];
    if (sortMode==='high') sorted.sort((a,b)=>(highDrugStats[a]?.mean??0)-(highDrugStats[b]?.mean??0));
    else if (sortMode==='low') sorted.sort((a,b)=>(lowDrugStats[a]?.mean??0)-(lowDrugStats[b]?.mean??0));
    const x=d3.scaleLinear().domain([0,sorted.length-1]).range([0,w]);
    const allVals=[]; sorted.forEach(d=>{if(highDrugStats[d])allVals.push(highDrugStats[d].mean);if(lowDrugStats[d])allVals.push(lowDrugStats[d].mean);});
    const yExt=d3.extent(allVals),yPad=(yExt[1]-yExt[0])*0.1||0.5;
    const y=d3.scaleLinear().domain([yExt[0]-yPad,yExt[1]+yPad]).range([h,0]);
    g.append('g').attr('transform',`translate(0,${h})`).call(d3.axisBottom(x).ticks(5).tickFormat(()=>'')).selectAll('text').remove();
    g.append('g').call(d3.axisLeft(y).ticks(6));
    if (yExt[0]<0&&yExt[1]>0) g.append('line').attr('x1',0).attr('x2',w).attr('y1',y(0)).attr('y2',y(0)).attr('stroke','#000').attr('stroke-width',0.5).attr('stroke-dasharray','3,3');
    g.append('text').attr('x',w/2).attr('y',h+40).attr('text-anchor','middle').style('font-size','12px').style('fill','#475569').text('Drug');
    g.append('text').attr('x',-h/2).attr('y',-45).attr('text-anchor','middle').attr('transform','rotate(-90)').style('font-size','12px').style('fill','#475569').text(metric);
    const drawDots=(statMap,fill,border)=>sorted.forEach((drug,i)=>{
      const stat=statMap[drug];if(!stat)return;
      const isSel=drug===selectedDrug;
      g.append('circle').attr('cx',x(i)).attr('cy',y(stat.mean)).attr('r',isSel?6:3.5)
        .attr('fill',fill).attr('stroke',isSel?'#000':border).attr('stroke-width',isSel?2:0.5).style('cursor','pointer')
        .on('mouseenter',function(ev){d3.select(this).attr('r',6);const rect=containerRef.current.getBoundingClientRect();setTooltip({x:ev.clientX-rect.left,y:ev.clientY-rect.top-50,lines:[drug,`${metric}: ${stat.mean.toFixed(4)}`,`n=${stat.n}`]});})
        .on('mouseleave',function(){d3.select(this).attr('r',isSel?6:3.5);setTooltip(null);})
        .on('click',()=>onDrugClick(drug));
    });
    drawDots(highDrugStats,HIGH_COLOR,HIGH_BORDER);
    drawDots(lowDrugStats,LOW_COLOR,LOW_BORDER);

    // ── 图例：垂直两行排列，彻底避免重叠 ──────────────────────────────
    const lg = g.append('g').attr('transform',`translate(${w - 148}, -38)`);
    lg.append('circle').attr('cx',0).attr('cy',0).attr('r',5).attr('fill',HIGH_COLOR).attr('stroke',HIGH_BORDER).attr('stroke-width',1);
    lg.append('text').attr('x',12).attr('y',4).style('font-size','11px').style('fill','#334155').text(labelA);
    lg.append('circle').attr('cx',0).attr('cy',18).attr('r',5).attr('fill',LOW_COLOR).attr('stroke',LOW_BORDER).attr('stroke-width',1);
    lg.append('text').attr('x',12).attr('y',22).style('font-size','11px').style('fill','#334155').text(labelB);
  },[highDrugStats,lowDrugStats,allDrugNames,metric,sortMode,selectedDrug,onDrugClick,labelA,labelB]);
  return (<div ref={containerRef} className="relative"><svg ref={svgRef} className="w-full" style={{maxHeight:420}}/>
    {tooltip&&<div className="absolute z-50 px-3 py-2 bg-slate-800 text-white text-xs rounded-lg shadow-lg pointer-events-none" style={{left:tooltip.x,top:tooltip.y,transform:'translateX(-50%)'}}>{tooltip.lines.map((l,i)=><div key={i} className={i===0?'font-bold':'text-slate-300'}>{l}</div>)}</div>}
  </div>);
};

// ─── ExpressionViolinPlot ────────────────────────────────────────────────
const ExpressionViolinPlot = ({expressionData,gene,groupBy}) => {
  const svgRef=useRef();
  useEffect(()=>{
    if (!expressionData?.length) return;
    const svg=d3.select(svgRef.current); svg.selectAll('*').remove();
    const groups={};
    expressionData.forEach(d=>{const cat=d[groupBy]||'Other';if(!groups[cat])groups[cat]=[];groups[cat].push(parseFloat(d.value));});
    const processed={},other=[];
    Object.entries(groups).forEach(([cat,vals])=>{if(vals.length<=2||cat==='NS'||cat.toLowerCase()==='unknown')other.push(...vals);else processed[cat]=vals;});
    if (other.length>0) processed['Other']=[...(processed['Other']||[]),...other];
    const cats=Object.keys(processed).sort((a,b)=>a==='Other'?1:b==='Other'?-1:mean(processed[b])-mean(processed[a]));
    if (!cats.length) return;
    const W=560,H=420,m={top:30,right:20,bottom:100,left:60},w=W-m.left-m.right,h=H-m.top-m.bottom;
    svg.attr('viewBox',`0 0 ${W} ${H}`).attr('preserveAspectRatio','xMidYMid meet');
    const g=svg.append('g').attr('transform',`translate(${m.left},${m.top})`);
    const x=d3.scaleBand().domain(cats).range([0,w]).padding(0.15);
    const allVals=Object.values(processed).flat(),yExt=d3.extent(allVals),yPad=(yExt[1]-yExt[0])*0.05;
    const y=d3.scaleLinear().domain([yExt[0]-yPad,yExt[1]+yPad]).range([h,0]);
    g.append('g').attr('transform',`translate(0,${h})`).call(d3.axisBottom(x)).selectAll('text').attr('transform','rotate(-45)').style('text-anchor','end').style('font-size','9px');
    g.append('g').call(d3.axisLeft(y).ticks(6));
    g.append('text').attr('x',-h/2).attr('y',-45).attr('text-anchor','middle').attr('transform','rotate(-90)').style('font-size','12px').style('fill','#475569').text('Expression (FPKM)');
    cats.forEach((cat,ci)=>{
      const vals=processed[cat].filter(v=>!isNaN(v));if(!vals.length)return;
      const color=PALETTE[ci%PALETTE.length],cx=x(cat)+x.bandwidth()/2,bw=Math.min(x.bandwidth()*0.35,25);
      const kde=kernelDensity(vals,y.ticks(40),Math.max((d3.max(vals)-d3.min(vals))/8,0.1));
      const maxD=d3.max(kde,d=>d[1])||1,xs=d3.scaleLinear().domain([0,maxD]).range([0,bw]);
      g.append('path').datum(kde).attr('d',d3.area().x0(d=>cx-xs(d[1])).x1(d=>cx+xs(d[1])).y(d=>y(d[0])).curve(d3.curveCatmullRom)).attr('fill',color).attr('fill-opacity',0.35).attr('stroke',color).attr('stroke-width',1.5);
      const sv=[...vals].sort((a,b)=>a-b),q1=d3.quantile(sv,0.25),q2=d3.quantile(sv,0.5),q3=d3.quantile(sv,0.75),bw2=bw*0.4;
      g.append('rect').attr('x',cx-bw2).attr('y',y(q3)).attr('width',bw2*2).attr('height',y(q1)-y(q3)).attr('fill','white').attr('fill-opacity',0.7).attr('stroke',color).attr('stroke-width',1.5);
      g.append('line').attr('x1',cx-bw2).attr('x2',cx+bw2).attr('y1',y(q2)).attr('y2',y(q2)).attr('stroke',color).attr('stroke-width',2);
      vals.forEach(v=>g.append('circle').attr('cx',cx+(Math.random()-0.5)*bw*0.8).attr('cy',y(v)).attr('r',1.5).attr('fill',color).attr('fill-opacity',0.5));
    });
  },[expressionData,gene,groupBy]);
  return <svg ref={svgRef} className="w-full" style={{maxHeight:440}}/>;
};

// ─── DrugGroupViolin ─────────────────────────────────────────────────────
const DrugGroupViolin = ({highValues,lowValues,drugName,metric,pValue,labelA,labelB}) => {
  const svgRef=useRef();
  useEffect(()=>{
    if (!highValues?.length||!lowValues?.length) return;
    const svg=d3.select(svgRef.current); svg.selectAll('*').remove();
    const W=340,H=340,m={top:40,right:20,bottom:50,left:50},w=W-m.left-m.right,h=H-m.top-m.bottom;
    svg.attr('viewBox',`0 0 ${W} ${H}`).attr('preserveAspectRatio','xMidYMid meet');
    const g=svg.append('g').attr('transform',`translate(${m.left},${m.top})`);
    const allVals=[...highValues,...lowValues],yExt=d3.extent(allVals),yPad=(yExt[1]-yExt[0])*0.1||0.5;
    const y=d3.scaleLinear().domain([yExt[0]-yPad,yExt[1]+yPad]).range([h,0]);
    const x=d3.scaleBand().domain([labelA,labelB]).range([0,w]).padding(0.3);
    g.append('g').attr('transform',`translate(0,${h})`).call(d3.axisBottom(x));
    g.append('g').call(d3.axisLeft(y).ticks(6));
    g.append('text').attr('x',-h/2).attr('y',-38).attr('text-anchor','middle').attr('transform','rotate(-90)').style('font-size','11px').style('fill','#475569').text(metric);
    if (pValue!=null) {
      g.append('rect').attr('x',w/2-80).attr('y',-30).attr('width',160).attr('height',20).attr('fill','rgba(255,255,255,0.9)').attr('stroke','#94a3b8').attr('rx',3);
      g.append('text').attr('x',w/2).attr('y',-16).attr('text-anchor','middle').style('font-size','10px').text(`p = ${fmtP(pValue)} (${sigStars(pValue)})`);
    }
    [{vals:highValues,cat:labelA,color:'#f59e0b',fill:'rgba(255,165,0,0.3)'},{vals:lowValues,cat:labelB,color:'#38bdf8',fill:'rgba(135,206,235,0.3)'}].forEach(({vals,cat,color,fill})=>{
      const cx=x(cat)+x.bandwidth()/2,bw=x.bandwidth()*0.4;
      const kde=kernelDensity(vals,y.ticks(30),Math.max((d3.max(vals)-d3.min(vals))/8,0.1));
      const maxD=d3.max(kde,d=>d[1])||1,xs=d3.scaleLinear().domain([0,maxD]).range([0,bw]);
      g.append('path').datum(kde).attr('d',d3.area().x0(d=>cx-xs(d[1])).x1(d=>cx+xs(d[1])).y(d=>y(d[0])).curve(d3.curveCatmullRom)).attr('fill',fill).attr('stroke',color).attr('stroke-width',1.5);
      const sv=[...vals].sort((a,b)=>a-b),q1=d3.quantile(sv,0.25),q2=d3.quantile(sv,0.5),q3=d3.quantile(sv,0.75),bw2=bw*0.3;
      g.append('rect').attr('x',cx-bw2).attr('y',y(q3)).attr('width',bw2*2).attr('height',Math.max(y(q1)-y(q3),1)).attr('fill','white').attr('fill-opacity',0.7).attr('stroke',color).attr('stroke-width',1.2);
      g.append('line').attr('x1',cx-bw2).attr('x2',cx+bw2).attr('y1',y(q2)).attr('y2',y(q2)).attr('stroke',color).attr('stroke-width',2);
      vals.forEach(v=>g.append('circle').attr('cx',cx+(Math.random()-0.5)*bw*0.6).attr('cy',y(v)).attr('r',1.8).attr('fill',color).attr('fill-opacity',0.4));
    });
  },[highValues,lowValues,drugName,metric,pValue,labelA,labelB]);
  return <svg ref={svgRef} className="w-full" style={{maxHeight:360}}/>;
};

// ─── CorrelationPlot ─────────────────────────────────────────────────────
const CorrelationPlot = ({matchedData,gene,drugName,metric,stats}) => {
  const svgRef=useRef(),containerRef=useRef();
  const [tooltip,setTooltip]=useState(null);
  useEffect(()=>{
    if (!matchedData?.length||matchedData.length<3) return;
    const svg=d3.select(svgRef.current); svg.selectAll('*').remove();
    const W=420,H=340,m={top:40,right:20,bottom:50,left:60},w=W-m.left-m.right,h=H-m.top-m.bottom;
    svg.attr('viewBox',`0 0 ${W} ${H}`).attr('preserveAspectRatio','xMidYMid meet');
    const g=svg.append('g').attr('transform',`translate(${m.left},${m.top})`);
    const xVals=matchedData.map(d=>d.expr),yVals=matchedData.map(d=>d.drug);
    const xExt=d3.extent(xVals),yExt=d3.extent(yVals);
    const xPad=(xExt[1]-xExt[0])*0.05||0.5,yPad=(yExt[1]-yExt[0])*0.05||0.5;
    const x=d3.scaleLinear().domain([xExt[0]-xPad,xExt[1]+xPad]).range([0,w]);
    const y=d3.scaleLinear().domain([yExt[0]-yPad,yExt[1]+yPad]).range([h,0]);
    g.append('g').attr('transform',`translate(0,${h})`).call(d3.axisBottom(x).ticks(5));
    g.append('g').call(d3.axisLeft(y).ticks(5));
    g.append('text').attr('x',w/2).attr('y',h+38).attr('text-anchor','middle').style('font-size','11px').style('fill','#475569').text(`${gene} Expression (FPKM)`);
    g.append('text').attr('x',-h/2).attr('y',-45).attr('text-anchor','middle').attr('transform','rotate(-90)').style('font-size','11px').style('fill','#475569').text(`${drugName} ${metric}`);
    if (stats&&matchedData.length>=2) {
      const n=matchedData.length,sx=d3.sum(xVals),sy=d3.sum(yVals),sxy=xVals.reduce((s,xi,i)=>s+xi*yVals[i],0),sx2=xVals.reduce((s,xi)=>s+xi*xi,0);
      const slope=(n*sxy-sx*sy)/(n*sx2-sx*sx),int=(sy-slope*sx)/n;
      const lx1=d3.min(xVals),lx2=d3.max(xVals);
      g.append('line').attr('x1',x(lx1)).attr('y1',y(slope*lx1+int)).attr('x2',x(lx2)).attr('y2',y(slope*lx2+int)).attr('stroke','#ef4444').attr('stroke-width',2).attr('stroke-dasharray','6,3');
    }
    matchedData.forEach(d=>{
      g.append('circle').attr('cx',x(d.expr)).attr('cy',y(d.drug)).attr('r',3.5)
        .attr('fill','rgba(31,119,180,0.5)').attr('stroke','rgba(31,119,180,0.9)').attr('stroke-width',0.5).style('cursor','pointer')
        .on('mouseenter',function(ev){d3.select(this).attr('r',6);const rect=containerRef.current.getBoundingClientRect();setTooltip({x:ev.clientX-rect.left,y:ev.clientY-rect.top-50,lines:[d.cellLine,`Expr: ${d.expr.toFixed(3)}`,`${metric}: ${d.drug.toFixed(3)}`]});})
        .on('mouseleave',function(){d3.select(this).attr('r',3.5);setTooltip(null);});
    });
    if (stats) {
      g.append('rect').attr('x',w/2-90).attr('y',-30).attr('width',180).attr('height',22).attr('fill','rgba(255,255,255,0.9)').attr('stroke','#94a3b8').attr('rx',3);
      g.append('text').attr('x',w/2).attr('y',-15).attr('text-anchor','middle').style('font-size','10px').text(`r = ${stats.r.toFixed(3)}, p = ${fmtP(stats.p)} (${sigStars(stats.p)}), n = ${stats.n}`);
    }
  },[matchedData,gene,drugName,metric,stats]);
  return (<div ref={containerRef} className="relative"><svg ref={svgRef} className="w-full" style={{maxHeight:360}}/>
    {tooltip&&<div className="absolute z-50 px-3 py-2 bg-slate-800 text-white text-xs rounded-lg shadow-lg pointer-events-none" style={{left:tooltip.x,top:tooltip.y,transform:'translateX(-50%)'}}>{tooltip.lines.map((l,i)=><div key={i} className={i===0?'font-bold':'text-slate-300'}>{l}</div>)}</div>}
  </div>);
};

// ─── DetailRow ───────────────────────────────────────────────────────────
const DR = ({label,value,bold}) => (
  <div className="flex items-start py-2 border-b border-slate-100 last:border-0">
    <span className="text-[11px] text-slate-500 font-medium w-2/5 flex-shrink-0">{label}</span>
    <span className={`text-[11px] text-slate-800 flex-1 break-words ${bold?'font-bold':''}`}>{value||'-'}</span>
  </div>
);

// ─── AnalysisPanel ───────────────────────────────────────────────────────
const AnalysisPanel = ({leftGene,rightGene,fusionName,isFusionSearch,t}) => {
  const g = t.gdsc;

  const METRICS = [
    {value:'Z_SCORE', label:'Z-Score',  desc: g.descZScore},
    {value:'LN_IC50', label:'LN(IC50)', desc: g.descLnIc50},
    {value:'AUC',     label:'AUC',      desc: g.descAuc},
    {value:'RMSE',    label:'RMSE',     desc: g.descRmse},
  ];
  const SPLIT_METHODS = [
    {value:'median',         label: g.splitMedian},
    {value:'upper_tertile',  label: g.splitUpperTertile},
    {value:'lower_tertile',  label: g.splitLowerTertile},
    {value:'upper_quartile', label: g.splitUpperQuartile},
    {value:'lower_quartile', label: g.splitLowerQuartile},
  ];

  const [analysisMode,setAnalysisMode] = useState(isFusionSearch?'fusion':'gene');
  const [activeGene,setActiveGene]     = useState(leftGene);
  const [metric,setMetric]             = useState('AUC');
  const [groupBy,setGroupBy]           = useState('histology');
  const [sortMode,setSortMode]         = useState('high');
  const [splitMethod,setSplitMethod]   = useState('median');
  const [expressionData,setExprData]   = useState([]);
  const [drugResponseData,setDrugData] = useState([]);
  const [cellLineMap,setCLMap]         = useState({});
  const [loading,setLoading]           = useState(false);
  const [error,setError]               = useState('');
  const [dataAvail,setDataAvail]       = useState(null);
  const [fusionPosCL,setFusionPosCL]   = useState([]);
  const [selectedDrug,setSelDrug]      = useState(null);
  const [drugDetails,setDrugDet]       = useState(null);
  const [corrMetric,setCorrMetric]     = useState('AUC');

  const labelA = analysisMode==='fusion' ? g.fusionPositive : g.highExpression;
  const labelB = analysisMode==='fusion' ? g.fusionNegative : g.lowExpression;
  const dispGene = analysisMode==='fusion' ? leftGene : activeGene;
  const metricDesc = METRICS.find(m=>m.value===metric)?.desc || '';

  useEffect(()=>{
    fetchWithAuth('/api/gdsc/check').then(r=>r.json()).then(d=>setDataAvail(d)).catch(()=>setDataAvail({expression_exists:false,drug_exists:false}));
    fetchWithAuth('/api/gdsc/cell_line_map').then(r=>r.json()).then(d=>setCLMap(d)).catch(()=>{});
  },[]);

  useEffect(()=>{
    if (!fusionName||!isFusionSearch) { setFusionPosCL([]); return; }
    fetchWithAuth(`/api/cellfusion/by-name/${encodeURIComponent(fusionName)}`).then(r=>r.ok?r.json():null)
      .then(json=>{
        if (json?.code===200&&json.data?.aggregated?.cell_line) setFusionPosCL(json.data.aggregated.cell_line.split(/[,;]/).map(s=>s.trim()).filter(Boolean));
        else setFusionPosCL([]);
      }).catch(()=>setFusionPosCL([]));
  },[fusionName,isFusionSearch]);

  const revMap=useMemo(()=>{
    const rev={};
    Object.entries(cellLineMap).forEach(([id,cl])=>{const k=(cl||'').trim().toUpperCase();if(k){if(!rev[k])rev[k]=[];rev[k].push(id);}});
    return rev;
  },[cellLineMap]);

  const {fusionPosIds,matchedCLNames}=useMemo(()=>{
    const ids=new Set(),names=[];
    fusionPosCL.forEach(name=>{
      const upper=name.trim().toUpperCase(),variants=new Set([upper]);
      ['.','_','-','/'].forEach(sep=>variants.add(upper.replace(/[._\-\/]/g,sep)));
      variants.add(upper.replace(/[._\-\/]/g,''));
      let found=false;
      for (const v of variants){const m=revMap[v];if(m){m.forEach(id=>ids.add(id));found=true;}}
      if (found) names.push(name);
    });
    return {fusionPosIds:ids,matchedCLNames:names};
  },[fusionPosCL,revMap]);

  useEffect(()=>{
    const gene=analysisMode==='fusion'?leftGene:activeGene; if(!gene) return;
    setLoading(true);setError('');setSelDrug(null);setDrugDet(null);
    fetchWithAuth(`/api/gdsc/expression/${encodeURIComponent(gene)}`).then(r=>r.json())
      .then(data=>{
        if (!data?.length){setError(g.geneNotFound(gene));setExprData([]);setDrugData([]);setLoading(false);return;}
        setExprData(data);
        return fetchWithAuth('/api/gdsc/drug_response',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cosmic_ids:data.map(d=>d.COSMIC_ID)})});
      }).then(r=>r?.json()).then(d=>{if(d)setDrugData(d);setLoading(false);}).catch(e=>{setError(e.message);setLoading(false);});
  },[activeGene,analysisMode,leftGene]);

  useEffect(()=>{
    if (!selectedDrug){setDrugDet(null);return;}
    fetchWithAuth(`/api/gdsc/drug_details/${encodeURIComponent(String(selectedDrug))}`).then(r=>r.ok?r.json():null).then(d=>setDrugDet(d)).catch(()=>setDrugDet(null));
  },[selectedDrug]);

  useEffect(()=>{setCorrMetric(metric);},[metric]);

  const {highIds,lowIds,totalSamples}=useMemo(()=>{
    if (!expressionData.length) return {highIds:new Set(),lowIds:new Set(),totalSamples:0};
    if (analysisMode==='fusion') {
      const high=new Set(),low=new Set();
      expressionData.forEach(d=>{const cid=String(d.COSMIC_ID);if(fusionPosIds.has(cid))high.add(d.COSMIC_ID);else low.add(d.COSMIC_ID);});
      return {highIds:high,lowIds:low,totalSamples:expressionData.length};
    }
    const sorted=[...expressionData].sort((a,b)=>parseFloat(a.value)-parseFloat(b.value)),n=sorted.length;
    let cut;
    switch(splitMethod){case'upper_tertile':cut=Math.floor(n*2/3);break;case'lower_tertile':cut=Math.floor(n/3);break;case'upper_quartile':cut=Math.floor(n*3/4);break;case'lower_quartile':cut=Math.floor(n/4);break;default:cut=Math.floor(n/2);}
    const high=new Set(),low=new Set();
    sorted.forEach((d,i)=>{if(i>=cut)high.add(d.COSMIC_ID);else low.add(d.COSMIC_ID);});
    return {highIds:high,lowIds:low,totalSamples:n};
  },[expressionData,splitMethod,analysisMode,fusionPosIds]);

  const {highDrugStats,lowDrugStats,allDrugNames}=useMemo(()=>{
    if (!drugResponseData.length) return {highDrugStats:{},lowDrugStats:{},allDrugNames:[]};
    const hS={},lS={},drugs=new Set();
    drugResponseData.forEach(item=>{
      const val=parseFloat(item[metric]);if(isNaN(val))return;
      const drug=item.Drug_Name,cid=item.COSMIC_ID; drugs.add(drug);
      if(highIds.has(cid)||highIds.has(String(cid))){if(!hS[drug])hS[drug]=[];hS[drug].push(val);}
      if(lowIds.has(cid)||lowIds.has(String(cid))){if(!lS[drug])lS[drug]=[];lS[drug].push(val);}
    });
    const hR={},lR={};
    drugs.forEach(d=>{if(hS[d]?.length)hR[d]={mean:mean(hS[d]),n:hS[d].length};if(lS[d]?.length)lR[d]={mean:mean(lS[d]),n:lS[d].length};});
    return {highDrugStats:hR,lowDrugStats:lR,allDrugNames:[...drugs]};
  },[drugResponseData,metric,highIds,lowIds]);

  const corrData=useMemo(()=>{
    if (!selectedDrug||!expressionData.length||!drugResponseData.length) return null;
    const ds=drugResponseData.filter(d=>String(d.Drug_Name)===String(selectedDrug));
    if (!ds.length) return null;
    const matched=[];
    expressionData.forEach(e=>{
      const ev=parseFloat(e.value);if(isNaN(ev))return;
      const di=ds.find(d=>d.COSMIC_ID===e.COSMIC_ID||String(d.COSMIC_ID)===String(e.COSMIC_ID));
      if(di){const dv=parseFloat(di[corrMetric]);if(!isNaN(dv))matched.push({expr:ev,drug:dv,cellLine:cellLineMap[String(e.COSMIC_ID)]||e.CELL_LINE||`ID:${e.COSMIC_ID}`});}
    });
    if (matched.length<3) return null;
    return {matched,stats:pearsonCorrelation(matched.map(d=>d.expr),matched.map(d=>d.drug))};
  },[selectedDrug,expressionData,drugResponseData,corrMetric,cellLineMap]);

  const drugGroupData=useMemo(()=>{
    if (!selectedDrug||!drugResponseData.length) return null;
    const ds=drugResponseData.filter(d=>String(d.Drug_Name)===String(selectedDrug));
    const hv=[],lv=[];
    ds.forEach(d=>{const v=parseFloat(d[corrMetric]);if(isNaN(v))return;const cid=d.COSMIC_ID;if(highIds.has(cid)||highIds.has(String(cid)))hv.push(v);if(lowIds.has(cid)||lowIds.has(String(cid)))lv.push(v);});
    if (hv.length<2||lv.length<2) return null;
    return {highVals:hv,lowVals:lv,pValue:welchTTest(hv,lv)?.p??null};
  },[selectedDrug,drugResponseData,corrMetric,highIds,lowIds]);

  const handleDrugClick=useCallback(drug=>setSelDrug(prev=>prev===drug?null:drug),[]);
  const resetCtrl=()=>{setSelDrug(null);setSortMode('high');setMetric('AUC');setSplitMethod('median');};

  if (dataAvail&&(!dataAvail.expression_exists||!dataAvail.drug_exists)) return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
      <AlertCircle size={40} className="mx-auto text-amber-400 mb-3"/>
      <p className="text-lg font-bold text-slate-700 mb-2">{g.dataNotConfigured}</p>
      <p className="text-sm text-slate-500">{g.dataNotConfiguredDesc1}<code className="bg-slate-100 px-1 rounded">expression.csv</code>{g.dataNotConfiguredDesc2}<code className="bg-slate-100 px-1 rounded">drug.csv</code>{g.dataNotConfiguredDesc3}<code className="bg-slate-100 px-1 rounded">backend/data/</code>{g.dataNotConfiguredDesc4}</p>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Title + mode switch */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-teal-100 rounded-lg"><Dna size={20} className="text-teal-600"/></div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">{g.title}</h2>
              <p className="text-xs text-slate-500">{g.dataSource} <a href="https://www.cancerrxgene.org/" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">GDSC</a> {g.dataSourceSuffix}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-500">{g.analyzeGene}</span>
            {[leftGene,rightGene].filter((gene,i,a)=>gene&&a.indexOf(gene)===i).map(gene=>(
              <button key={gene} onClick={()=>{setAnalysisMode('gene');setActiveGene(gene);setSelDrug(null);}}
                className={`px-3 py-1.5 rounded-lg text-sm font-bold transition ${analysisMode==='gene'&&activeGene===gene?'bg-teal-600 text-white shadow-md':'bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-300'}`}>{gene}</button>
            ))}
            {isFusionSearch&&(
              <button onClick={()=>{setAnalysisMode('fusion');setSelDrug(null);}}
                className={`px-3 py-1.5 rounded-lg text-sm font-bold transition flex items-center gap-1.5 ${analysisMode==='fusion'?'bg-purple-600 text-white shadow-md':'bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-300'}`}>
                <Layers size={14}/> {g.analyzeFusion}
              </button>
            )}
          </div>
        </div>

        {analysisMode==='fusion'&&(
          <div className="mb-4 p-3 bg-purple-50 rounded-lg border border-purple-200 flex items-start gap-2">
            <Layers size={14} className="text-purple-500 mt-0.5 flex-shrink-0"/>
            <p className="text-xs text-purple-700">
              <span className="font-semibold">{g.fusionGroupMode} — </span>
              {g.fusionGroupDesc(fusionName)}<strong>{fusionName}</strong>{g.fusionGroupDescMid}
              <span className="text-amber-600 font-bold">{g.fusionGroupDescPos(highIds.size)}</span>
              {g.fusionGroupDescAnd}
              <span className="text-sky-600 font-bold">{g.fusionGroupDescNeg(lowIds.size)}</span>{g.fusionGroupDescEnd}
              {matchedCLNames.length>0&&<span className="ml-1">{g.positiveCellLines}{matchedCLNames.join(', ')}</span>}
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-4 p-3 bg-slate-50 rounded-lg border border-slate-200">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-medium">{g.metricLabel}</span>
            <select value={metric} onChange={e=>setMetric(e.target.value)} className="text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white font-medium">
              {METRICS.map(m=><option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          {analysisMode==='gene'&&(
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 font-medium">{g.groupLabel}</span>
              <select value={splitMethod} onChange={e=>setSplitMethod(e.target.value)} className="text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white">
                {SPLIT_METHODS.map(m=><option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-500 font-medium">{g.sortLabel}</span>
            {[['high',`${labelA}${g.sortSuffix}`,'bg-amber-500'],['low',`${labelB}${g.sortSuffix}`,'bg-sky-400'],['none',g.noSort,'bg-slate-400']].map(([v,l,c])=>(
              <button key={v} onClick={()=>setSortMode(v)} className={`px-2.5 py-1 rounded text-xs font-medium transition ${sortMode===v?`${c} text-white`:'bg-white text-slate-600 border border-slate-300 hover:bg-slate-100'}`}>{l}</button>
            ))}
          </div>
          <button onClick={resetCtrl} className="ml-auto px-3 py-1 rounded text-xs bg-white text-slate-600 border border-slate-300 hover:bg-slate-100">{g.reset}</button>
        </div>
        <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-200 flex items-start gap-2">
          <Info size={14} className="text-blue-500 mt-0.5 flex-shrink-0"/>
          <p className="text-xs text-blue-700">{metricDesc}</p>
        </div>
      </div>

      {loading&&<div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-teal-600 mx-auto mb-4"/><p className="text-teal-700 font-medium">{g.loadingData(dispGene)}</p></div>}
      {error&&!loading&&<div className="bg-white rounded-xl shadow-sm border border-red-200 p-8 text-center"><AlertCircle size={36} className="mx-auto text-red-400 mb-3"/><p className="text-red-600 font-medium">{error}</p></div>}

      {!loading&&!error&&expressionData.length>0&&(
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              {n:totalSamples,     l:g.totalSamples,    c:'from-teal-500 to-emerald-600'},
              {n:highIds.size,     l:labelA,             c:'from-amber-500 to-orange-500'},
              {n:lowIds.size,      l:labelB,             c:'from-sky-400 to-blue-500'},
              {n:allDrugNames.length, l:g.drugCount,    c:'from-purple-500 to-violet-600'},
            ].map(({n,l,c})=>(
              <div key={l} className={`bg-gradient-to-br ${c} rounded-xl p-4 text-white text-center shadow-md`}><p className="text-3xl font-bold">{n}</p><p className="text-xs opacity-90 mt-1">{l}</p></div>
            ))}
          </div>

          {/* Fusion mode */}
          {analysisMode==='fusion'&&(
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              <div className="lg:col-span-3 bg-white rounded-xl shadow-sm border border-slate-200 p-5">
                <div className="flex items-center gap-2 mb-3 pb-3 border-b border-slate-100"><BarChart3 size={16} className="text-teal-500"/><h3 className="text-sm font-bold text-slate-700">{g.fusionScatterTitle(fusionName)}</h3></div>
                {allDrugNames.length>0
                  ?<DrugScatterPlot highDrugStats={highDrugStats} lowDrugStats={lowDrugStats} allDrugNames={allDrugNames} metric={metric} sortMode={sortMode} onDrugClick={handleDrugClick} selectedDrug={selectedDrug} labelA={labelA} labelB={labelB}/>
                  :<div className="py-12 text-center text-slate-400">{g.noDrugData}</div>}
                <p className="text-xs text-slate-400 mt-2 text-center">{g.clickDrugDot}</p>
              </div>
              <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-teal-200 p-5">
                <div className="flex items-center gap-3 mb-4 pb-4 border-b border-slate-100">
                  <div className="p-2 bg-teal-100 rounded-lg"><FlaskConical size={18} className="text-teal-600"/></div>
                  <div><h3 className="text-base font-bold text-slate-800">{g.drugDetails}</h3><p className="text-xs text-slate-500">{g.clickDrugDot}</p></div>
                </div>
                {selectedDrug?(
                  <div className="space-y-2">
                    <DR label={g.drugName} value={drugDetails?.DRUG_NAME||String(selectedDrug)} bold/>
                    <DR label={g.target} value={drugDetails?.PUTATIVE_TARGET}/>
                    <DR label={g.pathway} value={drugDetails?.PATHWAY_NAME}/>
                    <DR label={`${labelA} ${metric} ${g.meanLabel}`} value={highDrugStats[selectedDrug]?`${highDrugStats[selectedDrug].mean.toFixed(4)} (n=${highDrugStats[selectedDrug].n})`:'-'}/>
                    <DR label={`${labelB} ${metric} ${g.meanLabel}`} value={lowDrugStats[selectedDrug]?`${lowDrugStats[selectedDrug].mean.toFixed(4)} (n=${lowDrugStats[selectedDrug].n})`:'-'}/>
                    {drugGroupData?.pValue!=null&&<DR label={g.diffPValue} value={<span className={drugGroupData.pValue<0.05?'text-red-600 font-bold':''}>p = {fmtP(drugGroupData.pValue)} ({sigStars(drugGroupData.pValue)})</span>}/>}
                    {drugGroupData?.pValue!=null&&drugGroupData.pValue<0.05&&<div className="mt-3 p-3 bg-orange-50 border-l-4 border-orange-400 rounded-r text-xs text-orange-700">{g.sigDiffMsg(labelA,labelB,metric)}</div>}
                  </div>
                ):<div className="py-16 text-center"><Search size={36} className="mx-auto text-slate-300 mb-3"/><p className="text-slate-500 text-sm">{g.clickDrugDot}</p></div>}
              </div>
            </div>
          )}

          {/* Gene mode */}
          {analysisMode==='gene'&&(
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
                  <div className="flex items-center gap-2 mb-3 pb-3 border-b border-slate-100"><BarChart3 size={16} className="text-teal-500"/><h3 className="text-sm font-bold text-slate-700">{g.geneScatterTitle(dispGene)}</h3></div>
                  {allDrugNames.length>0
                    ?<DrugScatterPlot highDrugStats={highDrugStats} lowDrugStats={lowDrugStats} allDrugNames={allDrugNames} metric={metric} sortMode={sortMode} onDrugClick={handleDrugClick} selectedDrug={selectedDrug} labelA={labelA} labelB={labelB}/>
                    :<div className="py-12 text-center text-slate-400">{g.noDrugData}</div>}
                  <p className="text-xs text-slate-400 mt-2 text-center">{g.clickDrugDot}</p>
                </div>
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
                  <div className="flex items-center justify-between mb-3 pb-3 border-b border-slate-100">
                    <div className="flex items-center gap-2"><BarChart3 size={16} className="text-indigo-500"/><h3 className="text-sm font-bold text-slate-700">{g.expressionDistTitle(dispGene)}</h3></div>
                    <div className="flex items-center gap-1">
                      {[{value:'histology',label:'Histology'},{value:'site',label:'Site'}].map(opt=>(
                        <button key={opt.value} onClick={()=>setGroupBy(opt.value)} className={`px-2.5 py-1 rounded text-xs font-medium transition ${groupBy===opt.value?'bg-indigo-500 text-white':'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{opt.label}</button>
                      ))}
                    </div>
                  </div>
                  <ExpressionViolinPlot expressionData={expressionData} gene={dispGene} groupBy={groupBy}/>
                </div>
              </div>

              {selectedDrug?(
                <div className="bg-white rounded-xl shadow-sm border border-teal-200 p-6">
                  <div className="flex items-center justify-between mb-4 pb-4 border-b border-slate-100">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-teal-100 rounded-lg"><FlaskConical size={18} className="text-teal-600"/></div>
                      <div><h3 className="text-lg font-bold text-slate-800">{g.drugAnalysisTitle(String(selectedDrug))}</h3><p className="text-xs text-slate-500">{g.switchDrugHint}</p></div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500">{g.correlationMetricLabel}</span>
                      {METRICS.map(m=><button key={m.value} onClick={()=>setCorrMetric(m.value)} className={`px-2.5 py-1 rounded text-xs font-medium transition ${corrMetric===m.value?'bg-teal-500 text-white':'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{m.label}</button>)}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                      <h4 className="text-xs font-bold text-slate-600 mb-2">{g.correlationTitle(dispGene,String(selectedDrug),corrMetric)}</h4>
                      {corrData?(<>
                        <CorrelationPlot matchedData={corrData.matched} gene={dispGene} drugName={String(selectedDrug)} metric={corrMetric} stats={corrData.stats}/>
                        {corrData.stats&&<div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                          <div><strong>{g.corrCoeff}</strong> {corrData.stats.r.toFixed(4)}</div>
                          <div><strong>{g.pValue}</strong> {fmtP(corrData.stats.p)}</div>
                          <div><strong>{g.sampleCountN}</strong> {corrData.stats.n}</div>
                          <div><span className={`font-bold ${corrData.stats.p<0.05?'text-red-600':'text-slate-500'}`}>{sigStars(corrData.stats.p)} {corrData.stats.p<0.05?g.significant:g.notSignificant}</span></div>
                        </div>}
                      </>):<div className="py-8 text-center text-slate-400 text-xs">{g.insufficientData}</div>}
                    </div>
                    <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                      <h4 className="text-xs font-bold text-slate-600 mb-2">{g.drugGroupDistTitle(String(selectedDrug),labelA,labelB,corrMetric)}</h4>
                      {drugGroupData?(<>
                        <p className="text-[10px] text-slate-500 mb-1">{g.samplesStat(labelA,drugGroupData.highVals.length)}, {g.samplesStat(labelB,drugGroupData.lowVals.length)}</p>
                        <DrugGroupViolin highValues={drugGroupData.highVals} lowValues={drugGroupData.lowVals} drugName={String(selectedDrug)} metric={corrMetric} pValue={drugGroupData.pValue} labelA={labelA} labelB={labelB}/>
                      </>):<div className="py-8 text-center text-slate-400 text-xs">{g.insufficientData}</div>}
                    </div>
                    <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                      <h4 className="text-xs font-bold text-slate-600 mb-3 flex items-center gap-1.5"><FlaskConical size={14} className="text-teal-500"/>{g.drugDetailInfo}</h4>
                      <div className="space-y-1">
                        <DR label={g.drugName} value={drugDetails?.DRUG_NAME||String(selectedDrug)} bold/>
                        <DR label={g.target} value={drugDetails?.PUTATIVE_TARGET}/>
                        <DR label={g.pathway} value={drugDetails?.PATHWAY_NAME}/>
                        <DR label={`${labelA} ${g.meanSdLabel}`} value={drugGroupData?.highVals?.length>1?`${mean(drugGroupData.highVals).toFixed(3)} ± ${std(drugGroupData.highVals).toFixed(3)}`:'-'}/>
                        <DR label={`${labelB} ${g.meanSdLabel}`} value={drugGroupData?.lowVals?.length>1?`${mean(drugGroupData.lowVals).toFixed(3)} ± ${std(drugGroupData.lowVals).toFixed(3)}`:'-'}/>
                        <DR label={g.diffPValue} value={drugGroupData?.pValue!=null?<span className={drugGroupData.pValue<0.05?'text-red-600 font-bold':''}>p = {fmtP(drugGroupData.pValue)} ({sigStars(drugGroupData.pValue)})</span>:'-'}/>
                      </div>
                      {drugGroupData?.pValue!=null&&drugGroupData.pValue<0.05&&<div className="mt-4 p-3 bg-orange-50 border-l-4 border-orange-400 rounded-r text-xs text-orange-700">{g.sigDiffMsg(labelA,labelB,corrMetric)}</div>}
                      {drugGroupData?.pValue!=null&&drugGroupData.pValue>=0.05&&<div className="mt-4 p-3 bg-slate-50 border-l-4 border-slate-300 rounded-r text-xs text-slate-600">{g.noSigDiffMsg(labelA,labelB,corrMetric)}</div>}
                    </div>
                  </div>
                </div>
              ):(
                <div className="bg-white rounded-xl shadow-sm border border-dashed border-slate-300 p-8 text-center">
                  <Search size={36} className="mx-auto text-slate-300 mb-3"/>
                  <p className="text-slate-500 font-medium">{g.clickForAnalysis}</p>
                  <p className="text-xs text-slate-400 mt-1">{g.analysisIncludes}</p>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
};

// ─── Main Page ────────────────────────────────────────────────────────────
const DrugGeneSearch = () => {
  const { t } = useLanguage();
  const dgs = t.drugGeneSearch;

  const [inputValue,setInput]     = useState('');
  const [query,setQuery]          = useState(null);
  const [error,setError]          = useState('');
  const [history,setHistory]      = useState(loadHist);
  const [showHistory,setShowHist] = useState(false);
  const inputRef                  = useRef(null);

  const parseInput = raw => {
    const v=(raw||'').trim().toUpperCase().replace(/\s+/g,''); if(!v)return null;
    if (v.includes('--')){const[l,r]=v.split('--');if(!l||!r)return null;return{leftGene:l,rightGene:r,fusionName:`${l}--${r}`,isFusion:true};}
    return{leftGene:v,rightGene:v,fusionName:v,isFusion:false};
  };

  const handleSubmit = raw => {
    const val=raw??inputValue; setError('');
    const parsed=parseInput(val);
    if (!parsed){setError(dgs.invalidInput);return;}
    setQuery(parsed); setInput(parsed.fusionName);
    const next=[parsed.fusionName,...history.filter(h=>h!==parsed.fusionName)].slice(0,6);
    setHistory(next);saveHist(next);setShowHist(false);
  };

  const handleClear=()=>{setInput('');setQuery(null);setError('');setShowHist(false);inputRef.current?.focus();};
  const removeHist=(e,item)=>{e.stopPropagation();const next=history.filter(h=>h!==item);setHistory(next);saveHist(next);};

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
          <div className="flex items-center gap-4">
            <div className="p-2.5 bg-emerald-100 rounded-xl"><FlaskConical size={22} className="text-emerald-600"/></div>
            <div>
              <h1 className="text-xl font-bold text-slate-800">{dgs.pageTitle}</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                {dgs.pageSubtitlePrefix}
                <a href="https://www.cancerrxgene.org/" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">GDSC</a>
                {dgs.pageSubtitleSuffix}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">

        {/* Search box */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <div className="mb-4">
            <h2 className="text-base font-bold text-slate-700 mb-1">{dgs.searchBoxTitle}</h2>
            <p className="text-xs text-slate-400">
              {dgs.searchHint} <code className="bg-slate-100 px-1 rounded">RUNX1</code>
              &nbsp;|&nbsp;
              {dgs.searchHintFusion} <code className="bg-slate-100 px-1 rounded">RUNX1--RUNX1T1</code>
            </p>
          </div>
          <div className="relative">
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
                <input ref={inputRef} type="text" value={inputValue}
                  onChange={e=>{setInput(e.target.value);setError('');}}
                  onKeyDown={e=>{if(e.key==='Enter')handleSubmit();if(e.key==='Escape'){setShowHist(false);inputRef.current?.blur();}}}
                  onFocus={()=>history.length>0&&setShowHist(true)}
                  onBlur={()=>setTimeout(()=>setShowHist(false),150)}
                  placeholder={dgs.placeholder}
                  className={`w-full pl-11 pr-10 py-3.5 rounded-xl border-2 text-sm font-mono transition focus:outline-none ${error?'border-red-300 bg-red-50 focus:border-red-400':'border-slate-200 bg-white focus:border-emerald-400'}`}
                />
                {inputValue&&<button onClick={handleClear} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition"><X size={16}/></button>}
                {showHistory&&history.length>0&&(
                  <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                    <div className="px-3 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wide border-b border-slate-100">{dgs.recentSearches}</div>
                    {history.map((item,i)=>(
                      <button key={i} onMouseDown={()=>{setInput(item);handleSubmit(item);}} className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-slate-50 transition text-left group">
                        <div className="flex items-center gap-2.5">
                          <Search size={12} className="text-slate-300"/>
                          <span className="text-sm font-mono text-slate-700">{item}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${item.includes('--')?'bg-blue-100 text-blue-600':'bg-green-100 text-green-600'}`}>{item.includes('--')?dgs.fusionBadge:dgs.geneBadge}</span>
                        </div>
                        <button onMouseDown={e=>removeHist(e,item)} className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-400 transition p-1"><X size={12}/></button>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button onClick={()=>handleSubmit()} className="flex items-center gap-2 px-6 py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold text-sm transition shadow-sm whitespace-nowrap">
                <Search size={16}/> {dgs.analyze}
              </button>
            </div>
            {error&&<p className="mt-2 text-xs text-red-500 flex items-center gap-1.5"><Info size={12}/>{error}</p>}
          </div>
          {/* Examples */}
          <div className="mt-4 flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-400">{dgs.examples}</span>
            {EXAMPLES.map(ex=><button key={ex} onClick={()=>handleSubmit(ex)} className="text-xs px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50 hover:bg-emerald-50 hover:border-emerald-200 hover:text-emerald-700 text-slate-600 font-mono transition">{ex}</button>)}
          </div>
          {/* Format hints */}
          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex items-start gap-3 p-3 bg-blue-50 rounded-lg border border-blue-100">
              <Dna size={16} className="text-blue-500 mt-0.5 flex-shrink-0"/>
              <div>
                <p className="text-xs font-bold text-blue-700 mb-0.5">{dgs.fusionFormatTitle}</p>
                <p className="text-xs text-blue-600 font-mono">GENE1--GENE2</p>
                <p className="text-xs text-blue-500 mt-0.5">{dgs.fusionFormatDesc}</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-green-50 rounded-lg border border-green-100">
              <FlaskConical size={16} className="text-green-500 mt-0.5 flex-shrink-0"/>
              <div>
                <p className="text-xs font-bold text-green-700 mb-0.5">{dgs.geneFormatTitle}</p>
                <p className="text-xs text-green-600 font-mono">GENENAME</p>
                <p className="text-xs text-green-500 mt-0.5">{dgs.geneFormatDesc}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Result header */}
        {query&&(
          <div className="flex items-center gap-3">
            <ChevronRight size={16} className="text-emerald-500"/>
            <span className="text-sm text-slate-500">{dgs.resultsFor}</span>
            <span className="font-mono font-bold text-slate-800 text-base">{query.fusionName}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${query.isFusion?'bg-blue-100 text-blue-600':'bg-green-100 text-green-600'}`}>
              {query.isFusion?dgs.fusionBadge:dgs.geneBadge}
            </span>
            <button onClick={handleClear} className="ml-auto text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1 transition"><X size={12}/> {dgs.clear}</button>
          </div>
        )}

        {/* Analysis */}
        {query&&<AnalysisPanel key={query.fusionName} leftGene={query.leftGene} rightGene={query.rightGene} fusionName={query.fusionName} isFusionSearch={query.isFusion} t={t}/>}

        {/* Empty state */}
        {!query&&(
          <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-16 text-center">
            <div className="w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto mb-4"><FlaskConical size={28} className="text-emerald-400"/></div>
            <p className="text-slate-500 font-medium mb-1">{dgs.emptyTitle}</p>
            <p className="text-xs text-slate-400">{dgs.emptySubtitle}</p>
          </div>
        )}

        {/* Disclaimer */}
        <div className="bg-amber-50 rounded-xl border border-amber-200 p-4">
          <div className="flex items-start gap-3">
            <Info size={18} className="text-amber-500 mt-0.5 flex-shrink-0"/>
            <div className="text-xs text-amber-700 leading-relaxed">
              <p className="font-semibold mb-1">{dgs.disclaimerTitle}</p>
              <p>{dgs.disclaimerText}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 text-sm text-slate-600">
          <span>{dgs.githubLabel}</span>{' '}
          <a href="https://github.com/bingshaowei/GeneDrugVisualizer" target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-600 hover:underline">
            bingshaowei/GeneDrugVisualizer
          </a>
        </div>

      </div>
    </div>
  );
};

export default DrugGeneSearch;