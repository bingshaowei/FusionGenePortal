# backend/routes/fusion_deleted_routes.py  v3
# 修复点：
#   1. /search/advanced 支持 id_search=true + search=TF{n} 精确定位 squeue 行
#   2. 去掉对"基因列名"的强假设，改为运行时扫描所有列名
#   3. /columns 接口返回实际列名列表（帮助前端调试）
#   4. [v3] COL_CANDIDATES 加入 spanningFrag，_serialize_row 正确输出该字段

from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required
import os
import csv

deleted_bp = Blueprint('deleted', __name__)

# ==================== 内存缓存 ====================
_deleted_rows = None        # list of dicts（包含 _fq 内部排序字段）
_deleted_filters = None     # sorted list of unique Filter values
_deleted_columns = None     # CSV 真实列名列表（不含 _fq）
_col_map = None             # 运行时检测到的逻辑字段 → 真实列名映射

CSV_PATH = os.path.join(os.path.dirname(__file__), '..', 'fusiondeleted.csv')

# 逻辑字段 → 候选列名（顺序即优先级）
COL_CANDIDATES = {
    'fusionName':      ['Fusion.Name', '#FusionName', 'FusionName', 'fusion_name', 'x.FusionName'],
    'squeue':          ['squeue', 'Squeue', 'SQUEUE', 'seq', 'Seq', 'SEQ', 'SequenceID'],
    'leftGene':        ['LeftGene', 'left_gene', 'Left_Gene', 'GeneA', '#LeftGene'],
    'leftBreakpoint':  ['LeftLocalBreakpoint', 'left_breakpoint', 'LeftBreakpoint'],
    'rightGene':       ['RightGene', 'right_gene', 'Right_Gene', 'GeneB'],
    'rightBreakpoint': ['RightLocalBreakpoint', 'right_breakpoint', 'RightBreakpoint'],
    'annots':          ['annots', 'Annots', 'ANNOTS', 'annotation'],
    'junction':        ['JunctionReadCount', 'junction_read_count', 'JunctionReads', 'est_J'],
    # [v3] SpanningFragCount 列，与 JunctionReadCount 并列作为可视化数据源
    'spanningFrag':    ['SpanningFragCount', 'Spanning.Frag.Count', 'spanning_frag_count',
                        'SpanningFragments', 'est_S', 'spanning_frag'],
    'ffpm':            ['FFPM.cal', 'ffpm', 'FFPM', 'avg_ffpm', 'FFPM.CAL'],
    'filter':          ['Filter', 'filter', 'FILTER'],
}


def _detect_col_map(sample_row):
    """根据第一行数据检测逻辑字段对应的真实列名"""
    detected = {}
    for field, candidates in COL_CANDIDATES.items():
        for c in candidates:
            if c in sample_row:
                detected[field] = c
                break
    print(f"[DELETED-CACHE] 列名映射: {detected}")
    return detected


def _get_col(row, field):
    """从行中取逻辑字段值，优先用检测到的列名"""
    if _col_map and field in _col_map:
        return row.get(_col_map[field])
    # fallback: 遍历候选列名
    for c in COL_CANDIDATES.get(field, []):
        if c in row:
            return row[c]
    return None


def _load_deleted_csv():
    global _deleted_rows, _deleted_filters, _deleted_columns, _col_map
    try:
        print(f"[DELETED-CACHE] 开始加载: {CSV_PATH}")
        rows = []
        filters_set = set()

        with open(CSV_PATH, mode="r", encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f, delimiter=",")
            if reader.fieldnames:
                reader.fieldnames = [fn.replace("\ufeff", "").strip() for fn in reader.fieldnames]

            for row in reader:
                row = {(k.replace("\ufeff", "").strip() if isinstance(k, str) else k): v for k, v in row.items()}
                try:
                    row['_fq'] = float(row.get('JunctionReadCount', 0) or 0)
                except (ValueError, TypeError):
                    row['_fq'] = 0.0
                fval = (row.get('Filter') or '').strip()
                if fval:
                    filters_set.add(fval)
                rows.append(row)

        _deleted_rows = rows
        _deleted_filters = sorted(filters_set)
        # 记录真实列名（过滤内部字段）
        _deleted_columns = [k for k in (rows[0].keys() if rows else []) if not k.startswith('_')]
        # 运行时检测列名映射
        _col_map = _detect_col_map(rows[0]) if rows else {}

        print(f"[DELETED-CACHE] 加载完成: {len(rows)} 行, {len(_deleted_filters)} 个 Filter 类型")
        print(f"[DELETED-CACHE] 列名({len(_deleted_columns)}个): {_deleted_columns}")
        # [v3] 明确打印 spanningFrag 的检测结果，方便确认
        print(f"[DELETED-CACHE] spanningFrag 映射到: {_col_map.get('spanningFrag', '(未找到)')}")

    except FileNotFoundError:
        print(f"[DELETED-CACHE] 文件未找到: {CSV_PATH}")
        _deleted_rows = []; _deleted_filters = []; _deleted_columns = []; _col_map = {}
    except Exception as e:
        import traceback; traceback.print_exc()
        _deleted_rows = []; _deleted_filters = []; _deleted_columns = []; _col_map = {}


def _ensure_loaded():
    if _deleted_rows is None:
        _load_deleted_csv()


def _serialize_row(row):
    """
    将原始 CSV 行序列化为前端消费的字典。
    逻辑字段（fusionName / leftGene / spanningFrag 等）用统一 key 输出，
    确保前端不论 CSV 列名如何变化，都能通过固定 key 读取数据。
    """
    out = {}

    # 1. 输出所有逻辑字段（包含 [v3] 新增的 spanningFrag）
    for field in COL_CANDIDATES.keys():
        val = _get_col(row, field)
        out[field] = '' if val is None else val

    # 2. 把 _fq 也输出给前端（Circos/Network 排序用）
    out['fq'] = row.get('_fq', 0.0)

    # 3. 附带未被逻辑字段覆盖的原始列（保持向后兼容）
    for k, v in row.items():
        if not k.startswith('_') and k not in out:
            out[k] = v

    return out


# ==================== TF前缀解析 ====================

def is_tf_prefixed_id(search_str):
    upper = search_str.upper()
    if upper.startswith('TF') and len(search_str) > 2:
        return search_str[2:].isdigit()
    return False


def extract_tf_squeue_id(search_str):
    """返回字符串形式的 squeue 编号"""
    return search_str[2:] if is_tf_prefixed_id(search_str) else None


# ==================== 路由 ====================

@deleted_bp.route('/filters', methods=['GET'])
@jwt_required(optional=True)
def get_filter_types():
    _ensure_loaded()
    return jsonify({'code': 200, 'message': 'success', 'data': _deleted_filters or []}), 200


@deleted_bp.route('/columns', methods=['GET'])
@jwt_required(optional=True)
def get_columns():
    """返回 CSV 真实列名及逻辑字段映射（供前端调试）"""
    _ensure_loaded()
    return jsonify({
        'code': 200, 'message': 'success',
        'data': {
            'columns': _deleted_columns or [],
            'col_map': _col_map or {}
        }
    }), 200


@deleted_bp.route('/top100', methods=['GET'])
@jwt_required(optional=True)
def get_top100_deleted():
    _ensure_loaded()
    filter_type = request.args.get('filter_type', '', type=str).strip()
    rows = _deleted_rows or []
    if filter_type:
        rows = [r for r in rows if (r.get('Filter') or '').strip() == filter_type]
    top100 = sorted(rows, key=lambda r: r.get('_fq', 0.0), reverse=True)[:100]
    return jsonify({'code': 200, 'message': 'success', 'data': {'items': [_serialize_row(r) for r in top100], 'total': len(top100), 'filter_type': filter_type}}), 200


@deleted_bp.route('/stats', methods=['GET'])
@jwt_required(optional=True)
def get_deleted_stats():
    _ensure_loaded()
    return jsonify({'code': 200, 'message': 'success', 'data': {'total': len(_deleted_rows or []), 'filter_types': len(_deleted_filters or [])}}), 200


@deleted_bp.route('/search/advanced', methods=['GET'])
@jwt_required(optional=True)
def deleted_advanced_search():
    """
    FILTER 数据高级搜索
    - id_search=true + search=TF{n}  → 按 squeue 精确定位
    - 普通搜索                        → 文本匹配 fusionName / leftGene / rightGene
    - left_chr / right_chr           → 从断点列提取染色体前缀匹配
    - left_gene / right_gene         → 基因列前缀匹配
    - filter_type                    → Filter 列精确匹配
    """
    _ensure_loaded()
    try:
        search = request.args.get('search', '', type=str).strip()
        id_search = request.args.get('id_search', 'false', type=str).lower() == 'true'
        left_chr = request.args.get('left_chr', '', type=str).strip()
        right_chr = request.args.get('right_chr', '', type=str).strip()
        left_gene_filter = request.args.get('left_gene', '', type=str).strip()
        right_gene_filter = request.args.get('right_gene', '', type=str).strip()
        filter_type = request.args.get('filter_type', '', type=str).strip()
        sort_by = request.args.get('sort_by', 'fq', type=str)
        sort_order = request.args.get('sort_order', 'desc', type=str).lower()

        rows = list(_deleted_rows or [])

        # ===== TF前缀 ID 精确搜索 =====
        if search and (id_search or is_tf_prefixed_id(search)):
            squeue_id = extract_tf_squeue_id(search) if is_tf_prefixed_id(search) else search[2:] if search.upper().startswith('TF') else None
            if squeue_id:
                print(f"[DELETED ID搜索] squeue_id={squeue_id}")
                squeue_col = _col_map.get('squeue') if _col_map else None
                matched = []
                for row in rows:
                    if squeue_col and str(row.get(squeue_col, '')).strip() == squeue_id:
                        matched.append(_serialize_row(row))
                    elif not squeue_col:
                        for c in COL_CANDIDATES['squeue']:
                            if c in row and str(row[c]).strip() == squeue_id:
                                matched.append(_serialize_row(row))
                                break
                return jsonify({'code': 200, 'message': 'success', 'data': {'items': matched, 'total': len(matched), 'search_type': 'tf_id'}}), 200

        # ===== Filter 类型筛选 =====
        filter_col = _col_map.get('filter', 'Filter') if _col_map else 'Filter'
        if filter_type:
            rows = [r for r in rows if (r.get(filter_col) or '').strip() == filter_type]

        # ===== 全局文本搜索 =====
        if search:
            search_lower = search.lower()
            search_cols = []
            for field in ('fusionName', 'leftGene', 'rightGene'):
                col = _col_map.get(field) if _col_map else None
                if col:
                    search_cols.append(col)
                else:
                    search_cols.extend(COL_CANDIDATES[field])

            def row_matches(row):
                for col in search_cols:
                    if col in row and search_lower in (row[col] or '').lower():
                        return True
                return False
            rows = [r for r in rows if row_matches(r)]

        # ===== 染色体筛选 =====
        if left_chr:
            lc = left_chr.lower()
            bp_col = _col_map.get('leftBreakpoint') if _col_map else None
            bp_candidates = [bp_col] + COL_CANDIDATES['leftBreakpoint'] if bp_col else COL_CANDIDATES['leftBreakpoint']
            def matches_left_chr(row):
                for c in bp_candidates:
                    if c and c in row:
                        v = (row[c] or '').lower()
                        if v.startswith(lc + ':') or v.startswith(lc + '_'):
                            return True
                return False
            rows = [r for r in rows if matches_left_chr(r)]

        if right_chr:
            rc = right_chr.lower()
            bp_col = _col_map.get('rightBreakpoint') if _col_map else None
            bp_candidates = [bp_col] + COL_CANDIDATES['rightBreakpoint'] if bp_col else COL_CANDIDATES['rightBreakpoint']
            def matches_right_chr(row):
                for c in bp_candidates:
                    if c and c in row:
                        v = (row[c] or '').lower()
                        if v.startswith(rc + ':') or v.startswith(rc + '_'):
                            return True
                return False
            rows = [r for r in rows if matches_right_chr(r)]

        # ===== 基因筛选 =====
        if left_gene_filter:
            lg = left_gene_filter.lower()
            lg_col = _col_map.get('leftGene') if _col_map else None
            lg_candidates = [lg_col] + COL_CANDIDATES['leftGene'] if lg_col else COL_CANDIDATES['leftGene']
            def matches_left_gene(row):
                for c in lg_candidates:
                    if c and c in row and (row[c] or '').lower().startswith(lg):
                        return True
                return False
            rows = [r for r in rows if matches_left_gene(r)]

        if right_gene_filter:
            rg = right_gene_filter.lower()
            rg_col = _col_map.get('rightGene') if _col_map else None
            rg_candidates = [rg_col] + COL_CANDIDATES['rightGene'] if rg_col else COL_CANDIDATES['rightGene']
            def matches_right_gene(row):
                for c in rg_candidates:
                    if c and c in row and (row[c] or '').lower().startswith(rg):
                        return True
                return False
            rows = [r for r in rows if matches_right_gene(r)]

        # ===== 排序 =====
        reverse = (sort_order == 'desc')
        if sort_by in ('fq', 'JunctionReadCount', 'junctionreadcount', 'junction'):
            rows = sorted(rows, key=lambda r: r.get('_fq', 0.0), reverse=reverse)
        elif sort_by == 'avg_ffpm':
            ffpm_col = _col_map.get('ffpm') if _col_map else None
            def get_ffpm(r):
                val = r.get(ffpm_col) if ffpm_col else None
                if val is None:
                    for c in COL_CANDIDATES['ffpm']:
                        if c in r:
                            val = r[c]
                            break
                try: return float(val or 0)
                except: return 0.0
            rows = sorted(rows, key=get_ffpm, reverse=reverse)
        else:
            rows = sorted(rows, key=lambda r: r.get('_fq', 0.0), reverse=reverse)

        items = [_serialize_row(r) for r in rows]
        return jsonify({
            'code': 200, 'message': 'success',
            'data': {
                'items': items, 'total': len(items),
                'search': search, 'search_type': 'text',
                'left_chr': left_chr, 'right_chr': right_chr,
                'left_gene': left_gene_filter, 'right_gene': right_gene_filter,
                'filter_type': filter_type,
                'sort_by': sort_by, 'sort_order': sort_order,
                'col_map': _col_map or {}
            }
        }), 200

    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'code': 500, 'message': f'FILTER搜索失败: {str(e)}'}), 500


@deleted_bp.route('/search/network', methods=['GET'])
@jwt_required(optional=True)
def deleted_network_search():
    _ensure_loaded()
    try:
        search = request.args.get('search', '', type=str).strip()
        filter_type = request.args.get('filter_type', '', type=str).strip()
        limit = request.args.get('limit', 2000, type=int)

        if not search and not filter_type:
            return jsonify({'code': 200, 'message': 'success', 'data': {'items': [], 'total': 0}}), 200

        rows = list(_deleted_rows or [])
        filter_col = _col_map.get('filter', 'Filter') if _col_map else 'Filter'

        if filter_type:
            rows = [r for r in rows if (r.get(filter_col) or '').strip() == filter_type]

        if search and not is_tf_prefixed_id(search):
            search_lower = search.lower()
            search_cols = []
            for field in ('fusionName', 'leftGene', 'rightGene'):
                col = _col_map.get(field) if _col_map else None
                if col: search_cols.append(col)
                else: search_cols.extend(COL_CANDIDATES[field])
            def row_matches(row):
                for c in search_cols:
                    if c in row and search_lower in (row[c] or '').lower(): return True
                return False
            rows = [r for r in rows if row_matches(r)]

        rows = sorted(rows, key=lambda r: r.get('_fq', 0.0), reverse=True)[:limit]
        items = [_serialize_row(r) for r in rows]
        return jsonify({'code': 200, 'message': 'success', 'data': {'items': items, 'total': len(items)}}), 200

    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'code': 500, 'message': f'FILTER网络搜索失败: {str(e)}'}), 500


@deleted_bp.route('/gene-suggest', methods=['GET'])
@jwt_required(optional=True)
def deleted_gene_suggest():
    _ensure_loaded()
    try:
        query_str = request.args.get('q', '', type=str).strip()
        side = request.args.get('side', 'both', type=str).strip()
        limit = request.args.get('limit', 10, type=int)
        if len(query_str) < 1:
            return jsonify({'code': 200, 'message': 'success', 'data': []}), 200

        rows = _deleted_rows or []
        query_lower = query_str.lower()
        result_set = set()

        left_col = _col_map.get('leftGene') if _col_map else None
        right_col = _col_map.get('rightGene') if _col_map else None

        for row in rows:
            if len(result_set) >= limit: break
            if side in ('left', 'both'):
                val = row.get(left_col) if left_col else None
                if val is None:
                    for c in COL_CANDIDATES['leftGene']:
                        if c in row: val = row[c]; break
                if val and str(val).lower().startswith(query_lower):
                    result_set.add(str(val))
            if side in ('right', 'both'):
                val = row.get(right_col) if right_col else None
                if val is None:
                    for c in COL_CANDIDATES['rightGene']:
                        if c in row: val = row[c]; break
                if val and str(val).lower().startswith(query_lower):
                    result_set.add(str(val))

        return jsonify({'code': 200, 'message': 'success', 'data': sorted(list(result_set))[:limit]}), 200
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'code': 500, 'message': f'基因建议失败: {str(e)}'}), 500


@deleted_bp.route('/search-suggest', methods=['GET'])
@jwt_required(optional=True)
def deleted_search_suggest():
    _ensure_loaded()
    try:
        query_str = request.args.get('q', '', type=str).strip()
        limit = request.args.get('limit', 10, type=int)
        if len(query_str) < 2:
            return jsonify({'code': 200, 'message': 'success', 'data': []}), 200

        rows = _deleted_rows or []
        query_lower = query_str.lower()
        result = []
        seen = set()

        fusion_col = _col_map.get('fusionName') if _col_map else None
        left_col = _col_map.get('leftGene') if _col_map else None
        right_col = _col_map.get('rightGene') if _col_map else None

        for row in rows:
            if len(result) >= limit: break
            for col in [left_col, right_col]:
                if col and col in row and row[col]:
                    gene_name = str(row[col]).split('^')[0]
                    if gene_name.lower().startswith(query_lower) and gene_name not in seen:
                        seen.add(gene_name)
                        result.append({'type': 'gene', 'value': str(row[col])})
                        break

        if len(result) < limit:
            for row in rows:
                if len(result) >= limit: break
                col = fusion_col
                if col and col in row and row[col]:
                    val = str(row[col])
                    if val.lower().startswith(query_lower) and val not in seen:
                        seen.add(val)
                        result.append({'type': 'fusion', 'value': val})

        return jsonify({'code': 200, 'message': 'success', 'data': result}), 200
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'code': 500, 'message': f'搜索建议失败: {str(e)}'}), 500

# ==================== 融合详情（供 FusionDeletedDetail 页面使用） ====================

@deleted_bp.route('/by-name/<path:fusion_name>', methods=['GET'])
@jwt_required(optional=True)
def get_deleted_by_name(fusion_name):
    """
    根据融合名返回 fusiondeleted CSV 中所有匹配行（即变体列表）
    前端 FusionDeletedDetail 页面用此接口加载数据
    """
    _ensure_loaded()
    try:
        fusion_col = _col_map.get('fusionName') if _col_map else None
        matched = []
        for row in (_deleted_rows or []):
            val = row.get(fusion_col) if fusion_col else None
            if val is None:
                for c in COL_CANDIDATES['fusionName']:
                    if c in row:
                        val = row[c]
                        break
            if val and str(val).strip() == fusion_name.strip():
                matched.append(_serialize_row(row))

        if not matched:
            return jsonify({
                'code': 404,
                'message': f'未找到融合: {fusion_name}',
                'data': {'items': [], 'columns': []}
            }), 404

        # 按 fq 降序排列
        matched.sort(key=lambda r: float(r.get('fq', 0) or 0), reverse=True)
        columns = [k for k in matched[0].keys() if not k.startswith('_')] if matched else []

        return jsonify({
            'code': 200,
            'message': 'success',
            'data': {
                'items': matched,
                'columns': columns,
                'total': len(matched)
            }
        }), 200
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'code': 500, 'message': f'获取融合详情失败: {str(e)}'}), 500


@deleted_bp.route('/by-squeue/<squeue_id>', methods=['GET'])
@jwt_required(optional=True)
def get_deleted_by_squeue(squeue_id):
    """
    根据 squeue ID 返回单行详细数据（供 Arriba 图等使用）
    """
    _ensure_loaded()
    try:
        squeue_col = _col_map.get('squeue') if _col_map else None
        for row in (_deleted_rows or []):
            val = None
            if squeue_col:
                val = str(row.get(squeue_col, '')).strip()
            else:
                for c in COL_CANDIDATES['squeue']:
                    if c in row:
                        val = str(row[c]).strip()
                        break
            if val == str(squeue_id).strip():
                return jsonify({
                    'code': 200,
                    'message': 'success',
                    'data': _serialize_row(row)
                }), 200

        return jsonify({'code': 404, 'message': f'未找到 squeue={squeue_id}'}), 404
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'code': 500, 'message': f'查询失败: {str(e)}'}), 500