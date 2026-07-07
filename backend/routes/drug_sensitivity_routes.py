# backend/routes/drug_sensitivity_routes.py
# 融合基因药物敏感性分析 API
#
# ★ 数据来源：DGIdb interactions.tsv 本地文件（从 https://dgidb.org/downloads 下载）
#   启动时加载到内存，按基因名建索引，查询无需外网访问，秒级返回。
#
# 部署步骤：
#   1. 访问 https://dgidb.org/downloads
#   2. 下载 interactions.tsv
#   3. 放到 backend/dgidb_interactions.tsv
#   4. 重启 Flask

import os
import traceback
import pandas as pd
from flask import Blueprint, jsonify
from flask_jwt_extended import jwt_required

drug_bp = Blueprint('drug', __name__)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ═══════════════════════════════════════════════════════════════════════════
# 数据加载（启动时调用一次）
# ═══════════════════════════════════════════════════════════════════════════
_gene_index = {}    # { gene_name_upper: [interaction_dict, ...] }
_loaded = False
_stats = {}

# 两种 TSV 格式都支持：
#   1) 网页导出格式：gene, drug, regulatory approval, indication, interaction score
#   2) bulk download 格式：可能含更多列如 interaction_types, pmids, sources 等
_TSV_CANDIDATES = [
    os.path.join(BASE_DIR, 'dgidb_interactions.tsv'),
    os.path.join(BASE_DIR, 'interactions.tsv'),
    os.path.join(BASE_DIR, 'data', 'dgidb_interactions.tsv'),
    os.path.join(BASE_DIR, 'data', 'interactions.tsv'),
]


def _find_col(columns, *patterns):
    """在列名中模糊匹配"""
    cols_lower = {c: c.lower().replace(' ', '_').replace('-', '_') for c in columns}
    for pat in patterns:
        pat_l = pat.lower()
        for orig, low in cols_lower.items():
            if pat_l in low:
                return orig
    return None


def load_dgidb_tsv():
    """
    加载 DGIdb interactions TSV 文件。
    自动检测列名，构建按基因名查询的索引。
    """
    global _gene_index, _loaded, _stats

    tsv_path = None
    for p in _TSV_CANDIDATES:
        if os.path.isfile(p):
            tsv_path = p
            break

    if not tsv_path:
        print(f"[DGIdb] ⚠️  未找到 interactions.tsv 文件")
        print(f"[DGIdb]    请从 https://dgidb.org/downloads 下载后放到以下任一路径：")
        for p in _TSV_CANDIDATES:
            print(f"[DGIdb]    - {p}")
        _loaded = False
        return

    try:
        print(f"[DGIdb] 加载: {tsv_path}")
        df = pd.read_csv(tsv_path, sep='\t', low_memory=False, encoding='utf-8')
        df.columns = df.columns.str.strip()
        print(f"[DGIdb] {len(df):,} 行 × {len(df.columns)} 列")
        print(f"[DGIdb] 列名: {list(df.columns)}")

        # 自动检测列
        gene_col     = _find_col(df.columns, 'gene')
        drug_col     = _find_col(df.columns, 'drug')
        approval_col = _find_col(df.columns, 'approv', 'regulatory')
        indication_col = _find_col(df.columns, 'indicat')
        score_col    = _find_col(df.columns, 'score', 'interaction_score')
        type_col     = _find_col(df.columns, 'interaction_type', 'type')
        source_col   = _find_col(df.columns, 'source', 'claim_source')
        pmid_col     = _find_col(df.columns, 'pmid', 'pubmed')

        if not gene_col or not drug_col:
            print(f"[DGIdb] ❌ 必须有 gene 和 drug 列，实际列名: {list(df.columns)}")
            return

        print(f"[DGIdb] 列映射: gene={gene_col}, drug={drug_col}, "
              f"approval={approval_col}, indication={indication_col}, "
              f"score={score_col}, type={type_col}, source={source_col}, pmid={pmid_col}")

        # 构建索引
        _gene_index.clear()
        skip = {'', 'nan', 'n/a', 'none', 'na'}

        for _, row in df.iterrows():
            gene = str(row.get(gene_col, '')).strip().upper()
            drug = str(row.get(drug_col, '')).strip()
            if not gene or not drug or gene.lower() in skip or drug.lower() in skip:
                continue

            approval = ''
            if approval_col:
                a = str(row.get(approval_col, '')).strip()
                if a.lower() not in skip:
                    approval = a

            indication = ''
            if indication_col:
                ind = str(row.get(indication_col, '')).strip()
                if ind.lower() not in skip and ind != '""':
                    indication = ind

            score = None
            if score_col:
                try:
                    score = float(row.get(score_col, ''))
                except (ValueError, TypeError):
                    pass

            int_type = ''
            if type_col:
                t = str(row.get(type_col, '')).strip()
                if t.lower() not in skip:
                    int_type = t

            source = ''
            if source_col:
                s = str(row.get(source_col, '')).strip()
                if s.lower() not in skip:
                    source = s

            pmid = ''
            if pmid_col:
                p = str(row.get(pmid_col, '')).strip()
                if p.lower() not in skip:
                    pmid = p

            entry = {
                'drug':     drug,
                'gene':     gene,
                'approved': 'approved' in approval.lower() and 'not' not in approval.lower(),
                'approval': approval,
                'indication': indication,
                'score':    score,
                'interaction_type': int_type,
                'source':   source,
                'pmid':     pmid,
            }

            if gene not in _gene_index:
                _gene_index[gene] = []
            _gene_index[gene].append(entry)

        # 每个基因内按 score 降序排
        for gene in _gene_index:
            _gene_index[gene].sort(
                key=lambda x: (x['approved'], x['score'] or 0),
                reverse=True
            )

        _loaded = True
        _stats = {
            'total_interactions': len(df),
            'unique_genes': len(_gene_index),
            'unique_drugs': len(set(drug for ixs in _gene_index.values() for ix in ixs for drug in [ix['drug']])),
            'file': tsv_path,
        }
        print(f"[DGIdb] ✅ 加载完成: {len(_gene_index):,} 个基因, {_stats['total_interactions']:,} 条互作")

    except Exception as e:
        print(f"[DGIdb] ❌ 加载失败: {e}")
        traceback.print_exc()


def _query_gene(gene_name):
    """查询本地索引，返回某基因的所有药物互作"""
    if not _loaded:
        return []
    return _gene_index.get(gene_name.upper(), [])


def _clean_gene(gene_str):
    if not gene_str:
        return ''
    return str(gene_str).split('^')[0].split('(')[0].strip()


# ═══════════════════════════════════════════════════════════════════════════
# 融合注释（对经典融合补充一句话临床要点）
# ═══════════════════════════════════════════════════════════════════════════
_ANNOTATIONS = {
    'BCR--ABL1':      '经典 CML 驱动融合。一线：Imatinib；T315I 耐药用 Ponatinib/Asciminib。',
    'EML4--ALK':      'NSCLC ALK 融合。一线推荐 Alectinib，耐药后考虑 Lorlatinib。',
    'PML--RARA':      'APL 标志性融合。ATRA + ATO 方案治愈率 >90%。',
    'FGFR3--TACC3':   'FGFR 融合。Erdafitinib（膀胱癌）/Pemigatinib（胆管癌）FDA 获批。',
    'ETV6--NTRK3':    'NTRK 融合。Larotrectinib/Entrectinib 组织不限获批（ORR ~75%）。',
    'CCDC6--RET':     'RET 融合。Selpercatinib/Pralsetinib 获批。',
    'KMT2A--MLLT3':   'KMT2A 重排白血病。Revumenib（Menin 抑制剂）2024 年 FDA 获批。',
    'RUNX1--RUNX1T1': 'AML t(8;21) 核心结合因子融合。化疗敏感，预后良好亚型。',
    'CBFB--MYH11':    'AML inv(16) 核心结合因子融合。预后良好亚型。',
    'EWSR1--FLI1':    'Ewing 肉瘤驱动融合。暂无获批靶向药。',
    'TMPRSS2--ERG':   '前列腺癌最常见融合（~50%）。AR 抑制（Abiraterone）间接有效。',
    'KIAA1549--BRAF': '儿童低级别胶质瘤 BRAF 融合。Dabrafenib+Trametinib / MEK 抑制剂。',
    'CD74--ROS1':     'ROS1 融合 NSCLC。Crizotinib/Entrectinib 获批。',
    'FIP1L1--PDGFRA': 'PDGFRA 融合 MPN。Imatinib 完全缓解率 >95%。',
    'NPM1--ALK':      'ALK+ ALCL。ALK 抑制剂（Crizotinib/Alectinib）。',
}
_ANNO_REV = {f.split('--')[1]+'--'+f.split('--')[0]: f for f in _ANNOTATIONS}

def _get_annotation(fn):
    if fn in _ANNOTATIONS: return _ANNOTATIONS[fn]
    r = _ANNO_REV.get(fn)
    return _ANNOTATIONS.get(r) if r else None


def _build_links(lg, rg, fn):
    return {
        'dgidb_left':  f'https://dgidb.org/results?searchType=gene&searchTerms={lg}',
        'dgidb_right': f'https://dgidb.org/results?searchType=gene&searchTerms={rg}',
        'oncokb_left': f'https://www.oncokb.org/gene/{lg}',
        'oncokb_right':f'https://www.oncokb.org/gene/{rg}',
        'civic_left':  f'https://civicdb.org/links/entrez_name/{lg}',
        'civic_right': f'https://civicdb.org/links/entrez_name/{rg}',
        'drugbank':    f'https://go.drugbank.com/unearth/q?query={lg}+{rg}&searcher=drugs',
        'clintrials':  f'https://clinicaltrials.gov/search?cond={fn}',
        'opentargets_left': f'https://platform.opentargets.org/search?q={lg}&page=1',
        'opentargets_right':f'https://platform.opentargets.org/search?q={rg}&page=1',
    }


# ═══════════════════════════════════════════════════════════════════════════
# 路由
# ═══════════════════════════════════════════════════════════════════════════

@drug_bp.route('/by-fusion/<path:fusion_name>', methods=['GET'])
@jwt_required(optional=True)
def get_drugs_by_fusion(fusion_name):
    if not _loaded:
        return jsonify({
            'code': 503,
            'message': '药物数据库未加载。请从 https://dgidb.org/downloads 下载 interactions.tsv 放到 backend/ 目录后重启。'
        }), 503

    parts = fusion_name.split('--')
    left_gene  = _clean_gene(parts[0]) if len(parts) >= 2 else _clean_gene(fusion_name)
    right_gene = _clean_gene(parts[1]) if len(parts) >= 2 else ''

    left_ix  = _query_gene(left_gene)
    right_ix = _query_gene(right_gene)

    # 合并去重
    drug_map = {}
    for ix in left_ix + right_ix:
        key = ix['drug'].upper()
        if key not in drug_map:
            drug_map[key] = {
                'drug': ix['drug'], 'genes': [], 'approved': False,
                'indications': set(), 'interaction_types': set(),
                'sources': set(), 'pmids': set(),
                'scores': [],
            }
        e = drug_map[key]
        if ix['gene'] not in e['genes']:
            e['genes'].append(ix['gene'])
        if ix['approved']:
            e['approved'] = True
        if ix['indication']:
            e['indications'].add(ix['indication'])
        if ix['interaction_type']:
            e['interaction_types'].add(ix['interaction_type'])
        if ix['source']:
            e['sources'].add(ix['source'])
        if ix['pmid']:
            e['pmids'].add(ix['pmid'])
        if ix['score'] is not None:
            e['scores'].append(ix['score'])

    all_drugs = []
    for e in drug_map.values():
        avg_score = sum(e['scores']) / len(e['scores']) if e['scores'] else None
        all_drugs.append({
            'drug':              e['drug'],
            'genes':             e['genes'],
            'approved':          e['approved'],
            'indications':       sorted(e['indications']),
            'interaction_types': sorted(e['interaction_types']),
            'sources':           sorted(e['sources']),
            'pmids':             sorted(e['pmids']),
            'score':             round(avg_score, 4) if avg_score else None,
            'targets_both':      len(e['genes']) >= 2,
        })
    all_drugs.sort(key=lambda x: (x['approved'], x['targets_both'], x['score'] or 0), reverse=True)

    return jsonify({
        'code': 200,
        'data': {
            'fusion_name':        fusion_name,
            'left_gene':          left_gene,
            'right_gene':         right_gene,
            'left_drug_count':    len(left_ix),
            'right_drug_count':   len(right_ix),
            'total_unique_drugs': len(all_drugs),
            'drugs':              all_drugs,
            'annotation':         _get_annotation(fusion_name),
            'external_links':     _build_links(left_gene, right_gene, fusion_name),
            'data_source':        'DGIdb (local)',
            'db_stats':           _stats,
        }
    })


@drug_bp.route('/network/<path:fusion_name>', methods=['GET'])
@jwt_required(optional=True)
def get_drug_network(fusion_name):
    parts = fusion_name.split('--')
    left_gene  = _clean_gene(parts[0]) if len(parts) >= 2 else _clean_gene(fusion_name)
    right_gene = _clean_gene(parts[1]) if len(parts) >= 2 else ''

    left_ix  = _query_gene(left_gene)
    right_ix = _query_gene(right_gene)

    nodes, links = [], []
    nids = set()

    def _n(nid, label, ntype, **kw):
        if nid not in nids:
            nids.add(nid)
            nodes.append({'id': nid, 'label': label, 'type': ntype, **kw})

    def _l(s, t, lt, **kw):
        links.append({'source': s, 'target': t, 'type': lt, **kw})

    _n(fusion_name, fusion_name, 'fusion')
    if left_gene:
        _n(left_gene, left_gene, 'gene')
        _l(fusion_name, left_gene, 'fusion_gene', label="5'")
    if right_gene:
        _n(right_gene, right_gene, 'gene')
        _l(fusion_name, right_gene, 'fusion_gene', label="3'")

    # 最多 25 个药物节点
    seen = set()
    for ix in left_ix + right_ix:
        d = ix['drug']
        if d.upper() in seen or len(seen) >= 25:
            continue
        seen.add(d.upper())
        did = f'drug_{d}'
        _n(did, d, 'drug',
           approved=ix.get('approved', False),
           interaction_type=ix.get('interaction_type', ''),
           score=ix.get('score'))
        lbl = ix.get('interaction_type', '')[:25]
        _l(ix['gene'], did, 'gene_drug', label=lbl)

    return jsonify({'code': 200, 'data': {'nodes': nodes, 'links': links}})


@drug_bp.route('/status', methods=['GET'])
def drug_status():
    return jsonify({
        'code': 200,
        'loaded': _loaded,
        'stats': _stats,
        'search_paths': _TSV_CANDIDATES,
    })


print("[DrugSensitivity] 蓝图已加载 (本地 TSV 模式)")