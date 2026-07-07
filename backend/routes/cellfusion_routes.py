# backend/routes/cellfusion_routes.py
#
# 核心修正：
#   1. disease_full 列中一行可含多个疾病，以 "," 分隔，但疾病名内部的逗号转义为 "\,"
#      → 用占位符法正确拆分，得到精确的单个疾病名称
#   2. /top20 接口接受 pipe 分隔的多个疾病，对每个进行精确集合成员检查，而非子串匹配
#   3. _diseases_cache 由解析后的唯一精确疾病名构成（不含 NA）
#   ★ 4. 为 get_cellfusion_by_name 添加 @cellfusion_bp.route 装饰器（修复 404）
#   ★ 5. Arriba sidecar JSON 写入时，id = "{fusion_name}_{N}"，N 按 fq 降序
#        → arriba_routes.py 会据此生成 {fusion_name}_N.pdf
#   ★ 6. 为每行补 variant_num 字段，供前端直接显示 V1 / V2 / ...

import os
import traceback
import json
from collections import OrderedDict
import pandas as pd
from flask import Blueprint, jsonify, request, Response, make_response
from flask_jwt_extended import jwt_required

# cellfusion Arriba sidecar 缓存目录（与 arriba_routes.py 中的 CELLFUSION_CACHE_DIR 路径一致）
_CELLFUSION_ARRIBA_DIR = os.path.join(
    os.path.abspath(os.path.dirname(os.path.dirname(__file__))),
    'arriba', 'cellfusion_cache'
)
os.makedirs(_CELLFUSION_ARRIBA_DIR, exist_ok=True)

cellfusion_bp = Blueprint('cellfusion', __name__)

_df              = None   # 精简 DataFrame（含 _disease_set 列）
_col_info        = {}
_top20_cache     = None
_diseases_cache  = None   # 精确的唯一疾病名列表（103 种）
_td_map_cache    = None   # {fusion_name: {disease, cell_line}}
_cellfusion_global_stats = None  # {avg_junction: float, avg_spanning: float} 全库均值

# ★ cell_fusion_all.csv 相关缓存
_df_all          = None   # cell_fusion_all DataFrame
_disease_sample_counts = None  # {disease_name: unique_sample_count}
_top20_param_cache = OrderedDict()
_top20_disease_cache = {}
_top20_cellline_exact_cache = {}
_TOP20_PARAM_CACHE_MAX = 512

_CSV_PATH = os.path.join(
    os.path.abspath(os.path.dirname(os.path.dirname(__file__))),
    'cellfusion_final.csv'
)
_CSV_ALL_PATH = os.path.join(
    os.path.abspath(os.path.dirname(os.path.dirname(__file__))),
    'cell_fusion_all.csv'
)
_CELLFUSION_DATA_CACHE_DIR = os.path.join(
    os.path.abspath(os.path.dirname(os.path.dirname(__file__))),
    'data', 'cellfusion_cache'
)
_SKIP = {'nan', 'n/a', '', 'none', 'na'}


def _cache_get(cache: OrderedDict, key):
    if key not in cache:
        return None
    cache.move_to_end(key)
    return cache[key]


def _cache_set(cache: OrderedDict, key, value, maxsize: int):
    cache[key] = value
    cache.move_to_end(key)
    while len(cache) > maxsize:
        cache.popitem(last=False)


def _csv_pickle_cache_path(path: str) -> str:
    os.makedirs(_CELLFUSION_DATA_CACHE_DIR, exist_ok=True)
    return os.path.join(_CELLFUSION_DATA_CACHE_DIR, f"{os.path.basename(path)}.pkl")


def _read_csv_cached(path: str, label: str, encodings: tuple):
    cache_path = _csv_pickle_cache_path(path)
    if os.path.exists(cache_path):
        try:
            if os.path.getmtime(cache_path) >= os.path.getmtime(path):
                print(f"[{label}] Loading cache: {cache_path}")
                return pd.read_pickle(cache_path)
        except OSError:
            pass

    df = None
    used_encoding = None
    for enc in encodings:
        try:
            df = pd.read_csv(path, low_memory=False, encoding=enc)
            used_encoding = enc
            break
        except (UnicodeDecodeError, LookupError):
            continue
    if df is None:
        fallback = encodings[-1] if encodings else 'latin-1'
        df = pd.read_csv(path, low_memory=False, encoding=fallback)
        used_encoding = fallback

    print(f"[{label}] encoding: {used_encoding}")
    tmp_path = f"{cache_path}.tmp.{os.getpid()}"
    try:
        print(f"[{label}] Writing cache: {cache_path}")
        df.to_pickle(tmp_path)
        os.replace(tmp_path, cache_path)
    except Exception as e:
        print(f"[{label}] Failed to write cache: {e}")
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except OSError:
            pass
    return df


def _normalize_cellfusion_squeue(value) -> str:
    """Return the numeric part used by the CL display ID."""
    if value is None:
        return ''
    s = str(value).strip()
    if not s or s.lower() in _SKIP:
        return ''
    if s.upper().startswith('CL'):
        s = s[2:]
    if s.endswith('.0'):
        s = s[:-2]
    return s.strip()


def _cellfusion_display_id(value, fallback='') -> str:
    sid = _normalize_cellfusion_squeue(value) or _normalize_cellfusion_squeue(fallback)
    return f"CL{sid}" if sid else ''


# ═════════════════════════════════════════════════════════════
# PASS Fusion 表 gene name → 完整 "name^ENSG..." 映射（懒加载）
# 用途：为 Arriba 画图补齐 ENSG ID
#   cellfusion CSV 的 left_gene 只有 "YWHAE"，没有 ENSG
#   Arriba draw_fusions.R 需要 ENSG 才能在 GTF 里找到基因
# ═════════════════════════════════════════════════════════════
_pass_gene_ensg_map = None      # {gene_name: "name^ENSG..."}
_pass_fusion_info_cache = {}    # {fusion_name: {left_gene, right_gene, cds_left_id, cds_right_id}}


def _build_pass_gene_ensg_map():
    """扫描 PASS Fusion 表，建立 gene_name → 完整 name^ENSG... 字符串的映射。"""
    global _pass_gene_ensg_map
    if _pass_gene_ensg_map is not None:
        return _pass_gene_ensg_map
    _pass_gene_ensg_map = {}
    try:
        from models import Fusion
        from extensions import db
        # 拉取所有不重复的 left_gene 和 right_gene
        for field_name in ('left_gene', 'right_gene'):
            field = getattr(Fusion, field_name)
            rows = db.session.query(field).filter(field.like('%^ENSG%')).distinct().all()
            for (g,) in rows:
                if g and '^' in g:
                    name = g.split('^')[0].strip()
                    if name and name not in _pass_gene_ensg_map:
                        _pass_gene_ensg_map[name] = g
        print(f"[CellFusion] PASS gene-ENSG 映射: {len(_pass_gene_ensg_map)} 个基因")
    except Exception as e:
        print(f"[CellFusion] ⚠️  构建 gene-ENSG 映射失败: {e}")
        traceback.print_exc()
    return _pass_gene_ensg_map


def _lookup_pass_fusion_info(fusion_name: str, left_gene: str, right_gene: str) -> dict:
    """
    为 cellfusion 融合补齐 Arriba 所需的 ENSG ID 和 CDS ID。
    查找顺序：
      1. PASS 中恰好存在同名融合 → 直接用它的完整字段
      2. 否则按基因名分别在 PASS 中查 ENSG
      3. 都查不到 → 退化为原始 gene_name
    返回：{left_gene_full, right_gene_full, cds_left_id, cds_right_id}
    """
    # 缓存命中
    if fusion_name in _pass_fusion_info_cache:
        return _pass_fusion_info_cache[fusion_name]

    result = {
        'left_gene_full':  left_gene,
        'right_gene_full': right_gene,
        'cds_left_id':     '.',
        'cds_right_id':    '.',
    }

    try:
        from models import Fusion

        # 1) 精确融合名匹配（通常走到这一步说明 PASS 也有，会被前端重定向，但还是保底）
        pass_match = Fusion.query.filter_by(fusion_name=fusion_name).first()
        if pass_match and pass_match.left_gene and pass_match.right_gene:
            result['left_gene_full']  = pass_match.left_gene
            result['right_gene_full'] = pass_match.right_gene
            result['cds_left_id']     = getattr(pass_match, 'cds_left_id', None)  or '.'
            result['cds_right_id']    = getattr(pass_match, 'cds_right_id', None) or '.'
            _pass_fusion_info_cache[fusion_name] = result
            return result

        # 2) 按基因名在全库查 ENSG
        gene_map = _build_pass_gene_ensg_map()
        if left_gene  in gene_map: result['left_gene_full']  = gene_map[left_gene]
        if right_gene in gene_map: result['right_gene_full'] = gene_map[right_gene]

    except Exception as e:
        print(f"[CellFusion] PASS 查询失败 ({fusion_name}): {e}")

    _pass_fusion_info_cache[fusion_name] = result
    return result


# ═════════════════════════════════════════════════════════════


# ─────────────────────────────────────────────────────────────
# disease_full 精确拆分
# 规则：以 "," 为分隔符，但疾病名内部的逗号转义为 "\,"，不作为分隔符
# ─────────────────────────────────────────────────────────────
def _parse_disease_full(val) -> frozenset:
    if not val or str(val).lower().strip() in _SKIP:
        return frozenset()
    s = str(val).replace('\\,', '\x01')
    parts = s.split(',')
    result = set()
    for p in parts:
        clean = p.replace('\x01', ',').strip()
        if clean and clean.lower() not in _SKIP:
            result.add(clean)
    return frozenset(result)


# ─────────────────────────────────────────────────────────────
# 列名自动检测
# ─────────────────────────────────────────────────────────────
def _normalize_col_name(name: str) -> str:
    """
    把列名归一化为纯小写字母+数字（去掉所有分隔符 . _ - 空格等）。
    用于列名的"模糊精确匹配"——只关心单词组成，不关心分隔符差异。
    例: 'result.function.left' → 'resultfunctionleft'
        'result_function_left' → 'resultfunctionleft'
        'Left.CDS.status'      → 'leftcdsstatus'
    """
    import re
    return re.sub(r'[^a-z0-9]', '', name.lower())


def _detect_cols(columns: list) -> dict:
    """
    自动检测 cellfusion_final.csv 的关键列，返回 {逻辑名: 实际列名} 映射。

    关键列（示例 CSV 列名 → 逻辑名）：
      fusion            → fusion_col         融合名称
      fq                → fq_col             FQ 值
      <XXX, >XXX        → low_col, high_col  JunctionReadCount / SpanningFragCount
      tissue_full       → tissue_col
      disease_full      → disease_col
      *breakpoint*      → left_bp_col / right_bp_col
      annots            → annots_col

    ★ 细胞系专属五列（三级匹配：精确 → 归一化 → 子串兜底）：
      result.function.left   → function_left_col
      result.function.right  → function_right_col
      Left.CDS.status        → cds_left_col
      Right.CDS.status       → cds_right_col
      Avg.FFPM               → avg_ffpm_col

    其它：
      FUSION_TRANSL          → fusion_transl_col
    """
    found = {}
    lc = {c: c.lower() for c in columns}

    # ★ 打印完整列名列表（排查时必须知道 CSV 实际列名）
    print(f"[CellFusion] ★ CSV 完整列名 ({len(columns)} 列):")
    for i, c in enumerate(columns):
        print(f"[CellFusion]   [{i:3d}] '{c}'")

    # ═════════════════════════════════════════════════════════════════════════
    # ★ 第一步：对 5 个已知列名做【精确匹配】（仅大小写、首尾空白不敏感）
    # ═════════════════════════════════════════════════════════════════════════
    EXACT_MAP = {
        'function_left_col':  'result.function.left',
        'function_right_col': 'result.function.right',
        'cds_left_col':       'left.cds.status',
        'cds_right_col':      'right.cds.status',
        'avg_ffpm_col':       'avg.ffpm',
    }
    # 建立 {lowercased_column_name: original_column_name} 反查表
    lc_to_orig = {}
    for c, cl in lc.items():
        if cl not in lc_to_orig:
            lc_to_orig[cl] = c
    for logical, expected_lower in EXACT_MAP.items():
        if expected_lower in lc_to_orig:
            found[logical] = lc_to_orig[expected_lower]
            print(f"[CellFusion]   ✅ 精确匹配 {logical} → '{found[logical]}'")
        else:
            print(f"[CellFusion]   ❌ 精确匹配未命中 {logical} (期望 '{expected_lower}')")

    # ═════════════════════════════════════════════════════════════════════════
    # ★ 第 1.5 步：归一化匹配（去掉所有分隔符后比较）
    #   解决 CSV 列名用不同分隔符的问题，如：
    #     result_function_left  vs  result.function.left
    #     Left_CDS_status       vs  Left.CDS.status
    #   只对第一步未命中的列进行
    # ═════════════════════════════════════════════════════════════════════════
    NORM_MAP = {
        'function_left_col':  'resultfunctionleft',
        'function_right_col': 'resultfunctionright',
        'cds_left_col':       'leftcdsstatus',
        'cds_right_col':      'rightcdsstatus',
        'avg_ffpm_col':       'avgffpm',
    }
    for logical, expected_norm in NORM_MAP.items():
        if logical in found:
            continue  # 精确匹配已命中，跳过
        for c in columns:
            cn = _normalize_col_name(c)
            if cn == expected_norm:
                found[logical] = c
                print(f"[CellFusion]   ✅ 归一化匹配 {logical} → '{c}' (normalized='{cn}')")
                break
        else:
            print(f"[CellFusion]   ⚠️  归一化匹配也未命中 {logical} (期望 '{expected_norm}')")

    # ═════════════════════════════════════════════════════════════════════════
    # ★ 第二步：其余列走原有的子串匹配；5 个精确列若已命中则跳过子串逻辑，
    #   避免被同义子串列抢占；若前两步均未命中，子串匹配才作为最后兜底。
    # ═════════════════════════════════════════════════════════════════════════
    for c, cl in lc.items():
        if cl in ('squeue', 'seq', 'sequenceid') and 'squeue_col' not in found:
            found['squeue_col'] = c
        if 'fusion' in cl and 'fusion_col' not in found and 'transl' not in cl and 'function' not in cl:
            found['fusion_col']    = c
        if cl == 'fq'       and 'fq_col'    not in found:  found['fq_col']        = c
        if '<' in c         and 'low_col'   not in found:  found['low_col']       = c
        if '>' in c         and 'high_col'  not in found:  found['high_col']      = c
        if 'tissue_full' in cl and 'tissue_col' not in found:  found['tissue_col']  = c
        if 'disease_full' in cl and 'disease_col' not in found: found['disease_col'] = c
        if 'left' in cl and ('breakpoint' in cl or cl.endswith('bp')) and 'left_bp_col' not in found:
            found['left_bp_col'] = c
        if 'right' in cl and ('breakpoint' in cl or cl.endswith('bp')) and 'right_bp_col' not in found:
            found['right_bp_col'] = c
        if 'annot' in cl and 'annots_col' not in found:
            found['annots_col'] = c

        # ─── 5 个精确列的子串兜底（仅在精确+归一化都未命中时生效）──────────
        if 'avg' in cl and 'ffpm' in cl and 'avg_ffpm_col' not in found:
            found['avg_ffpm_col'] = c
            print(f"[CellFusion]   ⚠️  子串兜底 avg_ffpm_col → '{c}'")

        if ('function' in cl and 'left' in cl
                and 'range' not in cl and 'id' not in cl.split('.') and 'id' not in cl.split('_')
                and 'function_left_col' not in found):
            found['function_left_col']  = c
            print(f"[CellFusion]   ⚠️  子串兜底 function_left_col → '{c}'")
        if ('function' in cl and 'right' in cl
                and 'range' not in cl and 'id' not in cl.split('.') and 'id' not in cl.split('_')
                and 'function_right_col' not in found):
            found['function_right_col'] = c
            print(f"[CellFusion]   ⚠️  子串兜底 function_right_col → '{c}'")
        if ('cds' in cl and 'status' in cl and 'left' in cl
                and 'range' not in cl and 'pos' not in cl
                and 'cds_left_col' not in found):
            found['cds_left_col']  = c
            print(f"[CellFusion]   ⚠️  子串兜底 cds_left_col → '{c}'")
        if ('cds' in cl and 'status' in cl and 'right' in cl
                and 'range' not in cl and 'pos' not in cl
                and 'cds_right_col' not in found):
            found['cds_right_col'] = c
            print(f"[CellFusion]   ⚠️  子串兜底 cds_right_col → '{c}'")

        # ★ FUSION_TRANSL 蛋白序列列
        if 'fusion_transl' in cl and 'fusion_transl_col' not in found:
            found['fusion_transl_col'] = c

        # ★ LeftGene / RightGene 列 — CSV 里已含完整 "ZNF654^ENSG00000175105.8" 格式
        #   Arriba 画图必须读这两列拿到 ENSG ID，否则 draw_fusions.R 在 GTF 里找不到基因
        #   注意：要排除 breakpoint 列和 function 列，它们也含 "left"/"right"
        if ('left' in cl and 'gene' in cl
                and 'breakpoint' not in cl and 'function' not in cl
                and 'left_gene_col' not in found):
            found['left_gene_col']  = c
        if ('right' in cl and 'gene' in cl
                and 'breakpoint' not in cl and 'function' not in cl
                and 'right_gene_col' not in found):
            found['right_gene_col'] = c

    if 'tissue_col'  not in found:
        for c, cl in lc.items():
            if 'tissue'  in cl: found['tissue_col']  = c; break
    if 'disease_col' not in found:
        for c, cl in lc.items():
            if 'disease' in cl: found['disease_col'] = c; break
    for pat in ['cell_line','cellline','ccle_name','ccl_name','sample_name','samplename','sample','ccl','depmap']:
        for c, cl in lc.items():
            if pat in cl: found['cell_line_col'] = c; break
        if 'cell_line_col' in found: break
    return found


# ─────────────────────────────────────────────────────────────
# CSV 加载（启动时调用一次）
# ─────────────────────────────────────────────────────────────
def _load_cellfusion_csv():
    global _df, _col_info, _top20_cache, _diseases_cache, _td_map_cache, _cellfusion_global_stats

    print(f"\n[CellFusion] 开始加载: {_CSV_PATH}")
    if not os.path.exists(_CSV_PATH):
        print("[CellFusion] ⚠️  文件不存在，请将 cellfusion_final.csv 放在 backend/ 目录下")
        return

    try:
        df_raw = _read_csv_cached(
            _CSV_PATH,
            'CellFusion',
            ('utf-8', 'utf-8-sig', 'gbk', 'gb2312', 'latin-1', 'cp1252'),
        )

        df_raw.columns = df_raw.columns.str.strip()
        print(f"[CellFusion] {len(df_raw):,} 行 × {len(df_raw.columns)} 列")
        print(f"[CellFusion] 列名: {list(df_raw.columns[:15])}")

        cols = _detect_cols(df_raw.columns.tolist())
        print(f"[CellFusion] 列映射: {cols}")

        missing = [k for k in ['fusion_col','fq_col','low_col','high_col'] if k not in cols]
        if missing:
            print(f"[CellFusion] ❌ 缺少必要列: {missing}")
            return
        _col_info = cols

        for k in ['fq_col','low_col','high_col']:
            df_raw[cols[k]] = pd.to_numeric(df_raw[cols[k]], errors='coerce').fillna(0)

        keep = list(dict.fromkeys([
            cols['fusion_col'], cols['fq_col'], cols['low_col'], cols['high_col'],
            *([cols['tissue_col']]    if 'tissue_col'    in cols else []),
            *([cols['disease_col']]   if 'disease_col'   in cols else []),
            *([cols['cell_line_col']] if 'cell_line_col' in cols else []),
            *([cols['left_bp_col']]   if 'left_bp_col'   in cols else []),
            *([cols['right_bp_col']]  if 'right_bp_col'  in cols else []),
            *([cols['squeue_col']]    if 'squeue_col'    in cols else []),
            *([cols['annots_col']]    if 'annots_col'    in cols else []),
            *([cols['avg_ffpm_col']]  if 'avg_ffpm_col'  in cols else []),
            # ★ 细胞系专属五列
            *([cols['function_left_col']]  if 'function_left_col'  in cols else []),
            *([cols['function_right_col']] if 'function_right_col' in cols else []),
            *([cols['cds_left_col']]       if 'cds_left_col'       in cols else []),
            *([cols['cds_right_col']]      if 'cds_right_col'      in cols else []),
            *([cols['fusion_transl_col']]  if 'fusion_transl_col'  in cols else []),
            # ★ LeftGene / RightGene 列（Arriba 画图必需）
            *([cols['left_gene_col']]   if 'left_gene_col'   in cols else []),
            *([cols['right_gene_col']]  if 'right_gene_col'  in cols else []),
        ]))
        _df = df_raw[keep].copy()

        # ★ 打印检测到的列 + 前 3 行样本值（便于排查列映射是否正确）
        _EXACT_EXPECT = {
            'function_left_col':  'result.function.left',
            'function_right_col': 'result.function.right',
            'cds_left_col':       'Left.CDS.status',
            'cds_right_col':      'Right.CDS.status',
            'avg_ffpm_col':       'Avg.FFPM',
        }
        def _fmt(key):
            actual = cols.get(key)
            if not actual:
                return '❌ 未检测到'
            expected = _EXACT_EXPECT.get(key)
            if expected and actual.lower() == expected.lower():
                return f'✅ [精确] {actual}'
            if expected:
                return f'⚠️  [兜底] {actual}  (期望精确列 {expected})'
            return f'{actual}'

        def _sample(key, n=3):
            """打印某个逻辑列的前 n 个非空样本值，帮助确认列映射是否正确"""
            col_name = cols.get(key)
            if not col_name or col_name not in df_raw.columns:
                return '(无列)'
            vals = df_raw[col_name].dropna().head(n).tolist()
            return str(vals)

        print(f"[CellFusion] ═══ 关键列映射结果 ═══")
        print(f"[CellFusion] left_gene:      {cols.get('left_gene_col', '❌未检测到')}")
        print(f"[CellFusion] right_gene:     {cols.get('right_gene_col','❌未检测到')}")
        for key in ['function_left_col', 'function_right_col', 'cds_left_col', 'cds_right_col', 'avg_ffpm_col']:
            print(f"[CellFusion] {key:22s}: {_fmt(key)}")
            print(f"[CellFusion]   样本值: {_sample(key)}")
        print(f"[CellFusion] fusion_transl:  {cols.get('fusion_transl_col', '❌未检测到')}")

        if 'disease_col' in cols:
            print("[CellFusion] 正在解析 disease_full 列...")
            _df['_disease_set'] = _df[cols['disease_col']].apply(_parse_disease_full)
            all_diseases: set = set()
            for ds in _df['_disease_set']:
                all_diseases.update(ds)
            all_diseases.discard('')
            _diseases_cache = sorted(all_diseases, key=str.lower)
            print(f"[CellFusion] 唯一疾病种类: {len(_diseases_cache)}")
        else:
            _df['_disease_set'] = frozenset()
            _diseases_cache = []

        print("[CellFusion] 构建 fusion-info map...")
        _td_map_cache = _build_fusion_map(_df, cols)
        print(f"[CellFusion] map 完成: {len(_td_map_cache):,} 个融合")

        # ★ 计算全库 Junction / Spanning 平均值（用于前端图表参考线）
        try:
            _cellfusion_global_stats = {
                'avg_junction': float(_df[cols['high_col']].mean()) if 'high_col' in cols else 1.92,
                'avg_spanning': float(_df[cols['low_col']].mean())  if 'low_col'  in cols else 0.68,
            }
            print(f"[CellFusion] 全库均值: junction={_cellfusion_global_stats['avg_junction']:.4f}, spanning={_cellfusion_global_stats['avg_spanning']:.4f}")
        except Exception as e:
            _cellfusion_global_stats = {'avg_junction': 1.92, 'avg_spanning': 0.68}
            print(f"[CellFusion] ⚠️  全库均值计算失败，使用默认值: {e}")

        _top20_cache = _compute_top20(_df, cols)
        print("[CellFusion] 全量 top20 预计算完成")

        # ★ 加载 cell_fusion_all.csv（用于疾病筛选）
        _load_cell_fusion_all()
        print(f"[CellFusion] cell_fusion_all 加载状态: _df_all={'已加载 '+str(len(_df_all))+'行' if _df_all is not None else '未加载/None'}")

        print("[CellFusion] ✅ 加载完成\n")

    except Exception as e:
        print(f"[CellFusion] ❌ 加载失败: {e}")
        traceback.print_exc()


# ─────────────────────────────────────────────────────────────
# ★ cell_fusion_all.csv 加载 & 疾病样本计数
# ─────────────────────────────────────────────────────────────
import re as _re

def _strip_sample_date(name: str) -> str:
    """
    去除样本名末尾的日期后缀（_YYYYMMDD）。
    例如 CL_22Rv1_PROS_CA_Ctrl_CCLE_20260313 → CL_22Rv1_PROS_CA_Ctrl_CCLE
    """
    if not name:
        return ''
    return _re.sub(r'_\d{8}$', '', str(name).strip())


def _load_cell_fusion_all():
    global _df_all, _disease_sample_counts, _top20_param_cache
    global _top20_disease_cache, _top20_cellline_exact_cache

    print(f"\n[CellFusionAll] 开始加载: {_CSV_ALL_PATH}")
    if not os.path.exists(_CSV_ALL_PATH):
        print("[CellFusionAll] ⚠️  cell_fusion_all.csv 不存在，疾病筛选功能不可用")
        return

    try:
        df_raw = _read_csv_cached(
            _CSV_ALL_PATH,
            'CellFusionAll',
            ('utf-8', 'utf-8-sig', 'gbk', 'latin-1'),
        )

        df_raw.columns = df_raw.columns.str.strip()
        print(f"[CellFusionAll] {len(df_raw):,} 行 × {len(df_raw.columns)} 列")
        print(f"[CellFusionAll] 列名: {list(df_raw.columns[:20])}")

        # ★ 自动检测关键列名（模糊匹配）
        col_map = {}
        lc = {c: c.lower().replace(' ', '').replace('.', '').replace('_', '') for c in df_raw.columns}
        for c, cl in lc.items():
            if 'diseasefull' in cl and 'disease_full_col' not in col_map:
                col_map['disease_full_col'] = c
            if 'samplename' in cl and 'sample_name_col' not in col_map:
                col_map['sample_name_col'] = c
            if 'fusionname' in cl and 'fusion_name_col' not in col_map:
                col_map['fusion_name_col'] = c
            if cl == 'ffpm' and 'ffpm_col' not in col_map:
                col_map['ffpm_col'] = c
            if cl == 'cellline' and 'cellline_col' not in col_map:
                col_map['cellline_col'] = c

        # 兜底：尝试更宽泛的匹配
        for c in df_raw.columns:
            cl = c.lower()
            if 'disease' in cl and 'full' in cl and 'disease_full_col' not in col_map:
                col_map['disease_full_col'] = c
            if 'sample' in cl and 'name' in cl and 'sample_name_col' not in col_map:
                col_map['sample_name_col'] = c
            if 'fusion' in cl and 'name' in cl and 'fusion_name_col' not in col_map:
                col_map['fusion_name_col'] = c
            if cl.strip() == 'ffpm' and 'ffpm_col' not in col_map:
                col_map['ffpm_col'] = c
            if ('cell' in cl and 'line' in cl or cl in ('cellline', 'ccle_name', 'ccl_name')) and 'cellline_col' not in col_map:
                col_map['cellline_col'] = c

        # ★ 更宽松的兜底：如果 fusion_name_col 仍未找到，尝试匹配仅含 "fusion" 的列（排除 fusion_transl 等）
        if 'fusion_name_col' not in col_map:
            for c in df_raw.columns:
                cl = c.lower().strip()
                if 'fusion' in cl and 'transl' not in cl and 'function' not in cl and 'type' not in cl:
                    col_map['fusion_name_col'] = c
                    print(f"[CellFusionAll] ★ 宽松兜底匹配 fusion_name_col → '{c}'")
                    break

        # ★ sample_name 兜底：匹配含 "sample" 或 "cell_line" 或 "ccle" 的列
        if 'sample_name_col' not in col_map:
            for c in df_raw.columns:
                cl = c.lower()
                if 'sample' in cl and 'sample_name_col' not in col_map:
                    col_map['sample_name_col'] = c
                    print(f"[CellFusionAll] ★ 宽松兜底匹配 sample_name_col → '{c}'")
                    break

        print(f"[CellFusionAll] 列映射: {col_map}")

        # ★ 打印 fusion_name 列的样本值，帮助排查格式差异
        if 'fusion_name_col' in col_map:
            sample_fusions = df_raw[col_map['fusion_name_col']].dropna().unique()[:10]
            print(f"[CellFusionAll] ★ fusion_name 列样本值（前10）: {list(sample_fusions)}")
        else:
            print(f"[CellFusionAll] ❌ 未检测到 fusion_name 列！可用列: {list(df_raw.columns)}")

        required = ['disease_full_col', 'sample_name_col', 'fusion_name_col', 'ffpm_col']
        missing = [k for k in required if k not in col_map]

        # ★ 更宽松的 disease 列兜底：如果 disease_full_col 没有，尝试含 "disease" 的列
        if 'disease_full_col' in missing:
            for c in df_raw.columns:
                if 'disease' in c.lower():
                    col_map['disease_full_col'] = c
                    missing.remove('disease_full_col')
                    print(f"[CellFusionAll] ★ 宽松兜底匹配 disease_full_col → '{c}'")
                    break

        # ★ 更宽松的 ffpm 列兜底：匹配含 "ffpm" 的列
        if 'ffpm_col' in missing:
            for c in df_raw.columns:
                if 'ffpm' in c.lower():
                    col_map['ffpm_col'] = c
                    missing.remove('ffpm_col')
                    print(f"[CellFusionAll] ★ 宽松兜底匹配 ffpm_col → '{c}'")
                    break

        if missing:
            print(f"[CellFusionAll] ❌ 缺少必要列: {missing}")
            print(f"[CellFusionAll] 可用列名: {list(df_raw.columns)}")
            return

        _df_all = df_raw
        _df_all['_disease_full_clean'] = _df_all[col_map['disease_full_col']].astype(str).str.strip()
        _df_all['_sample_dedup'] = _df_all[col_map['sample_name_col']].apply(_strip_sample_date)
        _df_all['_ffpm_numeric'] = pd.to_numeric(_df_all[col_map['ffpm_col']], errors='coerce').fillna(0)
        _df_all.attrs['col_map'] = col_map
        _top20_param_cache.clear()

        # ★ 预计算每种疾病的去重样本数
        _disease_sample_counts = {}
        disease_groups = _df_all.groupby('_disease_full_clean')
        for disease_name, group in disease_groups:
            if disease_name.lower() in _SKIP:
                continue
            unique_samples = group['_sample_dedup'].nunique()
            _disease_sample_counts[disease_name] = unique_samples

        print(f"[CellFusionAll] 疾病样本计数完成: {len(_disease_sample_counts)} 种疾病")
        # 打印前 10 个
        for i, (d, n) in enumerate(sorted(_disease_sample_counts.items(), key=lambda x: -x[1])[:10]):
            print(f"[CellFusionAll]   {d}: n={n}")

        _precompute_top20_filter_caches()

    except Exception as e:
        print(f"[CellFusionAll] ❌ 加载失败: {e}")
        traceback.print_exc()


def _format_top20_group(grouped, fusion_col: str):
    if grouped.empty:
        return []

    top = grouped.nlargest(20, 'total_fq').reset_index(drop=True)
    return [
        {
            'fusion_name': str(row[fusion_col]),
            'fq_high': int(row['_high']),
            'fq_low': int(row['_low']),
            'total_fq': int(row['total_fq']),
        }
        for _, row in top.iterrows()
    ]


def _precompute_top20_filter_caches():
    """Precompute single-disease and exact-cell-line Top20 results for fast UI filters."""
    global _top20_disease_cache, _top20_cellline_exact_cache

    _top20_disease_cache = {}
    _top20_cellline_exact_cache = {}

    if _df_all is None:
        return

    col_map = _df_all.attrs.get('col_map', {})
    fusion_col = col_map.get('fusion_name_col')
    cellline_col = col_map.get('cellline_col')
    if not fusion_col:
        return

    print("[CellFusionAll] Precomputing disease/cell-line top20 caches...")

    try:
        disease_df = _df_all[
            ~_df_all['_disease_full_clean'].astype(str).str.lower().isin(_SKIP)
        ]
        if not disease_df.empty:
            idx = disease_df.groupby(
                ['_disease_full_clean', fusion_col, '_sample_dedup'],
                sort=False,
            )['_ffpm_numeric'].idxmax()
            dedup = disease_df.loc[idx, ['_disease_full_clean', fusion_col, '_ffpm_numeric']]
            high = dedup['_ffpm_numeric'].ge(0.1)
            disease_grouped = (
                dedup.assign(_high=high.astype('int16'), _low=(~high).astype('int16'))
                .groupby(['_disease_full_clean', fusion_col], sort=False)[['_high', '_low']]
                .sum()
            )
            disease_grouped['total_fq'] = disease_grouped['_high'] + disease_grouped['_low']
            disease_grouped = disease_grouped.reset_index()
            for disease_name, group in disease_grouped.groupby('_disease_full_clean', sort=False):
                _top20_disease_cache[(str(disease_name),)] = _format_top20_group(group, fusion_col)
    except Exception as e:
        print(f"[CellFusionAll] Disease top20 precompute failed: {e}")

    try:
        if cellline_col and cellline_col in _df_all.columns:
            cell_df = _df_all.copy()
            cell_df['_cellline_key'] = cell_df[cellline_col].astype(str).str.strip().str.lower()
            cell_df = cell_df[~cell_df['_cellline_key'].isin(_SKIP)]
            if not cell_df.empty:
                high = cell_df['_ffpm_numeric'].ge(0.1)
                cell_grouped = (
                    cell_df.assign(_high=high.astype('int16'), _low=(~high).astype('int16'))
                    .groupby(['_cellline_key', fusion_col], sort=False)[['_high', '_low']]
                    .sum()
                )
                cell_grouped['total_fq'] = cell_grouped['_high'] + cell_grouped['_low']
                cell_grouped = cell_grouped.reset_index()
                for cell_key, group in cell_grouped.groupby('_cellline_key', sort=False):
                    _top20_cellline_exact_cache[str(cell_key)] = _format_top20_group(group, fusion_col)
    except Exception as e:
        print(f"[CellFusionAll] Cell-line top20 precompute failed: {e}")

    print(
        "[CellFusionAll] Top20 filter caches ready: "
        f"diseases={len(_top20_disease_cache)}, "
        f"cell_lines={len(_top20_cellline_exact_cache)}"
    )


def _compute_top20_from_all(selected_diseases: list):
    """Compute disease-filtered Top 20 from cell_fusion_all.csv with request caching."""
    if _df_all is None:
        return []

    col_map = _df_all.attrs.get('col_map', {})
    fusion_col = col_map.get('fusion_name_col')
    if not fusion_col:
        return []

    cache_key = ('disease', tuple(sorted(set(selected_diseases))))
    cached = _cache_get(_top20_param_cache, cache_key)
    if cached is not None:
        return cached

    disease_key = cache_key[1]
    if len(disease_key) == 1 and disease_key in _top20_disease_cache:
        result = _top20_disease_cache[disease_key]
        _cache_set(_top20_param_cache, cache_key, result, _TOP20_PARAM_CACHE_MAX)
        return result

    target = set(selected_diseases)
    filtered = _df_all[_df_all['_disease_full_clean'].isin(target)]
    if filtered.empty:
        _cache_set(_top20_param_cache, cache_key, [], _TOP20_PARAM_CACHE_MAX)
        return []

    # Keep the max FFPM row for the same fusion/sample pair, then aggregate with vectorized sums.
    idx = filtered.groupby([fusion_col, '_sample_dedup'], sort=False)['_ffpm_numeric'].idxmax()
    dedup = filtered.loc[idx, [fusion_col, '_ffpm_numeric']]
    high = dedup['_ffpm_numeric'].ge(0.1)
    grouped = (
        dedup.assign(_high=high.astype('int16'), _low=(~high).astype('int16'))
        .groupby(fusion_col, sort=False)[['_high', '_low']]
        .sum()
    )
    grouped['total_fq'] = grouped['_high'] + grouped['_low']
    grouped = grouped.nlargest(20, 'total_fq').reset_index()

    result = [
        {
            'fusion_name': str(row[fusion_col]),
            'fq_high': int(row['_high']),
            'fq_low': int(row['_low']),
            'total_fq': int(row['total_fq']),
        }
        for _, row in grouped.iterrows()
    ]
    _cache_set(_top20_param_cache, cache_key, result, _TOP20_PARAM_CACHE_MAX)
    return result


def _compute_top20_cellline_from_all(cell_line_query: str):
    """Compute cell-line-filtered Top 20 from cell_fusion_all.csv with request caching."""
    if _df_all is None:
        return []

    col_map = _df_all.attrs.get('col_map', {})
    fusion_col = col_map.get('fusion_name_col')
    cellline_col = col_map.get('cellline_col')
    if not fusion_col or not cellline_col:
        return []

    cache_key = ('cell_line', cell_line_query.strip().lower())
    cached = _cache_get(_top20_param_cache, cache_key)
    if cached is not None:
        return cached

    cell_key = cell_line_query.strip().lower()
    if cell_key in _top20_cellline_exact_cache:
        result = _top20_cellline_exact_cache[cell_key]
        _cache_set(_top20_param_cache, cache_key, result, _TOP20_PARAM_CACHE_MAX)
        return result

    filtered = _df_all[_df_all[cellline_col].astype(str).str.contains(
        cell_line_query, case=False, na=False, regex=False)]
    if filtered.empty:
        _cache_set(_top20_param_cache, cache_key, [], _TOP20_PARAM_CACHE_MAX)
        return []

    high = filtered['_ffpm_numeric'].ge(0.1)
    grouped = (
        filtered.assign(_high=high.astype('int16'), _low=(~high).astype('int16'))
        .groupby(fusion_col, sort=False)[['_high', '_low']]
        .sum()
    )
    grouped['total_fq'] = grouped['_high'] + grouped['_low']
    grouped = grouped.nlargest(20, 'total_fq').reset_index()

    result = [
        {
            'fusion_name': str(row[fusion_col]),
            'fq_high': int(row['_high']),
            'fq_low': int(row['_low']),
            'total_fq': int(row['total_fq']),
        }
        for _, row in grouped.iterrows()
    ]
    _cache_set(_top20_param_cache, cache_key, result, _TOP20_PARAM_CACHE_MAX)
    return result


def _compute_disease_fq_for_fusion(fusion_name: str) -> dict:
    """
    在 cell_fusion_all.csv 中查找指定 fusion_name 的所有行，
    按 disease_full 分组，对每组内 sample_name 去重计数（日期后缀视为同一样本）。
    返回 {disease_name: count}，按 count 降序排列。
    """
    print(f"[DiseaseFQ] ★ 开始计算 disease_fq: fusion_name='{fusion_name}'")

    if _df_all is None:
        print("[DiseaseFQ] ❌ _df_all 为 None，cell_fusion_all.csv 未加载")
        return {}

    col_map = _df_all.attrs.get('col_map', {})
    fusion_col = col_map.get('fusion_name_col')
    if not fusion_col:
        print(f"[DiseaseFQ] ❌ fusion_name_col 未检测到, col_map={col_map}")
        return {}

    print(f"[DiseaseFQ] 使用列 '{fusion_col}'，总行数={len(_df_all)}")

    # 筛选该融合的所有行（精确匹配）
    all_fusion_names = _df_all[fusion_col].astype(str)
    mask = all_fusion_names == fusion_name
    filtered = _df_all[mask]

    # ★ 如果精确匹配无结果，尝试模糊匹配（忽略分隔符差异）
    if filtered.empty:
        print(f"[DiseaseFQ] ⚠️  精确匹配无结果，尝试模糊匹配...")
        # 打印一些实际存在的融合名，帮助排查格式差异
        sample_names = all_fusion_names.drop_duplicates().head(10).tolist()
        print(f"[DiseaseFQ] cell_fusion_all 中的示例融合名: {sample_names}")

        # 尝试不同的分隔符：-- vs - vs _
        name_normalized = fusion_name.replace('--', '-').replace('_', '-').lower()
        def _normalize_fn(s):
            return str(s).replace('--', '-').replace('_', '-').lower()
        mask_fuzzy = all_fusion_names.apply(_normalize_fn) == name_normalized
        filtered = _df_all[mask_fuzzy]

        if filtered.empty:
            # 再尝试：包含匹配
            mask_contains = all_fusion_names.str.contains(
                fusion_name.replace('--', '.{1,2}'),
                case=False, na=False, regex=True
            )
            filtered = _df_all[mask_contains]
            if not filtered.empty:
                matched_names = filtered[fusion_col].unique()[:5]
                print(f"[DiseaseFQ] ✅ 正则匹配找到 {len(filtered)} 行，匹配的融合名: {list(matched_names)}")

        if filtered.empty:
            print(f"[DiseaseFQ] ❌ 所有匹配方式均无结果")
            return {}
        else:
            matched_names = filtered[fusion_col].unique()[:5]
            print(f"[DiseaseFQ] ✅ 模糊匹配找到 {len(filtered)} 行，匹配的融合名: {list(matched_names)}")
    else:
        print(f"[DiseaseFQ] ✅ 精确匹配找到 {len(filtered)} 行")

    # 按 disease_full 分组，统计去重样本数
    result = {}
    for disease_name, group in filtered.groupby('_disease_full_clean'):
        if disease_name.lower() in _SKIP:
            continue
        unique_count = group['_sample_dedup'].nunique()
        result[disease_name] = unique_count
        print(f"[DiseaseFQ]   {disease_name}: {unique_count} 个去重样本")

    # 按计数降序排列
    sorted_result = dict(sorted(result.items(), key=lambda x: -x[1]))
    print(f"[DiseaseFQ] ★ 最终结果: {sorted_result}")
    return sorted_result


def _compute_tissue_fq_for_fusion(fusion_name: str) -> dict:
    """
    在 cellfusion_final.csv 中查找指定 fusion_name 的所有行，
    按 tissue 值计数（每行一个计数，多值用分隔符拆分）。
    返回 {tissue_name: count}，按 count 降序排列。
    """
    if _df is None:
        return {}
    cols = _col_info
    if 'tissue_col' not in cols or 'fusion_col' not in cols:
        return {}

    fc = cols['fusion_col']
    tc = cols['tissue_col']
    mask = _df[fc].astype(str) == fusion_name
    filtered = _df[mask]

    if filtered.empty:
        return {}

    result = {}
    for val in filtered[tc].astype(str):
        val = val.strip()
        if not val or val.lower() in _SKIP:
            continue
        # 支持 "," 或 ";" 分隔的多值
        for tissue in val.replace(';', ',').split(','):
            t = tissue.strip()
            if t and t.lower() not in _SKIP:
                result[t] = result.get(t, 0) + 1

    return dict(sorted(result.items(), key=lambda x: -x[1]))


def _build_fusion_map(df: pd.DataFrame, cols: dict) -> dict:
    fc = cols['fusion_col']
    optional_cols = [
        cols[k] for k in ('disease_col', 'cell_line_col', 'tissue_col')
        if k in cols and cols[k] in df.columns
    ]
    if not optional_cols:
        return {}

    # Startup speed matters more than a full joined string here. Frequency plots and detail
    # rows still use the source tables; this map is only a compact summary for the detail page.
    first_rows = df[[fc, *optional_cols]].dropna(subset=[fc]).drop_duplicates(subset=[fc], keep='first')
    result = {}
    for row in first_rows.itertuples(index=False):
        values = dict(zip([fc, *optional_cols], row))
        fn = str(values.get(fc, '')).strip()
        if not fn:
            continue
        result[fn] = {
            'disease': str(values.get(cols.get('disease_col'), '') or ''),
            'cell_line': str(values.get(cols.get('cell_line_col'), '') or ''),
            'tissue': str(values.get(cols.get('tissue_col'), '') or ''),
        }
    return result


def _compute_top20(df, cols, selected_diseases=None, cell_line_filter=None):
    fc, fqc, lc, hc = cols['fusion_col'], cols['fq_col'], cols['low_col'], cols['high_col']
    filtered = df

    if selected_diseases:
        target = set(selected_diseases)
        mask = filtered['_disease_set'].apply(lambda s: bool(s & target))
        filtered = filtered[mask]

    if cell_line_filter:
        clc = cols.get('cell_line_col')
        if clc:
            mask = filtered[clc].astype(str).str.contains(
                cell_line_filter, case=False, na=False, regex=False)
            filtered = filtered[mask]

    if filtered.empty:
        return []

    # ★ 不再聚合，直接按 fq 降序排列取前 20 行
    sorted_df = filtered.sort_values(fqc, ascending=False).head(20)
    return [
        {
            'fusion_name': str(row[fc]),
            'fq_high':   round(float(row[hc]),  2),
            'fq_low':    round(float(row[lc]),   2),
            'total_fq':  round(float(row[fqc]), 2),
        }
        for _, row in sorted_df.iterrows()
    ]


# ═══════════════════════════════════════════════════
# 路由
# ═══════════════════════════════════════════════════

@cellfusion_bp.route('/top20', methods=['GET'])
@jwt_required()
def get_top20():
    if _df is None:
        return jsonify({'code': 503, 'message': 'cellfusion data not loaded'}), 503

    diseases_str = request.args.get('diseases', '').strip()
    cell_line    = request.args.get('cell_line', '').strip()

    selected = [d.strip() for d in diseases_str.split('|') if d.strip()] if diseases_str else []

    if selected:
        # ★ 疾病筛选：使用 cell_fusion_all.csv
        if _df_all is not None:
            data = _compute_top20_from_all(selected)
        else:
            # 降级：若 cell_fusion_all 未加载，仍用旧逻辑
            data = _compute_top20(_df, _col_info, selected_diseases=selected)
    elif cell_line:
        # ★ 细胞系筛选：也使用 cell_fusion_all.csv
        if _df_all is not None:
            data = _compute_top20_cellline_from_all(cell_line)
        else:
            data = _compute_top20(_df, _col_info, cell_line_filter=cell_line)
    else:
        data = _top20_cache or []

    return jsonify({'code': 200, 'data': data})


@cellfusion_bp.route('/diseases', methods=['GET'])
@jwt_required()
def get_diseases():
    if _diseases_cache is None:
        return jsonify({'code': 503, 'message': 'not loaded'}), 503
    return jsonify({'code': 200, 'data': _diseases_cache})


@cellfusion_bp.route('/disease-sample-counts', methods=['GET'])
@jwt_required()
def get_disease_sample_counts():
    """
    返回每种疾病的去重样本数（从 cell_fusion_all.csv 计算）。
    响应: { code: 200, data: { "carcinoma": 45, "carcinoma (adenocarcinoma)": 120, ... } }
    """
    if _disease_sample_counts is None:
        return jsonify({'code': 503, 'message': 'cell_fusion_all data not loaded'}), 503
    return jsonify({'code': 200, 'data': _disease_sample_counts})


@cellfusion_bp.route('/cellline-download', methods=['GET'])
@jwt_required(optional=True)
def download_cellline_csv():
    """
    下载指定细胞系在 cell_fusion_all.csv 中的所有相关行，返回 CSV 文件。
    参数: ?cell_line=HeLa
    """
    cell_line_query = request.args.get('cell_line', '').strip()
    if not cell_line_query:
        return jsonify({'code': 400, 'message': 'cell_line parameter required'}), 400

    if _df_all is None:
        return jsonify({'code': 503, 'message': 'cell_fusion_all data not loaded'}), 503

    col_map = _df_all.attrs.get('col_map', {})
    cellline_col = col_map.get('cellline_col')
    if not cellline_col:
        return jsonify({'code': 503, 'message': 'cellline column not detected'}), 503

    # 模糊匹配
    mask = _df_all[cellline_col].astype(str).str.contains(
        cell_line_query, case=False, na=False, regex=False)
    filtered = _df_all[mask]

    if filtered.empty:
        return jsonify({'code': 404, 'message': f'No data found for cell line: {cell_line_query}'}), 404

    # 只返回原始列（排除内部辅助列）
    export_cols = [c for c in filtered.columns if not c.startswith('_')]
    csv_data = filtered[export_cols].to_csv(index=False)

    resp = make_response(csv_data)
    safe_name = cell_line_query.replace(' ', '_').replace('/', '_')
    resp.headers['Content-Type'] = 'text/csv; charset=utf-8'
    resp.headers['Content-Disposition'] = f'attachment; filename="cellfusion_{safe_name}.csv"'
    return resp


@cellfusion_bp.route('/tissue-disease-map', methods=['GET'])
@jwt_required()
def get_tissue_disease_map():
    if _td_map_cache is None:
        return jsonify({'code': 503, 'message': 'not loaded'}), 503
    return jsonify({'code': 200, 'data': _td_map_cache})


@cellfusion_bp.route('/search', methods=['GET'])
@jwt_required()
def search_cellfusion():
    if _df is None:
        return jsonify({'code': 503, 'message': 'not loaded'}), 503

    cols = _col_info
    q          = request.args.get('q',         '').strip()
    cell_line  = request.args.get('cell_line', '').strip()
    diseases_s = request.args.get('diseases',  '').strip()
    limit      = min(int(request.args.get('limit', 2000)), 10000)

    filtered = _df

    if q:
        fc = cols['fusion_col']
        if q.upper().startswith('CL') and cols.get('squeue_col'):
            sid = _normalize_cellfusion_squeue(q)
            sc = cols['squeue_col']
            filtered = filtered[filtered[sc].apply(_normalize_cellfusion_squeue) == sid]
        else:
            filtered = filtered[filtered[fc].astype(str).str.contains(q, case=False, na=False, regex=False)]

    if cell_line and 'cell_line_col' in cols:
        clc = cols['cell_line_col']
        filtered = filtered[filtered[clc].astype(str).str.contains(cell_line, case=False, na=False, regex=False)]

    if diseases_s:
        if '|' in diseases_s:
            target = set(d.strip() for d in diseases_s.split('|') if d.strip())
            mask = filtered['_disease_set'].apply(lambda s: bool(s & target))
            filtered = filtered[mask]
        else:
            dc = cols.get('disease_col')
            if dc:
                filtered = filtered[filtered[dc].astype(str).str.contains(
                    diseases_s, case=False, na=False, regex=False)]

    if filtered.empty:
        return jsonify({'code': 200, 'data': {'items': [], 'total': 0}})

    def _val(row, col_key, default=''):
        c = cols.get(col_key)
        if not c:
            return default
        v = row.get(c, default)
        if v is None or (isinstance(v, float) and v != v):
            return default
        s = str(v).strip()
        if col_key == 'disease_col':
            s = s.replace('\\,', ',')
        return s if s.lower() not in _SKIP else default

    items = []
    for _, row in filtered.head(limit).iterrows():
        squeue_val = _val(row, 'squeue_col')
        display_id = _cellfusion_display_id(squeue_val)
        items.append({
            'id':               display_id,
            'display_id':       display_id,
            'squeue':           _normalize_cellfusion_squeue(squeue_val),
            'fusion_name':      _val(row, 'fusion_col'),
            'fq':               float(row[cols['fq_col']]) if 'fq_col' in cols else 0,
            'left_breakpoint':  _val(row, 'left_bp_col'),
            'right_breakpoint': _val(row, 'right_bp_col'),
            'annots':           _val(row, 'annots_col'),
            'avg_ffpm':         float(row[cols['avg_ffpm_col']]) if 'avg_ffpm_col' in cols and str(row.get(cols['avg_ffpm_col'], '')).strip() not in ('', 'nan') else None,
            'cell_line':        _val(row, 'cell_line_col'),
            'tissue':           _val(row, 'tissue_col'),
            'disease':          _val(row, 'disease_col'),
        })

    return jsonify({'code': 200, 'data': {'items': items, 'total': len(items)}})


@cellfusion_bp.route('/status', methods=['GET'])
def get_status():
    return jsonify({
        'code': 200, 'loaded': _df is not None,
        'rows': int(len(_df)) if _df is not None else 0,
        'col_map': _col_info,
        'diseases_count': len(_diseases_cache) if _diseases_cache else 0,
        'map_count': len(_td_map_cache) if _td_map_cache else 0,
        # ★ 细胞系专属列检测结果（排查 N/A 问题）
        'cellfusion_cols_detected': {
            'function_left':  _col_info.get('function_left_col'),
            'function_right': _col_info.get('function_right_col'),
            'cds_left':       _col_info.get('cds_left_col'),
            'cds_right':      _col_info.get('cds_right_col'),
            'fusion_transl':  _col_info.get('fusion_transl_col'),
        },
    })


# ═══════════════════════════════════════════════════════════════════════════════
# ★ /by-name/<fusion_name>  — 关键修复：添加路由装饰器！
# 返回指定融合的所有 cell-line 行（逐行数据 + 聚合摘要）
# 同时为每行写入 Arriba sidecar JSON，供 arriba/cellfusion/diagram 路由使用
# PDF 命名规则：{fusion_name}_{N}.pdf（N 按 fq 降序从 1 开始）
# ═══════════════════════════════════════════════════════════════════════════════
@cellfusion_bp.route('/by-name/<path:fusion_name>', methods=['GET'])
@jwt_required(optional=True)
def get_cellfusion_by_name(fusion_name):
    """
    返回 cellfusion_final.csv 中指定 fusion_name 的所有行数据。
    响应结构：
    {
      "code": 200,
      "data": {
        "items":      [  ... 逐行记录，含 id="{fusion_name}_N"、variant_num=N、各字段 ... ],
        "total":      N,
        "columns":    [  ... 供前端渲染详细数据表格的列名列表 ... ],
        "aggregated": {
          "cell_line": "MCF7; HeLa; ...",
          "tissue":    "...",
          "disease":   "..."
        }
      }
    }
    同时将每行 Arriba 所需字段写入 {_CELLFUSION_ARRIBA_DIR}/{id}.json
    arriba_routes.py 会据此生成 {id}.pdf
    """
    if _df is None:
        return jsonify({'code': 503, 'message': 'cellfusion data not loaded'}), 503

    cols = _col_info
    fc = cols['fusion_col']

    # ── 精确匹配 fusion_name ──────────────────────────────────────────────────
    mask = _df[fc].astype(str) == fusion_name
    filtered = _df[mask]

    if filtered.empty:
        return jsonify({'code': 404, 'message': f'Fusion not found: {fusion_name}'}), 404

    def _val(row, col_key, default=''):
        c = cols.get(col_key)
        if not c:
            return default
        v = row.get(c, default)
        if v is None or (isinstance(v, float) and v != v):
            return default
        s = str(v).strip()
        if col_key == 'disease_col':
            s = s.replace('\\,', ',')
        return s if s.lower() not in _SKIP else default

    # ── 从 fusion_name 提取左右基因名（作为兜底） ──────────────────────────
    #   正常情况下会从 CSV 的 LeftGene/RightGene 列读取完整 "name^ENSG..." 字符串
    #   这里的 default 仅在 CSV 缺少这两列时作为后备使用
    name_parts  = fusion_name.split('--')
    default_left_gene   = name_parts[0] if len(name_parts) >= 2 else fusion_name
    default_right_gene  = name_parts[1] if len(name_parts) >= 2 else ''

    # 整个融合名只查询一次 PASS 兜底（若 CSV 中 gene 列缺失）
    pass_info = _lookup_pass_fusion_info(fusion_name, default_left_gene, default_right_gene)

    # 工具函数：从原始 "ZNF654^ENSG00000175105.8" 中提取干净基因名
    def _clean_gene(s):
        if not s: return ''
        return str(s).split('^')[0].strip()

    items = []
    for _, row in filtered.iterrows():
        left_bp  = _val(row, 'left_bp_col')
        right_bp = _val(row, 'right_bp_col')
        squeue_val = _val(row, 'squeue_col')
        squeue_id = _normalize_cellfusion_squeue(squeue_val)

        # ★ 从 CSV 读取完整 gene 字符串（"ZNF654^ENSG00000175105.8"）
        csv_left_gene_full  = _val(row, 'left_gene_col')
        csv_right_gene_full = _val(row, 'right_gene_col')

        # 解析：优先用 CSV 里的完整串；缺失则退回 PASS 查找；再不行用纯基因名
        if csv_left_gene_full and '^' in csv_left_gene_full:
            full_left = csv_left_gene_full
        elif '^' in pass_info['left_gene_full']:
            full_left = pass_info['left_gene_full']
        else:
            full_left = default_left_gene

        if csv_right_gene_full and '^' in csv_right_gene_full:
            full_right = csv_right_gene_full
        elif '^' in pass_info['right_gene_full']:
            full_right = pass_info['right_gene_full']
        else:
            full_right = default_right_gene

        # 基因名的干净版本（用于前端显示，不含 ENSG 后缀）
        clean_left  = _clean_gene(full_left)  or default_left_gene
        clean_right = _clean_gene(full_right) or default_right_gene

        fq_val   = float(row[cols['fq_col']]) if 'fq_col' in cols else 0.0
        high_val = float(row[cols['high_col']]) if 'high_col' in cols else 0.0
        low_val  = float(row[cols['low_col']])  if 'low_col' in cols else 0.0
        ffpm_col = cols.get('avg_ffpm_col')
        avg_ffpm = (
            float(row[ffpm_col])
            if ffpm_col and str(row.get(ffpm_col, '')).strip() not in ('', 'nan')
            else None
        )

        items.append({
            'id':              None,          # 下面按 fq 排序后再赋值
            'display_id':      None,
            'squeue':          squeue_id,
            'variant_num':     None,          # 变体序号（前端显示 V1/V2/...）
            'fusion_name':     fusion_name,
            'left_gene':       clean_left,    # 纯基因名（供前端显示，保持现有 UI 一致）
            'right_gene':      clean_right,
            # ★ 暂存完整串（含 ENSG），写 sidecar 时用；前端用不到但保留
            '_left_gene_full':  full_left,
            '_right_gene_full': full_right,
            'left_breakpoint': left_bp,
            'right_breakpoint':right_bp,
            'annots':          _val(row, 'annots_col'),
            'avg_ffpm':        avg_ffpm,
            'fq':              fq_val,
            'fq_high':         round(high_val, 4),
            'fq_low':          round(low_val, 4),
            'cell_line':       _val(row, 'cell_line_col'),
            'tissue':          _val(row, 'tissue_col'),
            'disease':         _val(row, 'disease_col'),
            'avg_junction_read_count': round(high_val, 2),
            'avg_spanning_frag_count': round(low_val, 2),
            # ★ 从 CSV 读取实际值
            'result_function_left':  _val(row, 'function_left_col'),
            'result_function_right': _val(row, 'function_right_col'),
            'left_cds_status':       _val(row, 'cds_left_col'),
            'right_cds_status':      _val(row, 'cds_right_col'),
            'fusion_transl':         _val(row, 'fusion_transl_col') or '.',
            # prot_fusion_type：CSV 中没有此列，根据 fusion_transl 推断
            'prot_fusion_type': '',
            'sample_name':           _val(row, 'cell_line_col'),
        })

    # ── 先按 fq 降序排列，再按序号命名 ID ──────────────────────────────────
    items.sort(key=lambda x: x['fq'], reverse=True)

    # ID 格式：{fusion_name}_1, {fusion_name}_2 …
    # 与 arriba_routes.py 缓存文件名完全一致：{id}.pdf / {id}.json
    for idx, item in enumerate(items):
        variant_num = idx + 1
        cf_id = _cellfusion_display_id(item.get('squeue'), variant_num)
        item['id']          = cf_id
        item['display_id']  = cf_id
        item['variant_num'] = variant_num

        # ── 写入 Arriba sidecar JSON（若不存在则写入） ──────────────────────
        # ★ sidecar 与 API 响应分开：
        #    sidecar 存完整 "name^ENSG..." 用于 Arriba 画图
        #    API 响应保持纯基因名，给前端显示用（不改原有 UI）
        sidecar_path = os.path.join(_CELLFUSION_ARRIBA_DIR, f"{cf_id}.json")
        if not os.path.exists(sidecar_path):
            try:
                sidecar_item = {
                    **item,
                    'left_gene':    item['_left_gene_full'],   # 完整 "ZNF654^ENSG00000175105.8"
                    'right_gene':   item['_right_gene_full'],
                    'cds_left_id':  pass_info['cds_left_id'],
                    'cds_right_id': pass_info['cds_right_id'],
                }
                # 移除临时字段
                sidecar_item.pop('_left_gene_full',  None)
                sidecar_item.pop('_right_gene_full', None)
                with open(sidecar_path, 'w', encoding='utf-8') as f:
                    json.dump(sidecar_item, f, ensure_ascii=False)
                print(f"[CellFusion] sidecar 写入 {cf_id} | "
                      f"{item['_left_gene_full']} -- {item['_right_gene_full']}")
            except Exception as e:
                print(f"[CellFusion] sidecar 写入失败 {cf_id}: {e}")

    # 移除 API 响应里的临时字段（不返回给前端）
    # ★ 保留 left_gene_full / right_gene_full 供蛋白预测组件做 UniProt 查询
    for item in items:
        full_left  = item.pop('_left_gene_full',  None)
        full_right = item.pop('_right_gene_full', None)
        item['left_gene_full']  = full_left  or item.get('left_gene', '')
        item['right_gene_full'] = full_right or item.get('right_gene', '')

    # ── 列名列表（用于前端渲染详细数据表格） ───────────────────────────────
    if items:
        columns = [k for k in items[0].keys() if not k.startswith('_')]
    else:
        columns = []

    # ── 聚合摘要（来自预计算的 td_map_cache） ──────────────────────────────
    td_entry = (_td_map_cache or {}).get(fusion_name, {})

    # ★ 从 cell_fusion_all.csv 计算每种 disease 的去重样本计数
    disease_fq = _compute_disease_fq_for_fusion(fusion_name)
    print(f"[CellFusion] ★ disease_fq for '{fusion_name}': {disease_fq}")

    # ★ 从 cellfusion_final.csv 计算每种 tissue 的行数计数
    tissue_fq = _compute_tissue_fq_for_fusion(fusion_name)

    aggregated = {
        'cell_line':  td_entry.get('cell_line', ''),
        'tissue':     td_entry.get('tissue', ''),
        'disease':    td_entry.get('disease', ''),
        'disease_fq': disease_fq,   # ★ {disease_name: unique_sample_count}
        'tissue_fq':  tissue_fq,    # ★ {tissue_name: row_count}
        'global_avg_junction': (_cellfusion_global_stats or {}).get('avg_junction', 1.92),
        'global_avg_spanning': (_cellfusion_global_stats or {}).get('avg_spanning', 0.68),
    }
    print(f"[CellFusion] ★ aggregated.disease_fq type={type(disease_fq).__name__}, len={len(disease_fq)}")

    return jsonify({
        'code': 200,
        'data': {
            'items':      items,
            'total':      len(items),
            'columns':    columns,
            'aggregated': aggregated,
        }
    })
