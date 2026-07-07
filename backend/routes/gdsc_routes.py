# backend/routes/gdsc_routes.py
# GDSC (Genomics of Drug Sensitivity in Cancer) 数据接口
# 将 expression.csv 和 drug.csv 放到 backend/data/ 目录下

import os
import math
from collections import OrderedDict
import pandas as pd
from flask import Blueprint, request, jsonify

gdsc_bp = Blueprint('gdsc', __name__, url_prefix='/api/gdsc')

# ====== 数据目录 ======
DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data')
GDSC_CACHE_DIR = os.path.join(DATA_DIR, 'gdsc_cache')


# ====== 延迟加载 & 缓存 ======
_cache = {}
_expression_result_cache = OrderedDict()
_drug_response_cache = OrderedDict()
_EXPRESSION_RESULT_CACHE_MAX = 256
_DRUG_RESPONSE_CACHE_MAX = 128


def _lru_get(cache: OrderedDict, key):
    if key not in cache:
        return None
    cache.move_to_end(key)
    return cache[key]


def _lru_set(cache: OrderedDict, key, value, maxsize: int):
    cache[key] = value
    cache.move_to_end(key)
    while len(cache) > maxsize:
        cache.popitem(last=False)


def _get_expression_columns(df):
    if 'expression_base_cols' not in _cache:
        metadata = {'TCGA_DESC', 'COSMIC_ID', 'CELL_LINE', 'site', 'histology'}
        base = [c for c in ['COSMIC_ID', 'CELL_LINE', 'site', 'histology'] if c in df.columns]
        genes = [c for c in df.columns if c not in metadata]
        _cache['expression_base_cols'] = base
        _cache['gene_columns'] = genes
        _cache['gene_name_map'] = {str(c).upper(): c for c in genes}
    return _cache['expression_base_cols'], _cache['gene_columns'], _cache['gene_name_map']


def _load_csv_or_excel(file_path):
    """兼容 csv / xls / xlsx"""
    for reader in [
        lambda: pd.read_csv(file_path, encoding='utf-8'),
        lambda: pd.read_csv(file_path, encoding='gbk'),
        lambda: pd.read_excel(file_path, engine='openpyxl'),
        lambda: pd.read_excel(file_path, engine='xlrd'),
    ]:
        try:
            return reader()
        except Exception:
            continue
    raise RuntimeError(f"无法读取文件 {file_path}")


def _table_cache_path(file_path):
    os.makedirs(GDSC_CACHE_DIR, exist_ok=True)
    return os.path.join(GDSC_CACHE_DIR, f"{os.path.basename(file_path)}.pkl")


def _load_table_cached(file_path, label):
    cache_path = _table_cache_path(file_path)
    if os.path.exists(cache_path):
        try:
            if os.path.getmtime(cache_path) >= os.path.getmtime(file_path):
                print(f"[GDSC] Loading {label} cache: {cache_path}")
                return pd.read_pickle(cache_path)
        except OSError:
            pass

    print(f"[GDSC] Loading {label} source: {file_path}")
    df = _load_csv_or_excel(file_path)

    tmp_path = f"{cache_path}.tmp.{os.getpid()}"
    try:
        print(f"[GDSC] Writing {label} cache: {cache_path}")
        df.to_pickle(tmp_path)
        os.replace(tmp_path, cache_path)
    except Exception as e:
        print(f"[GDSC] Failed to write {label} cache: {e}")
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except OSError:
            pass
    return df


def _processed_cache_path(file_path, label):
    os.makedirs(GDSC_CACHE_DIR, exist_ok=True)
    return os.path.join(GDSC_CACHE_DIR, f"{os.path.basename(file_path)}.{label}.processed.pkl")


def _read_processed_cache(file_path, label):
    cache_path = _processed_cache_path(file_path, label)
    if not os.path.exists(cache_path):
        return None

    try:
        if os.path.getmtime(cache_path) < os.path.getmtime(file_path):
            return None
    except OSError:
        return None

    try:
        print(f"[GDSC] Loading {label} processed cache: {cache_path}")
        return pd.read_pickle(cache_path)
    except Exception as e:
        print(f"[GDSC] Failed to read {label} processed cache: {e}")
        return None


def _write_processed_cache(file_path, label, value):
    cache_path = _processed_cache_path(file_path, label)
    tmp_path = f"{cache_path}.tmp.{os.getpid()}"
    try:
        print(f"[GDSC] Writing {label} processed cache: {cache_path}")
        pd.to_pickle(value, tmp_path)
        os.replace(tmp_path, cache_path)
    except Exception as e:
        print(f"[GDSC] Failed to write {label} processed cache: {e}")
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except OSError:
            pass


def _get_expression_df():
    if 'expression_df' not in _cache:
        # 尝试多种后缀
        for ext in ['csv', 'xls', 'xlsx']:
            path = os.path.join(DATA_DIR, f'expression.{ext}')
            if os.path.exists(path):
                _cache['expression_df'] = _load_table_cached(path, 'expression')
                break
        else:
            raise FileNotFoundError("expression 数据文件未找到")
    return _cache['expression_df']


def _get_drug_data():
    """返回 (drug_dict, drug_details_cache, drug_df)"""
    if 'drug_data' not in _cache:
        for ext in ['csv', 'xls', 'xlsx']:
            path = os.path.join(DATA_DIR, f'drug.{ext}')
            if os.path.exists(path):
                break
        else:
            raise FileNotFoundError("drug 数据文件未找到")

        processed = _read_processed_cache(path, 'drug_data')
        if processed is not None:
            drug_data, drug_details = processed
            _cache['drug_data'] = drug_data
            _cache['drug_details'] = drug_details
            _cache['drug_df'] = None
            return _cache['drug_data'], _cache['drug_details'], _cache.get('drug_df')

        df = _load_table_cached(path, 'drug')

        drug_data = {}
        drug_details = {}
        for _, row in df.iterrows():
            cosmic_id = row['COSMIC_ID']
            entry = {
                "Drug_Name": row["DRUG_NAME"],
                "Z_SCORE": row["Z_SCORE"] if not _is_nan(row["Z_SCORE"]) else None,
                "LN_IC50": row["LN_IC50"] if not _is_nan(row["LN_IC50"]) else None,
                "AUC": row["AUC"] if not _is_nan(row["AUC"]) else None,
                "RMSE": row["RMSE"] if not _is_nan(row["RMSE"]) else None,
                "TCGA_DESC": row.get("TCGA_DESC", "Unknown"),
            }
            drug_data.setdefault(cosmic_id, []).append(entry)

            dname = row['DRUG_NAME']
            if dname not in drug_details:
                drug_details[dname] = {
                    'DRUG_NAME': dname,
                    'PUTATIVE_TARGET': _safe_str(row.get('PUTATIVE_TARGET', '')),
                    'PATHWAY_NAME': _safe_str(row.get('PATHWAY_NAME', '')),
                }

        _cache['drug_data'] = drug_data
        _cache['drug_details'] = drug_details
        _cache['drug_df'] = df
        _write_processed_cache(path, 'drug_data', (drug_data, drug_details))
    return _cache['drug_data'], _cache['drug_details'], _cache.get('drug_df')


def _is_nan(v):
    if v is None:
        return True
    try:
        return math.isnan(float(v))
    except (TypeError, ValueError):
        return False


def _safe_str(v):
    if v is None or (_is_nan(v) if isinstance(v, float) else False):
        return ''
    return str(v)


def _safe_float(v):
    """将值转为 JSON 安全的浮点数（NaN → None）"""
    if v is None:
        return None
    try:
        f = float(v)
        return None if math.isnan(f) or math.isinf(f) else f
    except (TypeError, ValueError):
        return None


# ====== 路由 ======

@gdsc_bp.route('/gene_list')
def gene_list():
    """Return all gene names for autocomplete."""
    df = _get_expression_df()
    _, genes, _ = _get_expression_columns(df)
    return jsonify(genes)


@gdsc_bp.route('/autocomplete')
def autocomplete():
    """Gene autocomplete."""
    q = request.args.get('q', '').upper()
    if not q:
        return jsonify([])
    df = _get_expression_df()
    _, genes, _ = _get_expression_columns(df)
    matches = [gene for gene in genes if q in str(gene).upper()][:20]
    return jsonify(matches)


@gdsc_bp.route('/expression/<gene>')
def get_expression(gene):
    """Return expression values for one gene across GDSC cell lines."""
    gene_upper = str(gene).upper()
    cached = _lru_get(_expression_result_cache, gene_upper)
    if cached is not None:
        return jsonify(cached)

    df = _get_expression_df()
    base_cols, _, gene_map = _get_expression_columns(df)
    match = gene_map.get(gene_upper)
    if match is None:
        _lru_set(_expression_result_cache, gene_upper, [], _EXPRESSION_RESULT_CACHE_MAX)
        return jsonify([])

    sub = df[base_cols + [match]].copy()
    sub = sub.rename(columns={match: 'value'})
    sub['value'] = pd.to_numeric(sub['value'], errors='coerce')
    sub = sub.dropna(subset=['value'])
    records = sub.to_dict(orient='records')
    _lru_set(_expression_result_cache, gene_upper, records, _EXPRESSION_RESULT_CACHE_MAX)
    return jsonify(records)


@gdsc_bp.route('/drug_response', methods=['POST'])
def drug_response():
    """Return drug-response rows for a set of COSMIC IDs."""
    body = request.get_json(force=True)
    cosmic_ids = body.get('cosmic_ids', [])
    drug_name = body.get('drug_name', None)

    normalized_ids = []
    for cid in cosmic_ids:
        try:
            normalized_ids.append(int(cid))
        except (TypeError, ValueError):
            normalized_ids.append(cid)
    cache_key = (tuple(sorted(set(normalized_ids), key=lambda x: str(x))), drug_name or '')
    cached = _lru_get(_drug_response_cache, cache_key)
    if cached is not None:
        return jsonify(cached)

    drug_data, _, _ = _get_drug_data()
    result = []
    for cid in normalized_ids:
        if cid in drug_data:
            for entry in drug_data[cid]:
                if drug_name and entry['Drug_Name'] != drug_name:
                    continue
                record = entry.copy()
                record['COSMIC_ID'] = cid
                for k in ['Z_SCORE', 'LN_IC50', 'AUC', 'RMSE']:
                    record[k] = _safe_float(record.get(k))
                result.append(record)

    _lru_set(_drug_response_cache, cache_key, result, _DRUG_RESPONSE_CACHE_MAX)
    return jsonify(result)


@gdsc_bp.route('/drug_details/<drug_name>')
def get_drug_details(drug_name):
    """获取药物详细信息（靶点、通路等）"""
    _, details, _ = _get_drug_data()
    drug_name_str = str(drug_name)
    if drug_name_str in details:
        return jsonify(details[drug_name_str])
    return jsonify({"error": "药物信息未找到"}), 404


@gdsc_bp.route('/cell_line_map')
def cell_line_map():
    """返回 COSMIC_ID → CELL_LINE 映射"""
    df = _get_expression_df()
    df_map = df[['COSMIC_ID', 'CELL_LINE']].copy()
    df_map['COSMIC_ID'] = df_map['COSMIC_ID'].astype(str)
    mapping = dict(zip(df_map['COSMIC_ID'], df_map['CELL_LINE']))
    return jsonify(mapping)


@gdsc_bp.route('/check')
def check_data():
    """检查数据文件是否存在"""
    expr_exists = any(
        os.path.exists(os.path.join(DATA_DIR, f'expression.{ext}'))
        for ext in ['csv', 'xls', 'xlsx']
    )
    drug_exists = any(
        os.path.exists(os.path.join(DATA_DIR, f'drug.{ext}'))
        for ext in ['csv', 'xls', 'xlsx']
    )
    return jsonify({
        'expression_exists': expr_exists,
        'drug_exists': drug_exists,
        'data_dir': DATA_DIR,
    })
