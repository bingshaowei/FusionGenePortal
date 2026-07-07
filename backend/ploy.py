#!/usr/bin/env python3
"""
UpSet Plot: YWHAE--CRK 融合共存分析 — 仅展示经典融合共存（与 FusionDetail.jsx 逻辑一致）
用法:  python ploy.py --csv /fusion.csv
"""

# !!!! 最前面，在任何 matplotlib 子模块之前 !!!!
import matplotlib
matplotlib.use('Agg')

import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
from matplotlib import rcParams
from collections import Counter, defaultdict
import argparse, sys

# ===================== 配置 =====================
COL_FUSION = 'Fusion.Name'
COL_SAMPLE = 'sample_name'
TARGET = 'YWHAE--CRK'

# =====================================================================
# 经典融合基因列表（与 FusionDetail.jsx CLASSIC_FUSIONS 保持一致）
# =====================================================================
CLASSIC_FUSIONS = {
    # === AML 经典融合 ===
    'RUNX1--RUNX1T1', 'PML--RARA', 'CBFB--MYH11',
    'KMT2A--MLLT3', 'KMT2A--MLLT1', 'KMT2A--MLLT10',
    'KMT2A--AFF1', 'KMT2A--ELL', 'KMT2A--MLLT4', 'KMT2A--MLLT6',
    'DEK--NUP214', 'NUP98--NSD1', 'NUP98--KDM5A',
    'NUP98--HOXA9', 'NUP98--HOXA13',
    'RBM15--MRTFA', 'RBM15--MKL1',
    'CBFA2T3--GLIS2', 'FUS--ERG', 'MNX1--ETV6', 'ETV6--MNX1',
    'BCR--ABL1', 'ETV6--RUNX1', 'RUNX1--ETV6',

    # === ALL 经典融合 ===
    'TCF3--PBX1', 'TCF3--HLF', 'ETV6--ABL1',
    'IGH--MYC', 'MYC--IGH', 'IGH--BCL2', 'BCL2--IGH',
    'P2RY8--CRLF2', 'CRLF2--P2RY8',
    'PAX5--ETV6', 'ETV6--PAX5',
    'MEF2D--BCL9', 'MEF2D--HNRNPUL1',
    'ZNF384--EP300', 'ZNF384--TCF3', 'ZNF384--TAF15',
    'DUX4--IGH', 'IGH--DUX4',
    'NUTM1--BRD4', 'BRD4--NUTM1', 'ABL1--NUP214',

    # === 实体瘤经典融合 ===
    'EML4--ALK', 'ALK--EML4',
    'TMPRSS2--ERG',
    'EWSR1--FLI1', 'EWSR1--ERG', 'EWSR1--WT1', 'EWSR1--ATF1',
    'SS18--SSX1', 'SS18--SSX2',
    'PAX3--FOXO1', 'PAX7--FOXO1',
    'COL1A1--PDGFB', 'NAB2--STAT6',
    'FGFR3--TACC3',
    'RET--CCDC6', 'CCDC6--RET', 'RET--NCOA4', 'NCOA4--RET',
    'NTRK1--TPM3', 'TPM3--NTRK1',
    'NTRK3--ETV6', 'ETV6--NTRK3',
    'ROS1--CD74', 'CD74--ROS1',
    'SLC45A3--BRAF',
    'KIAA1549--BRAF', 'BRAF--KIAA1549',
    'MYB--QKI', 'CLDN18--ARHGAP26',

    # === MPN / MDS 经典融合 ===
    'JAK2--PCM1', 'PCM1--JAK2',
    'PDGFRA--FIP1L1', 'FIP1L1--PDGFRA',
    'PDGFRB--ETV6', 'ETV6--PDGFRB',
    'FGFR1--ZMYM2', 'ZMYM2--FGFR1',
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--csv', required=True)
    ap.add_argument('--target', default=TARGET)
    ap.add_argument('--out', default='upset_YWHAE_CRK_classic')
    args = ap.parse_args()

    # 1. 读 CSV
    print(f'[1] 读取 {args.csv} ...')
    df = pd.read_csv(args.csv, low_memory=False)
    col_map = {
        'Fusion.Name': COL_FUSION, '#FusionName': COL_FUSION, 'FusionName': COL_FUSION,
        'sample.name': COL_SAMPLE, 'SampleName': COL_SAMPLE,
    }
    df.rename(columns={k: v for k, v in col_map.items() if k in df.columns}, inplace=True)
    assert COL_FUSION in df.columns, "找不到 fusion_name 列"
    assert COL_SAMPLE in df.columns, "找不到 sample_name 列"
    print(f'   {len(df)} 行, {df[COL_FUSION].nunique()} 种融合')

    # 2. sample -> fusions
    print('[2] 构建 sample->fusions ...')
    s2f = defaultdict(set)
    for _, r in df.iterrows():
        fn, sn = r[COL_FUSION], r[COL_SAMPLE]
        if pd.isna(fn) or pd.isna(sn):
            continue
        for sid in str(sn).split(','):
            sid = sid.strip()
            if sid:
                s2f[sid].add(str(fn).strip())
    print(f'   {len(s2f)} 个样本')

    # 3. 目标样本（含 target fusion 的样本集）
    target = args.target
    target_sids = {sid for sid, fs in s2f.items() if target in fs}
    print(f'[3] 含 {target} 的样本: {len(target_sids)}')
    if not target_sids:
        sys.exit('未找到目标融合')

    # ── Step 4: 筛选经典融合共存（与 FusionDetail.jsx Step 2 一致） ──
    print('[4] 筛选经典融合共存 ...')
    co_count = Counter()
    for sid in target_sids:
        for fn in s2f[sid]:
            if fn != target and fn in CLASSIC_FUSIONS:
                co_count[fn] += 1

    print(f'   经典共存融合种数: {len(co_count)}')
    if not co_count:
        print('   无经典共存融合，退回全局 top-10（不做经典过滤）')
        for sid in target_sids:
            for fn in s2f[sid]:
                if fn != target:
                    co_count[fn] += 1

    # top-10 经典共存融合（与 JSX Step 3 一致）
    top_others = [fn for fn, _ in co_count.most_common(10)]
    for fn in top_others:
        print(f'     {fn:<30s} n={co_count[fn]:>3d}')

    # display order: top classic fusions first (by count), target fusion last (bottom row)
    display_fusions = top_others + [target]
    n_rows = len(display_fusions)

    # ── Step 5: soloCount 计算（与 JSX Step 4 一致） ──
    classic_set = set(top_others)
    samples_with_classic = sum(
        1 for sid in target_sids
        if any(fn in classic_set for fn in s2f[sid])
    )
    solo_count = len(target_sids) - samples_with_classic
    print(f'[5] 目标样本总数={len(target_sids)}, 与经典共存={samples_with_classic}, solo={solo_count}')

    # ── Step 6: 计算交集（与 JSX Step 4 interMap 一致） ──
    print('[6] 计算交集 ...')
    inter_map = Counter()
    for sid in target_sids:
        sf = s2f[sid]
        key = tuple(fn in sf for fn in display_fusions)
        inter_map[key] += 1

    # solo key: 只有最后一位（target）为 True，其余为 False
    solo_key = tuple([False] * (n_rows - 1) + [True])

    intersections = []
    for key, cnt in inter_map.items():
        is_solo = (key == solo_key)
        # solo 列用计算值覆盖（与 JSX 一致）
        intersections.append({
            'present': list(key),
            'count': solo_count if is_solo else cnt,
            'is_solo': is_solo,
        })

    # 若 solo_key 不存在但 solo_count > 0，手动插入（与 JSX 逻辑一致）
    if not any(d['is_solo'] for d in intersections) and solo_count > 0:
        solo_present = [False] * (n_rows - 1) + [True]
        intersections.append({'present': solo_present, 'count': solo_count, 'is_solo': True})

    intersections.sort(key=lambda x: -x['count'])
    intersections = intersections[:20]
    n_cols = len(intersections)

    set_sizes = {fn: sum(1 for sid in target_sids if fn in s2f[sid]) for fn in display_fusions}
    set_sizes[target] = len(target_sids)

    # ── Step 7: 绘图 ──
    print('[7] 绘图 ...')
    try:
        rcParams['font.sans-serif'] = ['SimHei', 'Microsoft YaHei', 'DejaVu Sans', 'Arial']
    except Exception:
        pass
    rcParams['axes.unicode_minus'] = False

    COL_W   = 0.52
    ROW_H   = 0.38
    BAR_H   = 3.2
    GAP     = 0.35
    LABEL_W = 3.8
    SETBAR_W = 2.2

    fig_w = max(12, LABEL_W + n_cols * COL_W + 0.4 + SETBAR_W + 0.6)
    fig_h = max(6, BAR_H + GAP + n_rows * ROW_H + 1.2)

    fig = plt.figure(figsize=(fig_w, fig_h))
    ax = fig.add_subplot(111)
    ax.set_xlim(0, fig_w)
    ax.set_ylim(0, fig_h)
    ax.axis('off')

    ox = LABEL_W
    oy = 0.6
    bar_bot = oy + n_rows * ROW_H + GAP

    max_cnt = max((d['count'] for d in intersections), default=1)

    # ── 对数刻度（与 JSX yBar = d3.scaleLog() 一致） ──
    import math
    def log_y(v):
        """将计数值映射到 [bar_bot, bar_bot+BAR_H] 的对数坐标（base-10）"""
        v = max(v, 1)
        log_max = math.log10(max(max_cnt * 1.3, 2))
        return bar_bot + (math.log10(v) / log_max) * BAR_H

    # 对数刻度参考线
    log_ticks = [t for t in [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]
                 if t <= max_cnt * 1.3]

    for t in log_ticks:
        yy = log_y(t)
        ax.plot([ox - 0.08, ox], [yy, yy], color='#CBD5E1', lw=0.4)
        ax.text(ox - 0.12, yy, str(t), ha='right', va='center', fontsize=6, color='#64748B')
    ax.text(ox - 0.55, bar_bot + BAR_H / 2,
            'Intersection\nSize (log)', ha='center', va='center',
            fontsize=7, color='#64748B', rotation=90)

    # ── 柱状图 ──
    for ci, inter in enumerate(intersections):
        cx = ox + ci * COL_W + COL_W / 2
        yy = log_y(max(inter['count'], 1))
        bh = yy - bar_bot
        clr = '#7C3AED' if inter['is_solo'] else '#9CA3AF'
        ax.bar(cx, bh, width=COL_W * 0.65, bottom=bar_bot,
               color=clr, edgecolor='white', lw=0.5, zorder=3)
        ax.text(cx, yy + 0.06, str(inter['count']),
                ha='center', va='bottom', fontsize=6.5, fontweight='bold', color='#1E293B')

    # ── 点阵 ──
    for ri, fn in enumerate(display_fusions):
        cy = oy + (n_rows - 1 - ri) * ROW_H + ROW_H / 2
        is_tgt = (fn == target)
        is_classic = fn in CLASSIC_FUSIONS

        if is_tgt:
            lbl_clr, lbl_w = '#7C3AED', 'bold'
        elif is_classic:
            lbl_clr, lbl_w = '#0891B2', 'normal'
        else:
            lbl_clr, lbl_w = '#1E293B', 'normal'

        ax.text(ox - 0.12, cy, fn,
                ha='right', va='center', fontsize=6.5, fontweight=lbl_w,
                color=lbl_clr, family='monospace')
        ax.plot([ox, ox + n_cols * COL_W], [cy, cy], color='#F1F5F9', lw=0.4, zorder=1)

        for ci, inter in enumerate(intersections):
            cx = ox + ci * COL_W + COL_W / 2
            if inter['present'][ri]:
                ax.plot(cx, cy, 'o', color='#374151', ms=6, zorder=5)
            else:
                ax.plot(cx, cy, 'o', color='#E2E8F0', ms=3.5, zorder=2)

    # ── 连线 ──
    for ci, inter in enumerate(intersections):
        cx = ox + ci * COL_W + COL_W / 2
        active_y = [
            oy + (n_rows - 1 - ri) * ROW_H + ROW_H / 2
            for ri in range(n_rows) if inter['present'][ri]
        ]
        if len(active_y) >= 2:
            ax.plot([cx, cx], [min(active_y), max(active_y)],
                    color='#374151', lw=1.5, zorder=4)

    # ── Set Size 横柱 ──
    sb_x = ox + n_cols * COL_W + 0.35
    max_ss = max(set_sizes.values(), default=1)
    ss_scale = SETBAR_W / (max_ss * 1.15)
    ax.text(sb_x + SETBAR_W / 2, oy + n_rows * ROW_H + 0.08,
            'Set Size', ha='center', va='bottom', fontsize=7, color='#64748B')

    for ri, fn in enumerate(display_fusions):
        cy = oy + (n_rows - 1 - ri) * ROW_H + ROW_H / 2
        sz = set_sizes[fn]
        bw = sz * ss_scale
        clr = '#7C3AED' if fn == target else '#9CA3AF'
        ax.barh(cy, bw, height=ROW_H * 0.55, left=sb_x,
                color=clr, edgecolor='white', lw=0.4, zorder=3)
        ax.text(sb_x + bw + 0.08, cy, str(sz),
                ha='left', va='center', fontsize=5.5, color='#374151')

    # ── 标题 & 图例 ──
    ax.text(fig_w / 2, fig_h - 0.15,
            f'UpSet Plot: {target} co-occurrence (classic cancer fusions)',
            ha='center', va='top', fontsize=11, fontweight='bold', color='#1E293B')

    ly = oy - 0.25
    ax.plot(ox, ly, 's', color='#7C3AED', ms=7)
    ax.text(ox + 0.25, ly, f'Only {target}', va='center', fontsize=6.5, color='#7C3AED')
    ax.plot(ox + 2.8, ly, 's', color='#9CA3AF', ms=7)
    ax.text(ox + 3.05, ly, 'Co-occurrence with classic fusions',
            va='center', fontsize=6.5, color='#64748B')

    fig.savefig(args.out + '.pdf', dpi=300, bbox_inches='tight', facecolor='white')
    fig.savefig(args.out + '.png', dpi=200, bbox_inches='tight', facecolor='white')
    plt.close(fig)
    print(f'OK  {args.out}.pdf')
    print(f'OK  {args.out}.png')


if __name__ == '__main__':
    main()