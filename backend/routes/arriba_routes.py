# backend/routes/arriba_routes.py
# Arriba融合基因可视化API - 用于生成高质量融合断点图

from flask import Blueprint, jsonify, request, send_file, Response
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import Fusion
from extensions import db
import os
import subprocess
import tempfile
import shutil
import re
import time
from pathlib import Path
from functools import wraps

arriba_bp = Blueprint('arriba', __name__)


def _arriba_rscript_command():
    """Return the fastest available Rscript command for the Arriba environment."""
    env_name = ARRIBA_CONFIG['conda_env']
    candidates = []

    env_rscript = os.environ.get('ARRIBA_RSCRIPT')
    if env_rscript:
        candidates.append(Path(env_rscript))

    candidates.extend([
        Path('/opt/miniforge3') / 'envs' / env_name / 'bin' / 'Rscript',
        Path('/opt/miniconda3') / 'envs' / env_name / 'bin' / 'Rscript',
        Path('/home/debian/miniforge3') / 'envs' / env_name / 'bin' / 'Rscript',
        Path('/home/debian/miniconda3') / 'envs' / env_name / 'bin' / 'Rscript',
        Path('/home/fenhuazu/miniconda3') / 'envs' / env_name / 'bin' / 'Rscript',
    ])

    for candidate in candidates:
        if candidate.exists():
            return [str(candidate)]

    return ['conda', 'run', '-n', env_name, 'Rscript']

# ==================== 配置 ====================
# Arriba工具路径配置（下沙服务器版本）
# 服务器项目路径：/home/debian/fusion-gene-portal/backend
# Arriba相关文件：/home/debian/fusion-gene-portal/backend/tools
# PDF缓存目录：/home/debian/fusion-gene-portal/backend/arriba/cache
BASE_DIR = Path('/home/debian/fusion-gene-portal/backend')
TOOLS_DIR = BASE_DIR / 'tools'

ARRIBA_CONFIG = {
    'conda_env': 'arriba',
    'tools_dir': str(TOOLS_DIR),
    'annotation_gtf': str(TOOLS_DIR / 'gencode.v36.annotation.gtf'),
    'cytobands': str(TOOLS_DIR / 'cytobands_hg38.nochr.tsv'),
    'protein_domains': str(TOOLS_DIR / 'protein_domains_hg38_GRCh38_v2.5.1.nochr.gff3'),
    'draw_fusions_script': str(TOOLS_DIR / 'draw_fusions.R'),
    'cache_dir': str(BASE_DIR / 'arriba' / 'cache'),
}

# 从环境变量覆盖配置
for key in ARRIBA_CONFIG:
    env_key = f'ARRIBA_{key.upper()}'
    if os.environ.get(env_key):
        ARRIBA_CONFIG[key] = os.environ.get(env_key)

# 确保缓存目录存在
os.makedirs(ARRIBA_CONFIG['cache_dir'], exist_ok=True)


ARRIBA_MIN_PDF_BYTES = int(os.environ.get('ARRIBA_MIN_PDF_BYTES', '1024'))
ARRIBA_GENERATION_TIMEOUT = int(os.environ.get('ARRIBA_GENERATION_TIMEOUT', '480'))
_BAD_ARRIBA_VALUES = {'', '.', 'NA', 'N/A', 'nan', 'none', 'None', 'null', '-'}


def _clean_arriba_transcript_id(value) -> str:
    value = str(value or '').strip()
    return '' if value in _BAD_ARRIBA_VALUES else value


def _arriba_preflight_issue(fusion_row: dict):
    """Return a user-actionable reason when Arriba is known to hang/fail."""
    tx1 = _clean_arriba_transcript_id(fusion_row.get('cds_left_id'))
    tx2 = _clean_arriba_transcript_id(fusion_row.get('cds_right_id'))
    if not tx1 and not tx2:
        return 'missing transcript IDs: cds_left_id/cds_right_id are both empty; Arriba draw_fusions.R needs ENST transcript annotation'
    return None


def _validate_arriba_pdf(path: str):
    if not os.path.isfile(path):
        return False, 'missing'
    try:
        size = os.path.getsize(path)
        if size < ARRIBA_MIN_PDF_BYTES:
            return False, f'too small ({size} bytes)'
        with open(path, 'rb') as f:
            head = f.read(8)
            f.seek(max(0, size - 4096))
            tail = f.read()
        if not head.startswith(b'%PDF-'):
            return False, 'missing PDF header'
        if b'%%EOF' not in tail:
            return False, 'missing PDF EOF marker'
        with open(path, 'rb') as f:
            sample = f.read(min(size, 1024 * 1024))
        if not re.search(rb'/Type\s*/Page\b', sample):
            return False, 'no PDF page object'
        if b'/Contents' not in sample and b'stream' not in sample:
            return False, 'no drawable PDF content stream'
        return True, 'ok'
    except Exception as exc:
        return False, f'validation error: {exc}'


def _remove_invalid_arriba_pdf(path: str, reason: str) -> None:
    if os.path.exists(path):
        try:
            os.remove(path)
            print(f"[Arriba] removed invalid PDF {path}: {reason}")
        except Exception as exc:
            print(f"[Arriba] failed to remove invalid PDF {path}: {exc}")


def _is_valid_arriba_pdf(path: str) -> bool:
    ok, reason = _validate_arriba_pdf(path)
    if ok:
        return True
    if os.path.exists(path):
        _remove_invalid_arriba_pdf(path, reason)
    return False


# ==================== Arriba TSV转换相关函数 ====================

ARRIBA_HEADER = [
    "#gene1", "gene2", "strand1(gene/fusion)", "strand2(gene/fusion)",
    "breakpoint1", "breakpoint2", "site1", "site2", "type",
    "split_reads1", "split_reads2", "discordant_mates",
    "coverage1", "coverage2", "confidence", "reading_frame", "tags",
    "retained_protein_domains", "closest_genomic_breakpoint1", "closest_genomic_breakpoint2",
    "gene_id1", "gene_id2", "transcript_id1", "transcript_id2",
    "direction1", "direction2", "filters", "fusion_transcript", "peptide_sequence", "read_identifiers"
]


def clean_gene(x: str) -> str:
    """清理基因名，去除ENSG注释"""
    x = (x or "").strip()
    return re.sub(r"\^.*$", "", x)


def keep_ens_gene_id(x: str) -> str:
    """提取ENSG ID"""
    x = (x or "").strip()
    x = re.sub(r"^.*\^", "", x)
    return x if x else "."


def parse_breakpoint(bp: str):
    """
    解析断点格式
    输入: chr22:42720797:- 或 22:42720797:- 或 chr22:42720797
    输出: contig, pos, strand
    """
    bp = (bp or "").strip()

    # 尝试匹配带strand的格式
    m = re.match(r"^(?:chr)?([^:]+):(\d+)(?::([+-]))?$", bp)
    if not m:
        raise ValueError(f"Bad breakpoint format: {bp}")

    contig = m.group(1)  # 不带chr前缀
    pos = int(m.group(2))
    strand = m.group(3) if m.group(3) else "+"

    return contig, pos, strand


def fusion_row_to_arriba_tsv(fusion_row: dict) -> str:
    """
    将数据库fusion记录转换为Arriba TSV格式
    """
    left_gene_raw = fusion_row.get('left_gene', '')
    right_gene_raw = fusion_row.get('right_gene', '')
    left_bp_raw = fusion_row.get('left_breakpoint', '')
    right_bp_raw = fusion_row.get('right_breakpoint', '')

    if not all([left_gene_raw, right_gene_raw, left_bp_raw, right_bp_raw]):
        raise ValueError("Missing required fields: left_gene, right_gene, left_breakpoint, right_breakpoint")

    gene1 = clean_gene(left_gene_raw)
    gene2 = clean_gene(right_gene_raw)

    contig1, pos1, strand1 = parse_breakpoint(left_bp_raw)
    contig2, pos2, strand2 = parse_breakpoint(right_bp_raw)

    strand1_out = f"{strand1}/{strand1}"
    strand2_out = f"{strand2}/{strand2}"

    direction1 = "downstream" if strand1 == "+" else "upstream"
    direction2 = "upstream" if strand2 == "+" else "downstream"

    gene_id1 = keep_ens_gene_id(left_gene_raw)
    gene_id2 = keep_ens_gene_id(right_gene_raw)

    tx1 = _clean_arriba_transcript_id(fusion_row.get('cds_left_id')) or '.'
    tx2 = _clean_arriba_transcript_id(fusion_row.get('cds_right_id')) or '.'

    if contig1 != contig2:
        ftype = "translocation"
    else:
        if direction1 == direction2:
            ftype = "inversion"
        else:
            ftype = "deletion" if ((direction1 == "downstream") == (pos1 < pos2)) else "duplication"

    def to_int(x, default=1):
        try:
            return int(float(x)) if x else default
        except:
            return default

    split1 = to_int(fusion_row.get('avg_junction_read_count'), 1)
    disc = to_int(fusion_row.get('avg_spanning_frag_count'), 1)
    split2 = 0

    prot_type = (fusion_row.get('prot_fusion_type', '') or '').strip().upper()
    if prot_type == "INFRAME":
        reading_frame = "in-frame"
    elif prot_type == "FRAMESHIFT":
        reading_frame = "out-of-frame"
    else:
        reading_frame = "."

    pep = (fusion_row.get('fusion_transl', '.') or '.').strip()
    if pep == "" or pep.lower() == "na":
        pep = "."
    if pep not in (".", ""):
        pep = pep.replace(" ", "").rstrip("*")

    out_row = {
        "#gene1": gene1,
        "gene2": gene2,
        "strand1(gene/fusion)": strand1_out,
        "strand2(gene/fusion)": strand2_out,
        "breakpoint1": f"{contig1}:{pos1}",
        "breakpoint2": f"{contig2}:{pos2}",
        "site1": "exon",
        "site2": "exon",
        "type": ftype,
        "split_reads1": split1,
        "split_reads2": split2,
        "discordant_mates": disc,
        "coverage1": split1,
        "coverage2": disc,
        "confidence": "high",
        "reading_frame": reading_frame,
        "tags": ".",
        "retained_protein_domains": ".",
        "closest_genomic_breakpoint1": ".",
        "closest_genomic_breakpoint2": ".",
        "gene_id1": gene_id1,
        "gene_id2": gene_id2,
        "transcript_id1": tx1,
        "transcript_id2": tx2,
        "direction1": direction1,
        "direction2": direction2,
        "filters": ".",
        "fusion_transcript": ".",
        "peptide_sequence": pep,
        "read_identifiers": ".",
    }

    header_line = "\t".join(ARRIBA_HEADER)
    data_line = "\t".join(str(out_row[h]) for h in ARRIBA_HEADER)

    return f"{header_line}\n{data_line}\n"


def get_cache_path(fusion_id: int) -> str:
    """
    返回缓存PDF路径，文件名为纯数字ID.pdf
    例如：fusion_id=928 → .../cache/928.pdf
    """
    return os.path.join(ARRIBA_CONFIG['cache_dir'], f"{fusion_id}.pdf")


def generate_arriba_diagram(fusion_row: dict, output_path: str, plot_panels: str = "fusion,domains,readcounts") -> bool:
    """
    调用Arriba的draw_fusions.R生成融合基因图

    Args:
        fusion_row: 融合数据字典
        output_path: 输出PDF路径
        plot_panels: 要显示的面板 (fusion, circos, domains, readcounts)

    Returns:
        bool: 是否生成成功
    """
    try:
        preflight_issue = _arriba_preflight_issue(fusion_row)
        if preflight_issue:
            print(f"[Arriba] generation warning: {preflight_issue}")

        with tempfile.TemporaryDirectory() as tmpdir:
            tsv_content = fusion_row_to_arriba_tsv(fusion_row)
            tsv_path = os.path.join(tmpdir, "fusion.tsv")

            with open(tsv_path, 'w', encoding='utf-8') as f:
                f.write(tsv_content)

            print(f"[Arriba] 生成TSV文件: {tsv_path}")
            print(f"[Arriba] TSV内容:\n{tsv_content}")

            r_script = ARRIBA_CONFIG['draw_fusions_script']

            cmd = [
                *_arriba_rscript_command(),
                r_script,
                f'--fusions={tsv_path}',
                f'--annotation={ARRIBA_CONFIG["annotation_gtf"]}',
                f'--cytobands={ARRIBA_CONFIG["cytobands"]}',
                f'--proteinDomains={ARRIBA_CONFIG["protein_domains"]}',
                f'--plotPanels={plot_panels}',
                f'--output={output_path}',
            ]

            print(f"[Arriba] 执行命令: {' '.join(cmd)}")

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=ARRIBA_GENERATION_TIMEOUT
            )

            if result.returncode != 0:
                print(f"[Arriba] R脚本执行失败: {result.stderr}")
                _remove_invalid_arriba_pdf(output_path, f'Rscript failed with return code {result.returncode}')
                return False

            print(f"[Arriba] R脚本执行成功: {result.stdout}")

            ok, reason = _validate_arriba_pdf(output_path)
            if ok:
                print(f"[Arriba] PDF生成并验证成功: {output_path} ({os.path.getsize(output_path)} bytes)")
                return True

            print(f"[Arriba] PDF无效: {reason}")
            _remove_invalid_arriba_pdf(output_path, reason)
            return False

    except subprocess.TimeoutExpired:
        print("[Arriba] 命令执行超时")
        _remove_invalid_arriba_pdf(output_path, 'Rscript timed out')
        return False
    except Exception as e:
        print(f"[Arriba] 生成图表时发生错误: {str(e)}")
        import traceback
        traceback.print_exc()
        return False


# ==================== API路由 ====================

@arriba_bp.route('/diagram/exists/<int:fusion_id>', methods=['GET'])
@jwt_required(optional=True)
def check_diagram_exists(fusion_id):
    """
    检查指定fusion_id的PDF缓存是否已存在
    前端可先调用此接口快速判断，避免等待生成

    返回:
        { code: 200, data: { exists: true/false } }
    """
    cache_path = get_cache_path(fusion_id)
    exists = _is_valid_arriba_pdf(cache_path)
    print(f"[Arriba] 检查缓存 {fusion_id}.pdf: {'存在' if exists else '不存在'}")
    return jsonify({
        'code': 200,
        'data': {'exists': exists}
    }), 200


@arriba_bp.route('/diagram/<int:fusion_id>', methods=['GET'])
@jwt_required(optional=True)
def get_fusion_diagram(fusion_id):
    """
    获取指定融合记录的Arriba融合图

    逻辑：
    1. 检查 cache/{fusion_id}.pdf 是否存在
    2. 存在 → 直接返回
    3. 不存在 → 调用Arriba生成，保存为 cache/{fusion_id}.pdf 后返回

    参数:
        fusion_id: 融合记录ID（数据库自增ID）
        panels: 要显示的面板 (可选, 默认: fusion,domains,readcounts)
        force: 是否强制重新生成 (可选, 默认: false)

    返回:
        PDF文件 或 错误信息JSON
    """
    try:
        panels = request.args.get('panels', 'fusion,domains,readcounts')
        force_regenerate = request.args.get('force', 'false').lower() == 'true'

        fusion = Fusion.query.get(fusion_id)
        if not fusion:
            return jsonify({
                'code': 404,
                'message': f'未找到融合记录: {fusion_id}'
            }), 404

        cache_path = get_cache_path(fusion_id)

        # 检查缓存（纯数字命名，存在即直接用）
        if not force_regenerate and _is_valid_arriba_pdf(cache_path):
            print(f"[Arriba] 命中缓存: {fusion_id}.pdf")
            return send_file(
                cache_path,
                mimetype='application/pdf',
                as_attachment=False,
                download_name=f"{fusion_id}.pdf"
            )

        # 缓存不存在，生成新的PDF
        print(f"[Arriba] 缓存未命中，开始生成: {fusion_id}.pdf")

        fusion_row = {
            'id': fusion.id,
            'fusion_name': fusion.fusion_name,
            'left_gene': fusion.left_gene,
            'right_gene': fusion.right_gene,
            'left_breakpoint': fusion.left_breakpoint,
            'right_breakpoint': fusion.right_breakpoint,
            'cds_left_id': fusion.cds_left_id,
            'cds_right_id': fusion.cds_right_id,
            'prot_fusion_type': fusion.prot_fusion_type,
            'fusion_transl': fusion.fusion_transl,
            'avg_junction_read_count': fusion.avg_junction_read_count,
            'avg_spanning_frag_count': fusion.avg_spanning_frag_count,
            'fq': fusion.fq,
        }

        success = generate_arriba_diagram(fusion_row, cache_path, panels)

        if success and _is_valid_arriba_pdf(cache_path):
            return send_file(
                cache_path,
                mimetype='application/pdf',
                as_attachment=False,
                download_name=f"{fusion_id}.pdf"
            )
        else:
            return jsonify({
                'code': 500,
                'message': '融合图生成失败，请检查Arriba环境配置'
            }), 500

    except Exception as e:
        print(f"[Arriba] API错误: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'code': 500,
            'message': f'服务器错误: {str(e)}'
        }), 500


@arriba_bp.route('/diagram/download/<int:fusion_id>', methods=['GET'])
@jwt_required(optional=True)
def download_fusion_diagram(fusion_id):
    """
    下载指定融合记录的Arriba融合图PDF（以附件形式，触发浏览器下载）
    同样优先命中缓存 cache/{fusion_id}.pdf，不存在则生成
    """
    try:
        panels = request.args.get('panels', 'fusion,domains,readcounts')

        fusion = Fusion.query.get(fusion_id)
        if not fusion:
            return jsonify({
                'code': 404,
                'message': f'未找到融合记录: {fusion_id}'
            }), 404

        cache_path = get_cache_path(fusion_id)

        if _is_valid_arriba_pdf(cache_path):
            return send_file(
                cache_path,
                mimetype='application/pdf',
                as_attachment=True,
                download_name=f"{fusion.fusion_name}_{fusion_id}_arriba.pdf"
            )

        # 生成
        fusion_row = {
            'id': fusion.id,
            'fusion_name': fusion.fusion_name,
            'left_gene': fusion.left_gene,
            'right_gene': fusion.right_gene,
            'left_breakpoint': fusion.left_breakpoint,
            'right_breakpoint': fusion.right_breakpoint,
            'cds_left_id': fusion.cds_left_id,
            'cds_right_id': fusion.cds_right_id,
            'prot_fusion_type': fusion.prot_fusion_type,
            'fusion_transl': fusion.fusion_transl,
            'avg_junction_read_count': fusion.avg_junction_read_count,
            'avg_spanning_frag_count': fusion.avg_spanning_frag_count,
            'fq': fusion.fq,
        }

        success = generate_arriba_diagram(fusion_row, cache_path, panels)

        if success and _is_valid_arriba_pdf(cache_path):
            return send_file(
                cache_path,
                mimetype='application/pdf',
                as_attachment=True,
                download_name=f"{fusion.fusion_name}_{fusion_id}_arriba.pdf"
            )
        else:
            return jsonify({
                'code': 500,
                'message': '融合图生成失败'
            }), 500

    except Exception as e:
        print(f"[Arriba] 下载API错误: {str(e)}")
        return jsonify({
            'code': 500,
            'message': f'服务器错误: {str(e)}'
        }), 500


@arriba_bp.route('/variants/<fusion_name>', methods=['GET'])
@jwt_required(optional=True)
def get_fusion_variants(fusion_name):
    """
    获取指定融合基因的所有变体信息，按FQ值排序

    返回:
        变体列表，包含断点信息和FQ值
    """
    try:
        variants = Fusion.query.filter_by(fusion_name=fusion_name)\
            .order_by(Fusion.fq.desc().nullslast())\
            .all()

        if not variants:
            return jsonify({
                'code': 404,
                'message': f'未找到融合基因: {fusion_name}'
            }), 404

        items = []
        for v in variants:
            items.append({
                'id': v.id,
                'fusion_name': v.fusion_name,
                'left_gene': clean_gene(v.left_gene),
                'right_gene': clean_gene(v.right_gene),
                'left_breakpoint': v.left_breakpoint,
                'right_breakpoint': v.right_breakpoint,
                'left_breakpoint_display': format_breakpoint_display(v.left_breakpoint),
                'right_breakpoint_display': format_breakpoint_display(v.right_breakpoint),
                'prot_fusion_type': v.prot_fusion_type,
                'fq': v.fq or 0,
                'avg_ffpm': v.avg_ffpm,
                'avg_junction_read_count': v.avg_junction_read_count,
                'avg_spanning_frag_count': v.avg_spanning_frag_count,
                'reading_frame': 'in-frame' if (v.prot_fusion_type or '').upper() == 'INFRAME' else
                                 'out-of-frame' if (v.prot_fusion_type or '').upper() == 'FRAMESHIFT' else 'unknown',
            })

        default_variant = items[0] if items else None

        return jsonify({
            'code': 200,
            'message': 'success',
            'data': {
                'fusion_name': fusion_name,
                'total_variants': len(items),
                'default_variant_id': default_variant['id'] if default_variant else None,
                'variants': items
            }
        }), 200

    except Exception as e:
        print(f"[Arriba] 获取变体错误: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'code': 500,
            'message': f'服务器错误: {str(e)}'
        }), 500


def format_breakpoint_display(bp: str) -> str:
    """格式化断点显示"""
    if not bp:
        return 'N/A'
    try:
        contig, pos, _ = parse_breakpoint(bp)
        return f"chr{contig}:{pos:,}"
    except:
        return bp


@arriba_bp.route('/status', methods=['GET'])
@jwt_required(optional=True)
def check_arriba_status():
    """
    检查Arriba环境是否可用
    """
    status = {
        'conda_env': ARRIBA_CONFIG['conda_env'],
        'conda_available': False,
        'r_script_available': False,
        'annotation_available': False,
        'cytobands_available': False,
        'protein_domains_available': False,
        'ready': False,
        'paths': {
            'tools_dir': ARRIBA_CONFIG['tools_dir'],
            'draw_fusions_script': ARRIBA_CONFIG['draw_fusions_script'],
            'annotation_gtf': ARRIBA_CONFIG['annotation_gtf'],
            'cytobands': ARRIBA_CONFIG['cytobands'],
            'protein_domains': ARRIBA_CONFIG['protein_domains'],
            'cache_dir': ARRIBA_CONFIG['cache_dir'],
        },
    }

    try:
        rscript_cmd = _arriba_rscript_command()
        status['rscript_command'] = rscript_cmd
        result = subprocess.run(
            rscript_cmd + ['--version'],
            capture_output=True,
            text=True,
            timeout=15
        )
        status['conda_available'] = result.returncode == 0

        status['r_script_available'] = os.path.exists(ARRIBA_CONFIG['draw_fusions_script'])
        status['annotation_available'] = os.path.exists(ARRIBA_CONFIG['annotation_gtf'])
        status['cytobands_available'] = os.path.exists(ARRIBA_CONFIG['cytobands'])
        status['protein_domains_available'] = os.path.exists(ARRIBA_CONFIG['protein_domains'])

        status['ready'] = all([
            status['conda_available'],
            status['r_script_available'],
            status['annotation_available'],
            status['cytobands_available'],
            status['protein_domains_available'],
        ])

    except Exception as e:
        status['error'] = str(e)

    return jsonify({
        'code': 200,
        'data': status
    }), 200


@arriba_bp.route('/clear-cache', methods=['POST'])
@jwt_required()
def clear_arriba_cache():
    """
    清理Arriba图表缓存
    """
    try:
        cache_dir = ARRIBA_CONFIG['cache_dir']
        count = 0

        for filename in os.listdir(cache_dir):
            if filename.endswith('.pdf'):
                os.remove(os.path.join(cache_dir, filename))
                count += 1

        return jsonify({
            'code': 200,
            'message': f'已清理 {count} 个缓存文件'
        }), 200

    except Exception as e:
        return jsonify({
            'code': 500,
            'message': f'清理缓存失败: {str(e)}'
        }), 500

# ==================== Deleted Fusion (低可信度) Arriba 路由 ====================
# 使用独立缓存目录：arriba/deleted_cache/
# 数据来自 fusiondeleted CSV 而非数据库

DELETED_CACHE_DIR = os.path.join(os.path.dirname(ARRIBA_CONFIG['cache_dir']), 'deleted_cache')
os.makedirs(DELETED_CACHE_DIR, exist_ok=True)
print(f"[Arriba-Deleted] 缓存目录: {DELETED_CACHE_DIR}")


def normalize_deleted_squeue_id(squeue_id) -> str:
    """统一 deleted fusion 编号：前端/接口可传 123 或 TF123，内部查询统一用 123。"""
    sid = str(squeue_id or "").strip()
    return re.sub(r"^TF", "", sid, flags=re.IGNORECASE)


def get_deleted_display_id(squeue_id) -> str:
    """deleted fusion 对外显示/文件缓存统一使用 TF{squeue}。"""
    return f"TF{normalize_deleted_squeue_id(squeue_id)}"


def get_deleted_cache_path(squeue_id) -> str:
    """返回 deleted fusion 的缓存 PDF 路径：backend/arriba/deleted_cache/TF{squeue}.pdf"""
    return os.path.join(DELETED_CACHE_DIR, f"{get_deleted_display_id(squeue_id)}.pdf")


def _fetch_deleted_row(squeue_id):
    """从内部 API 获取 deleted fusion 行数据"""
    import requests
    sid = normalize_deleted_squeue_id(squeue_id)
    try:
        resp = requests.get(
            f'http://127.0.0.1:{os.environ.get("PORT", 5000)}/api/deleted/by-squeue/{sid}',
            timeout=5
        )
        if resp.ok:
            data = resp.json()
            if data.get('code') == 200:
                return data.get('data')
    except Exception as e:
        print(f"[Arriba-Deleted] 内部请求失败: {e}")
    return None


def deleted_row_to_arriba_dict(row: dict) -> dict:
    """
    将 fusiondeleted 序列化行转换为 generate_arriba_diagram 所需的字典格式
    fusiondeleted 的字段名（序列化后）: fusionName, leftGene, rightGene,
    leftBreakpoint, rightBreakpoint, junction, spanningFrag, annots, filter, squeue, fq,
    以及原始列名如 CDS_LEFT_ID, CDS_RIGHT_ID, PROT_FUSION_TYPE, FUSION_TRANSL 等
    """
    return {
        'id': row.get('squeue', ''),
        'fusion_name': row.get('fusionName', ''),
        'left_gene': row.get('leftGene', '') or row.get('LeftGene', ''),
        'right_gene': row.get('rightGene', '') or row.get('RightGene', ''),
        'left_breakpoint': row.get('leftBreakpoint', '') or row.get('LeftBreakpoint', '') or row.get('LeftLocalBreakpoint', ''),
        'right_breakpoint': row.get('rightBreakpoint', '') or row.get('RightBreakpoint', '') or row.get('RightLocalBreakpoint', ''),
        'cds_left_id': row.get('CDS_LEFT_ID', '.') or '.',
        'cds_right_id': row.get('CDS_RIGHT_ID', '.') or '.',
        'prot_fusion_type': row.get('PROT_FUSION_TYPE', '') or '',
        'fusion_transl': row.get('FUSION_TRANSL', '.') or '.',
        'avg_junction_read_count': float(row.get('junction', 0) or row.get('JunctionReadCount', 0) or 0),
        'avg_spanning_frag_count': float(row.get('spanningFrag', 0) or row.get('SpanningFragCount', 0) or 0),
        'fq': float(row.get('fq', 0) or 0),
    }


def _find_deleted_tp_cache(row_or_arriba_dict: dict):
    """Find a matching TP fusion PDF cache for a deleted/TF fusion row."""
    if not row_or_arriba_dict:
        return None, None

    if 'fusionName' in row_or_arriba_dict or 'leftBreakpoint' in row_or_arriba_dict:
        match_row = deleted_row_to_arriba_dict(row_or_arriba_dict)
    else:
        match_row = row_or_arriba_dict

    tp_fusion = _find_matching_tp_fusion(match_row)
    if not tp_fusion:
        return None, None

    tp_cache_path = get_cache_path(tp_fusion.id)
    if _is_valid_arriba_pdf(tp_cache_path):
        return tp_fusion, tp_cache_path
    return tp_fusion, None


@arriba_bp.route('/deleted/diagram/exists/<squeue_id>', methods=['GET'])
@jwt_required(optional=True)
def check_deleted_diagram_exists(squeue_id):
    """检查 deleted fusion 的 PDF 缓存是否存在"""
    cache_path = get_deleted_cache_path(squeue_id)
    exists = _is_valid_arriba_pdf(cache_path)
    source = 'deleted' if exists else None
    tp_id = None

    if not exists:
        row = _fetch_deleted_row(squeue_id)
        tp_fusion, tp_cache_path = _find_deleted_tp_cache(row)
        if tp_fusion:
            tp_id = tp_fusion.id
        if tp_cache_path:
            exists = True
            source = 'tp'

    return jsonify({'code': 200, 'data': {
        'exists': exists,
        'source': source,
        'tp_id': tp_id,
    }}), 200


@arriba_bp.route('/deleted/diagram/<squeue_id>', methods=['GET'])
@jwt_required(optional=True)
def get_deleted_fusion_diagram(squeue_id):
    """
    获取 deleted fusion 的 Arriba 融合图
    缓存路径: backend/arriba/deleted_cache/TF{squeue}.pdf
    """
    try:
        panels = request.args.get('panels', 'fusion,domains,readcounts')
        force = request.args.get('force', 'false').lower() == 'true'

        cache_path = get_deleted_cache_path(squeue_id)

        # 命中缓存
        if not force and _is_valid_arriba_pdf(cache_path):
            print(f"[Arriba-Deleted] 命中缓存: {get_deleted_display_id(squeue_id)}.pdf")
            return send_file(cache_path, mimetype='application/pdf',
                             as_attachment=False, download_name=f"{get_deleted_display_id(squeue_id)}.pdf")

        # 获取行数据
        row = _fetch_deleted_row(squeue_id)
        if not row:
            return jsonify({'code': 404, 'message': f'未找到 squeue={normalize_deleted_squeue_id(squeue_id)}'}), 404

        arriba_dict = deleted_row_to_arriba_dict(row)

        if not force:
            tp_fusion, tp_cache_path = _find_deleted_tp_cache(arriba_dict)
            if tp_cache_path:
                print(f"[Arriba-Deleted] å¤ç”¨ TP ç¼“å­˜: TP{tp_fusion.id}.pdf -> {get_deleted_display_id(squeue_id)}")
                return send_file(tp_cache_path, mimetype='application/pdf',
                                 as_attachment=False, download_name=f"{tp_fusion.id}.pdf")

        # 校验必要字段
        if not all([arriba_dict['left_gene'], arriba_dict['right_gene'],
                    arriba_dict['left_breakpoint'], arriba_dict['right_breakpoint']]):
            return jsonify({'code': 400, 'message': '缺少必要的基因/断点字段'}), 400

        print(f"[Arriba-Deleted] 生成 {get_deleted_display_id(squeue_id)}: {arriba_dict['fusion_name']}")

        success = generate_arriba_diagram(arriba_dict, cache_path, panels)

        if success and _is_valid_arriba_pdf(cache_path):
            return send_file(cache_path, mimetype='application/pdf',
                             as_attachment=False, download_name=f"{get_deleted_display_id(squeue_id)}.pdf")
        else:
            return jsonify({'code': 500, 'message': '融合图生成失败'}), 500

    except Exception as e:
        print(f"[Arriba-Deleted] 错误: {str(e)}")
        import traceback; traceback.print_exc()
        return jsonify({'code': 500, 'message': f'服务器错误: {str(e)}'}), 500


@arriba_bp.route('/deleted/diagram/download/<squeue_id>', methods=['GET'])
@jwt_required(optional=True)
def download_deleted_fusion_diagram(squeue_id):
    """下载 deleted fusion 的 Arriba 融合图 PDF"""
    try:
        cache_path = get_deleted_cache_path(squeue_id)

        if not _is_valid_arriba_pdf(cache_path):
            # 尝试先生成
            row = _fetch_deleted_row(squeue_id)
            if row:
                arriba_dict = deleted_row_to_arriba_dict(row)
                tp_fusion, tp_cache_path = _find_deleted_tp_cache(arriba_dict)
                if tp_cache_path:
                    fname = f"{arriba_dict.get('fusion_name', get_deleted_display_id(squeue_id))}_TP{tp_fusion.id}_arriba.pdf"
                    return send_file(tp_cache_path, mimetype='application/pdf',
                                     as_attachment=True, download_name=fname)
                generate_arriba_diagram(arriba_dict, cache_path)

        if _is_valid_arriba_pdf(cache_path):
            return send_file(cache_path, mimetype='application/pdf',
                             as_attachment=True,
                             download_name=f"{get_deleted_display_id(squeue_id)}_arriba.pdf")

        return jsonify({'code': 404, 'message': '图表不存在'}), 404

    except Exception as e:
        return jsonify({'code': 500, 'message': f'下载失败: {str(e)}'}), 500


@arriba_bp.route('/deleted/variants/<path:fusion_name>', methods=['GET'])
@jwt_required(optional=True)
def get_deleted_fusion_variants(fusion_name):
    """
    获取 deleted fusion 的所有变体信息（供 ArribaFusionDiagram 组件使用）
    返回格式与 /arriba/variants/<fusion_name> 保持一致
    """
    import requests
    try:
        resp = requests.get(
            f'http://127.0.0.1:{os.environ.get("PORT", 5000)}/api/deleted/by-name/{requests.utils.quote(fusion_name, safe="")}',
            timeout=60
        )
        if not resp.ok:
            return jsonify({'code': 404, 'message': f'未找到融合: {fusion_name}'}), 404

        data = resp.json()
        items = data.get('data', {}).get('items', [])

        variants = []
        for row in items:
            sq = row.get('squeue', '')
            variants.append({
                'id': sq,
                'fusion_name': row.get('fusionName', ''),
                'left_gene': clean_gene(row.get('leftGene', '') or row.get('LeftGene', '')),
                'right_gene': clean_gene(row.get('rightGene', '') or row.get('RightGene', '')),
                'left_breakpoint': row.get('leftBreakpoint', '') or row.get('LeftBreakpoint', ''),
                'right_breakpoint': row.get('rightBreakpoint', '') or row.get('RightBreakpoint', ''),
                'left_breakpoint_display': format_breakpoint_display(
                    row.get('leftBreakpoint', '') or row.get('LeftBreakpoint', '')),
                'right_breakpoint_display': format_breakpoint_display(
                    row.get('rightBreakpoint', '') or row.get('RightBreakpoint', '')),
                'prot_fusion_type': row.get('PROT_FUSION_TYPE', '') or '',
                'fq': float(row.get('fq', 0) or 0),
                'avg_ffpm': float(row.get('ffpm', 0) or row.get('FFPM.cal', 0) or 0),
                'avg_junction_read_count': float(row.get('junction', 0) or row.get('JunctionReadCount', 0) or 0),
                'avg_spanning_frag_count': float(row.get('spanningFrag', 0) or row.get('SpanningFragCount', 0) or 0),
                'reading_frame': 'in-frame' if (row.get('PROT_FUSION_TYPE', '') or '').upper() == 'INFRAME' else
                                 'out-of-frame' if (row.get('PROT_FUSION_TYPE', '') or '').upper() == 'FRAMESHIFT' else 'unknown',
            })

        # 按 fq 排序
        variants.sort(key=lambda v: v['fq'], reverse=True)
        default_variant = variants[0] if variants else None

        return jsonify({
            'code': 200,
            'message': 'success',
            'data': {
                'fusion_name': fusion_name,
                'total_variants': len(variants),
                'default_variant_id': default_variant['id'] if default_variant else None,
                'variants': variants
            }
        }), 200

    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'code': 500, 'message': f'获取变体失败: {str(e)}'}), 500

# ══════════════════════════════════════════════════════════════════════════════
# ==================== Cell Line Fusion (cellfusion) Arriba 路由 ====================
# 数据来自 cellfusion_final.csv 中由 cellfusion_routes.py 写入的 sidecar JSON
# 缓存目录：arriba/cellfusion_cache/（与 cellfusion_routes._CELLFUSION_ARRIBA_DIR 相同路径）
# ══════════════════════════════════════════════════════════════════════════════

CELLFUSION_CACHE_DIR = os.path.join(os.path.dirname(ARRIBA_CONFIG['cache_dir']), 'cellfusion_cache')
os.makedirs(CELLFUSION_CACHE_DIR, exist_ok=True)
print(f"[Arriba-CellFusion] 缓存目录: {CELLFUSION_CACHE_DIR}")


def _normalize_cellfusion_id(cf_id: str) -> str:
    raw = str(cf_id or '').strip()
    if not raw:
        return ''
    if raw.upper().startswith('CL'):
        value = raw[2:]
    else:
        value = raw
    if value.endswith('.0'):
        value = value[:-2]
    return f"CL{value}" if value else ''


def _cellfusion_pdf_cache_path(cf_id: str) -> str:
    """Cell-line Arriba PDFs are stored with CL IDs in the shared arriba/cache dir."""
    safe_id = _normalize_cellfusion_id(cf_id) or str(cf_id).strip()
    return os.path.join(ARRIBA_CONFIG['cache_dir'], f"{safe_id}.pdf")


def _load_cf_sidecar(cf_id: str):
    """读取 cellfusion sidecar JSON，返回 dict 或 None"""
    import json as _json
    safe_id = _normalize_cellfusion_id(cf_id) or str(cf_id).strip()
    path = os.path.join(CELLFUSION_CACHE_DIR, f"{safe_id}.json")
    if not os.path.isfile(path):
        return None
    try:
        with open(path, encoding='utf-8') as f:
            return _json.load(f)
    except Exception as e:
        print(f"[Arriba-CellFusion] 读取 sidecar 失败 {cf_id}: {e}")
        return None


def _normalize_breakpoint_for_match(value: str) -> str:
    return re.sub(r'\s+', '', str(value or '').strip().lower())


def _find_matching_tp_fusion(row: dict):
    fusion_name = str(row.get('fusion_name') or '').strip()
    left_bp = _normalize_breakpoint_for_match(row.get('left_breakpoint'))
    right_bp = _normalize_breakpoint_for_match(row.get('right_breakpoint'))
    if not fusion_name or not left_bp or not right_bp:
        return None

    candidates = Fusion.query.filter_by(fusion_name=fusion_name).all()
    for fusion in candidates:
        if (
            _normalize_breakpoint_for_match(fusion.left_breakpoint) == left_bp and
            _normalize_breakpoint_for_match(fusion.right_breakpoint) == right_bp
        ):
            return fusion
    return None


@arriba_bp.route('/cellfusion/diagram/exists/<cf_id>', methods=['GET'])
@jwt_required(optional=True)
def check_cellfusion_diagram_exists(cf_id):
    """检查 cellfusion 融合图 PDF 缓存是否存在"""
    cf_cache_path = _cellfusion_pdf_cache_path(cf_id)
    exists = _is_valid_arriba_pdf(cf_cache_path)
    tp_id = None
    row = _load_cf_sidecar(cf_id)
    if row:
        tp_fusion = _find_matching_tp_fusion(row)
        if tp_fusion:
            tp_id = tp_fusion.id
            exists = exists or _is_valid_arriba_pdf(get_cache_path(tp_fusion.id))
    return jsonify({'code': 200, 'data': {'exists': exists, 'tp_id': tp_id}}), 200


@arriba_bp.route('/cellfusion/diagram/<cf_id>', methods=['GET'])
@jwt_required(optional=True)
def get_cellfusion_diagram(cf_id):
    """
    获取 cellfusion 融合的 Arriba 融合图。
    cf_id 由 cellfusion_routes /by-name/ 接口生成并写入 sidecar（格式：CL{squeue}）。
    """
    try:
        panels = request.args.get('panels', 'fusion,domains,readcounts')
        force  = request.args.get('force', 'false').lower() == 'true'

        safe_id = _normalize_cellfusion_id(cf_id) or str(cf_id).strip()
        cache_path = _cellfusion_pdf_cache_path(safe_id)

        # 读取 sidecar，先用它判断是否能复用 TP 图。
        row = _load_cf_sidecar(cf_id)
        if not row:
            return jsonify({
                'code': 404,
                'message': (
                    f'未找到 cf_id={cf_id} 对应的数据。'
                    '请先通过 /api/cellfusion/by-name/<fusion_name> 接口加载该融合的数据。'
                )
            }), 404

        if not force:
            tp_fusion = _find_matching_tp_fusion(row)
            if tp_fusion:
                tp_cache_path = get_cache_path(tp_fusion.id)
                if _is_valid_arriba_pdf(tp_cache_path):
                    print(f"[Arriba-CellFusion] 复用 TP 缓存: TP{tp_fusion.id}.pdf -> {safe_id}")
                    return send_file(tp_cache_path, mimetype='application/pdf',
                                     as_attachment=False, download_name=f"{tp_fusion.id}.pdf")

            if _is_valid_arriba_pdf(cache_path):
                print(f"[Arriba-CellFusion] 命中 CL 缓存: {safe_id}.pdf")
                return send_file(cache_path, mimetype='application/pdf',
                                 as_attachment=False, download_name=f"{safe_id}.pdf")

        # 校验必要字段
        if not all([row.get('left_gene'), row.get('right_gene'),
                    row.get('left_breakpoint'), row.get('right_breakpoint')]):
            return jsonify({'code': 400, 'message': '缺少必要的基因/断点字段'}), 400

        print(f"[Arriba-CellFusion] 生成 {safe_id}: {row.get('fusion_name')} | {row.get('cell_line', 'N/A')}")

        success = generate_arriba_diagram(row, cache_path, panels)

        if success and _is_valid_arriba_pdf(cache_path):
            return send_file(cache_path, mimetype='application/pdf',
                             as_attachment=False, download_name=f"{safe_id}.pdf")
        else:
            return jsonify({'code': 500, 'message': '融合图生成失败'}), 500

    except Exception as e:
        print(f"[Arriba-CellFusion] 错误: {str(e)}")
        import traceback; traceback.print_exc()
        return jsonify({'code': 500, 'message': f'服务器错误: {str(e)}'}), 500


@arriba_bp.route('/cellfusion/diagram/download/<cf_id>', methods=['GET'])
@jwt_required(optional=True)
def download_cellfusion_diagram(cf_id):
    """下载 cellfusion 融合图 PDF"""
    try:
        panels     = request.args.get('panels', 'fusion,domains,readcounts')
        safe_id = _normalize_cellfusion_id(cf_id) or str(cf_id).strip()
        cache_path = _cellfusion_pdf_cache_path(safe_id)
        row_data = _load_cf_sidecar(cf_id) or {}

        tp_fusion = _find_matching_tp_fusion(row_data) if row_data else None
        if tp_fusion and _is_valid_arriba_pdf(get_cache_path(tp_fusion.id)):
            fname = f"{row_data.get('fusion_name', safe_id)}_TP{tp_fusion.id}_arriba.pdf"
            return send_file(get_cache_path(tp_fusion.id), mimetype='application/pdf',
                             as_attachment=True, download_name=fname)

        if not _is_valid_arriba_pdf(cache_path):
            if row_data:
                generate_arriba_diagram(row_data, cache_path, panels)

        if _is_valid_arriba_pdf(cache_path):
            fname      = f"{row_data.get('fusion_name', safe_id)}_{safe_id}_arriba.pdf"
            return send_file(cache_path, mimetype='application/pdf',
                             as_attachment=True, download_name=fname)

        return jsonify({'code': 404, 'message': '图表不存在'}), 404

    except Exception as e:
        return jsonify({'code': 500, 'message': f'下载失败: {str(e)}'}), 500
