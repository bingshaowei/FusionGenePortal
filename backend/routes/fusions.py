# backend/routes/fusion_routes.py
from flask import Blueprint, jsonify, request, send_file
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import Fusion, FusionAll, User
from extensions import db
from sqlalchemy import or_, and_, func, distinct
import re
import csv
import io
import tempfile
from collections import OrderedDict
from threading import RLock

fusion_bp = Blueprint('fusion', __name__)

# 在文件顶部（约第15行）添加这三个全局变量：
_fusion_name_cache = None
_gene_cache = None
_co_occurrence_sample_index = None
_co_occurrence_cache = OrderedDict()
_CO_OCCURRENCE_CACHE_MAX = 256
_co_occurrence_lock = RLock()

_cache_timestamp = None  # 【修复】这个变量之前可能漏了

# ==================== 辅助函数 ====================


def _co_cache_get(key):
    with _co_occurrence_lock:
        value = _co_occurrence_cache.get(key)
        if value is None:
            return None
        _co_occurrence_cache.move_to_end(key)
        return value


def _co_cache_set(key, value):
    with _co_occurrence_lock:
        _co_occurrence_cache[key] = value
        _co_occurrence_cache.move_to_end(key)
        while len(_co_occurrence_cache) > _CO_OCCURRENCE_CACHE_MAX:
            _co_occurrence_cache.popitem(last=False)


def _split_sample_names(value):
    if not value:
        return []
    return [s.strip() for s in re.split(r'[,;|]+', str(value)) if s.strip()]


def _get_co_occurrence_sample_index():
    global _co_occurrence_sample_index

    with _co_occurrence_lock:
        if _co_occurrence_sample_index is not None:
            return _co_occurrence_sample_index

        print("[CoOccurrence] building sample -> fusion index...")
        rows = db.session.query(Fusion.sample_name, Fusion.fusion_name).filter(
            Fusion.sample_name.isnot(None),
            Fusion.fusion_name.isnot(None),
        ).all()

        index = {}
        for sample_names, fusion_name in rows:
            fn = str(fusion_name or '').strip()
            if not fn:
                continue
            for sample_id in _split_sample_names(sample_names):
                index.setdefault(sample_id, set()).add(fn)

        _co_occurrence_sample_index = index
        print(f"[CoOccurrence] index ready: {len(index)} samples")
        return _co_occurrence_sample_index


def serialize_fusion_full(fusion):
    """序列化Fusion对象为完整字典(包含所有字段)"""
    return {
        'id': fusion.id,
        
        # 基础信息
        'fusion_name': fusion.fusion_name,
        'left_gene': fusion.left_gene,
        'left_breakpoint': fusion.left_breakpoint,
        'right_gene': fusion.right_gene,
        'right_breakpoint': fusion.right_breakpoint,
        'left_break_dinuc': fusion.left_break_dinuc,
        'right_break_dinuc': fusion.right_break_dinuc,
        'annots': fusion.annots,
        
        # CDS信息
        'cds_left_id': fusion.cds_left_id,
        'cds_left_range': fusion.cds_left_range,
        'cds_right_id': fusion.cds_right_id,
        'cds_right_range': fusion.cds_right_range,
        'prot_fusion_type': fusion.prot_fusion_type,
        'fusion_model': fusion.fusion_model,
        'fusion_cds': fusion.fusion_cds,
        'fusion_transl': fusion.fusion_transl,
        'pfam_left': fusion.pfam_left,
        'pfam_right': fusion.pfam_right,
        
        # Result信息
        'result_function_left': fusion.result_function_left,
        'result_exon_left': fusion.result_exon_left,
        'result_breakpoint_left': fusion.result_breakpoint_left,
        'result_function_right': fusion.result_function_right,
        'result_exon_right': fusion.result_exon_right,
        'result_breakpoint_right': fusion.result_breakpoint_right,
        'new_fusion_name': fusion.new_fusion_name,
        
        # Transcript信息
        'transcript_left_range': fusion.transcript_left_range,
        'transcript_right_range': fusion.transcript_right_range,
        'transcript_length': fusion.transcript_length,
        'left_cds_status': fusion.left_cds_status,
        'right_cds_status': fusion.right_cds_status,
        'transcript_left_length': fusion.transcript_left_length,
        'transcript_right_length': fusion.transcript_right_length,
        
        # Alignment信息
        'alignment_length_awt': fusion.alignment_length_awt,
        'score_awt': fusion.score_awt,
        'alignment_length_bwt': fusion.alignment_length_bwt,
        'score_bwt': fusion.score_bwt,
        
        # Sample信息
        'sample_name': fusion.sample_name,
        'avg_junction_read_count': fusion.avg_junction_read_count,
        'avg_spanning_frag_count': fusion.avg_spanning_frag_count,
        'avg_est_j': fusion.avg_est_j,
        'avg_est_s': fusion.avg_est_s,
        'avg_all_count': fusion.avg_all_count,
        'avg_est_count': fusion.avg_est_count,
        'avg_left_break_entropy': fusion.avg_left_break_entropy,
        'avg_right_break_entropy': fusion.avg_right_break_entropy,
        'avg_found_left_exp': fusion.avg_found_left_exp,
        'avg_found_right_exp': fusion.avg_found_right_exp,
        
        # LargeAnchorSupport
        'large_anchor_support_yes': fusion.large_anchor_support_yes,
        'large_anchor_support_no': fusion.large_anchor_support_no,
        'avg_ffpm': fusion.avg_ffpm,
        'ffpm_lt_01_fq': fusion.ffpm_lt_01_fq,
        'fq': fusion.fq,
        
        # 分类信息
        'denovo': fusion.denovo,
        'gdc_normal': fusion.gdc_normal,
        'normal': fusion.normal,
        'recurrent': fusion.recurrent,
        'post_treatment': fusion.post_treatment,
        'race_asian': fusion.race_asian,
        'project_ebaml': fusion.project_ebaml,
        
        # First Event
        'first_event_censored': fusion.first_event_censored,
        'first_event_death': fusion.first_event_death,
        'first_event_death_without_remission': fusion.first_event_death_without_remission,
        'first_event_induction_failure': fusion.first_event_induction_failure,
        'first_event_relapse': fusion.first_event_relapse,
        'first_event_na': fusion.first_event_na,
        
        # FAB分类
        'fab_m0': fusion.fab_m0,
        'fab_m1': fusion.fab_m1,
        'fab_m2': fusion.fab_m2,
        'fab_m3': fusion.fab_m3,
        'fab_m4': fusion.fab_m4,
        'fab_m5': fusion.fab_m5,
        'fab_m6': fusion.fab_m6,
        'fab_m7': fusion.fab_m7,
        'fab_nos': fusion.fab_nos,
        'fab_na': fusion.fab_na,
        
        # Risk Group
        'risk_group_high': fusion.risk_group_high,
        'risk_group_low': fusion.risk_group_low,
        'risk_group_standard': fusion.risk_group_standard,
        
        # CR Status Course 1
        'cr_status_at_course1_cr': fusion.cr_status_at_course1_cr,
        'cr_status_at_course1_death': fusion.cr_status_at_course1_death,
        'cr_status_at_course1_not_cr': fusion.cr_status_at_course1_not_cr,
        'cr_status_at_course1_unevaluable': fusion.cr_status_at_course1_unevaluable,
        
        # CR Status Course 2
        'cr_status_at_course2_cr': fusion.cr_status_at_course2_cr,
        'cr_status_at_course2_death': fusion.cr_status_at_course2_death,
        'cr_status_at_course2_not_cr': fusion.cr_status_at_course2_not_cr,
        'cr_status_at_course2_unevaluable': fusion.cr_status_at_course2_unevaluable,
        
        # 平均值信息
        'avg_age_at_diagnosis_in_days': fusion.avg_age_at_diagnosis_in_days,
        'avg_event_free_survival_time_in_days': fusion.avg_event_free_survival_time_in_days,
        'avg_overall_servival_time_in_days': fusion.avg_overall_servival_time_in_days,
        'avg_cytogenetic_complexity': fusion.avg_cytogenetic_complexity,
        'avg_mrd_at_end_of_course_1': fusion.avg_mrd_at_end_of_course_1,
        'avg_mrd_at_end_of_course_2': fusion.avg_mrd_at_end_of_course_2,
        
        # 性别和生存状态
        'male': fusion.male,
        'female': fusion.female,
        'alive': fusion.alive,
        'dead': fusion.dead,
        
        # 基因突变信息
        'flt3_itd_y': fusion.flt3_itd_y,
        'flt3_itd_n': fusion.flt3_itd_n,
        'flt3_pm_y': fusion.flt3_pm_y,
        'flt3_pm_n': fusion.flt3_pm_n,
        'npm_mu_y': fusion.npm_mu_y,
        'npm_mu_n': fusion.npm_mu_n,
        'cebpa_mu_y': fusion.cebpa_mu_y,
        'cebpa_mu_n': fusion.cebpa_mu_n,
        'wt1_mu_y': fusion.wt1_mu_y,
        'wt1_mu_n': fusion.wt1_mu_n,
        'c_kit_mu_exon8_y': fusion.c_kit_mu_exon8_y,
        'c_kit_mu_exon8_n': fusion.c_kit_mu_exon8_n,
        
        # Gene A信息
        'genome_location_a': fusion.genome_location_a,
        'hallmark_a': fusion.hallmark_a,
        'chr_band_a': fusion.chr_band_a,
        'somatic_a': fusion.somatic_a,
        'germline_a': fusion.germline_a,
        'tumour_types_somatic_a': fusion.tumour_types_somatic_a,
        'tumour_types_germline_a': fusion.tumour_types_germline_a,
        'cancer_syndrome_a': fusion.cancer_syndrome_a,
        'role_in_cancer_a': fusion.role_in_cancer_a,
        'mutation_types_a': fusion.mutation_types_a,
        'translocation_partner_a': fusion.translocation_partner_a,
        'other_germline_mut_a': fusion.other_germline_mut_a,
        'other_syndrome_a': fusion.other_syndrome_a,
        
        # Gene B信息
        'genome_location_b': fusion.genome_location_b,
        'hallmark_b': fusion.hallmark_b,
        'chr_band_b': fusion.chr_band_b,
        'somatic_b': fusion.somatic_b,
        'germline_b': fusion.germline_b,
        'tumour_types_somatic_b': fusion.tumour_types_somatic_b,
        'tumour_types_germline_b': fusion.tumour_types_germline_b,
        'cancer_syndrome_b': fusion.cancer_syndrome_b,
        'role_in_cancer_b': fusion.role_in_cancer_b,
        'mutation_types_b': fusion.mutation_types_b,
        'translocation_partner_b': fusion.translocation_partner_b,
        'other_germline_mut_b': fusion.other_germline_mut_b,
        'other_syndrome_b': fusion.other_syndrome_b,
        
        # Protein A信息
        'protein_names_a': fusion.protein_names_a,
        'gene_names_a': fusion.gene_names_a,
        'polymorphism_a': fusion.polymorphism_a,
        'dna_binding_a': fusion.dna_binding_a,
        'pathway_a': fusion.pathway_a,
        'site_a': fusion.site_a,
        'function_cc_a': fusion.function_cc_a,
        'activity_regulation_a': fusion.activity_regulation_a,
        'cofactor_a': fusion.cofactor_a,
        'binding_site_a': fusion.binding_site_a,
        'protein_existence_a': fusion.protein_existence_a,
        'features_a': fusion.features_a,
        'subunit_structure_a': fusion.subunit_structure_a,
        'developmental_stage_a': fusion.developmental_stage_a,
        'induction_a': fusion.induction_a,
        'tissue_specificity_a': fusion.tissue_specificity_a,
        'gene_ontology_go_a': fusion.gene_ontology_go_a,
        'involvement_in_disease_a': fusion.involvement_in_disease_a,
        'mutagenesis_a': fusion.mutagenesis_a,
        'pharmaceutical_use_a': fusion.pharmaceutical_use_a,
        'intramembrane_a': fusion.intramembrane_a,
        'subcellular_location_cc_a': fusion.subcellular_location_cc_a,
        'post_translational_modification_a': fusion.post_translational_modification_a,
        'date_of_last_modification_a': fusion.date_of_last_modification_a,
        'domain_cc_a': fusion.domain_cc_a,
        'protein_families_a': fusion.protein_families_a,
        'sequence_similarities_a': fusion.sequence_similarities_a,
        
        # Protein B信息
        'protein_names_b': fusion.protein_names_b,
        'gene_names_b': fusion.gene_names_b,
        'polymorphism_b': fusion.polymorphism_b,
        'dna_binding_b': fusion.dna_binding_b,
        'pathway_b': fusion.pathway_b,
        'site_b': fusion.site_b,
        'function_cc_b': fusion.function_cc_b,
        'activity_regulation_b': fusion.activity_regulation_b,
        'cofactor_b': fusion.cofactor_b,
        'binding_site_b': fusion.binding_site_b,
        'protein_existence_b': fusion.protein_existence_b,
        'features_b': fusion.features_b,
        'subunit_structure_b': fusion.subunit_structure_b,
        'developmental_stage_b': fusion.developmental_stage_b,
        'induction_b': fusion.induction_b,
        'tissue_specificity_b': fusion.tissue_specificity_b,
        'gene_ontology_go_b': fusion.gene_ontology_go_b,
        'involvement_in_disease_b': fusion.involvement_in_disease_b,
        'mutagenesis_b': fusion.mutagenesis_b,
        'pharmaceutical_use_b': fusion.pharmaceutical_use_b,
        'intramembrane_b': fusion.intramembrane_b,
        'subcellular_location_cc_b': fusion.subcellular_location_cc_b,
        'post_translational_modification_b': fusion.post_translational_modification_b,
        'date_of_last_modification_b': fusion.date_of_last_modification_b,
        'domain_cc_b': fusion.domain_cc_b,
        'protein_families_b': fusion.protein_families_b,
        'sequence_similarities_b': fusion.sequence_similarities_b,
        
        'created_at': fusion.created_at.isoformat() if fusion.created_at else None
    }


# 🔧 修改：判断搜索词是否为TP开头的ID（如 TP123）— 原来是T前缀，现在改为TP前缀
def is_tp_prefixed_id(search_str):
    """判断搜索词是否为TP开头的数字ID（用于PASS数据ID搜索）"""
    upper = search_str.upper()
    if upper.startswith('TP') and len(search_str) > 2:
        return search_str[2:].isdigit()
    return False


def extract_id_from_tp_prefix(search_str):
    """从TP前缀字符串中提取数字ID"""
    if is_tp_prefixed_id(search_str):
        return int(search_str[2:])
    return None


# ==================== API路由 ====================

@fusion_bp.route('/by-band/<band>', methods=['GET'])
@jwt_required(optional=True)
def get_fusions_by_band(band):
    """获取指定染色体带的融合基因(返回完整字段)"""
    try:
        limit = request.args.get('limit', 300, type=int)
        full = request.args.get('full', 'true', type=str).lower() == 'true'
        
        query = Fusion.query.filter(
            or_(
                Fusion.chr_band_a == band,
                Fusion.chr_band_b == band
            )
        ).order_by(Fusion.avg_ffpm.desc().nullslast()).limit(limit)
        
        fusions = query.all()
        
        # 根据参数决定返回简化版还是完整版
        if full:
            items = [serialize_fusion_full(fusion) for fusion in fusions]
        else:
            items = [{
                'id': fusion.id,
                'fusion_name': fusion.fusion_name,
                'left_gene': fusion.left_gene,
                'left_breakpoint': fusion.left_breakpoint,
                'right_gene': fusion.right_gene,
                'right_breakpoint': fusion.right_breakpoint,
                'chr_band_a': fusion.chr_band_a,
                'chr_band_b': fusion.chr_band_b,
                'avg_ffpm': fusion.avg_ffpm,
                'sample_name': fusion.sample_name
            } for fusion in fusions]
        
        return jsonify({
            'code': 200,
            'message': 'success',
            'data': items
        }), 200
        
    except Exception as e:
        return jsonify({
            'code': 500,
            'message': f'获取染色体带数据失败: {str(e)}'
        }), 500


@fusion_bp.route('/export-csv/<band>', methods=['GET'])
@jwt_required(optional=True)
def export_band_csv(band):
    """导出染色体带数据为CSV(供R使用)"""
    try:
        limit = request.args.get('limit', 300, type=int)
        
        query = Fusion.query.filter(
            or_(
                Fusion.chr_band_a == band,
                Fusion.chr_band_b == band
            )
        ).order_by(Fusion.avg_ffpm.desc().nullslast()).limit(limit)
        
        fusions = query.all()
        
        # 创建CSV
        output = io.StringIO()
        writer = csv.writer(output)
        
        # 写入表头 - 只包含R绘图需要的关键字段
        writer.writerow([
            'id', 'fusion_name', 'left_gene', 'left_breakpoint',
            'right_gene', 'right_breakpoint', 'chr_band_a', 'chr_band_b',
            'avg_ffpm', 'sample_name', 'avg_junction_read_count',
            'avg_spanning_frag_count', 'prot_fusion_type'
        ])
        
        # 写入数据
        for fusion in fusions:
            writer.writerow([
                fusion.id,
                fusion.fusion_name or '',
                fusion.left_gene or '',
                fusion.left_breakpoint or '',
                fusion.right_gene or '',
                fusion.right_breakpoint or '',
                fusion.chr_band_a or '',
                fusion.chr_band_b or '',
                fusion.avg_ffpm or 0,
                fusion.sample_name or '',
                fusion.avg_junction_read_count or 0,
                fusion.avg_spanning_frag_count or 0,
                fusion.prot_fusion_type or ''
            ])
        
        # 创建响应
        output.seek(0)
        return send_file(
            io.BytesIO(output.getvalue().encode('utf-8')),
            mimetype='text/csv',
            as_attachment=True,
            download_name=f'fusion_{band}.csv'
        )
        
    except Exception as e:
        return jsonify({
            'code': 500,
            'message': f'导出CSV失败: {str(e)}'
        }), 500


@fusion_bp.route('/detail/<int:fusion_id>', methods=['GET'])
@jwt_required(optional=True)
def get_fusion_detail(fusion_id):
    """获取单个Fusion记录的详细信息(完整字段)"""
    try:
        fusion = Fusion.query.get(fusion_id)
        
        if not fusion:
            return jsonify({
                'code': 404,
                'message': 'Fusion记录不存在'
            }), 404
        
        return jsonify({
            'code': 200,
            'message': 'success',
            'data': serialize_fusion_full(fusion)
        }), 200
        
    except Exception as e:
        return jsonify({
            'code': 500,
            'message': f'获取详情失败: {str(e)}'
        }), 500


@fusion_bp.route('/list', methods=['GET'])
@jwt_required(optional=True)
def get_fusion_list():
    """获取Fusion数据列表"""
    try:
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 20, type=int)
        search = request.args.get('search', '', type=str)
        full = request.args.get('full', 'false', type=str).lower() == 'true'
        
        query = Fusion.query
        
        if search:
            query = query.filter(
                or_(
                    Fusion.fusion_name.like(f'%{search}%'),
                    Fusion.left_gene.like(f'%{search}%'),
                    Fusion.right_gene.like(f'%{search}%'),
                    Fusion.sample_name.like(f'%{search}%'),
                    Fusion.left_breakpoint.like(f'%{search}%'),
                    Fusion.right_breakpoint.like(f'%{search}%'),
                    Fusion.chr_band_a.like(f'%{search}%'),
                    Fusion.chr_band_b.like(f'%{search}%')
                )
            )
        
        pagination = query.order_by(Fusion.id.desc()).paginate(
            page=page, 
            per_page=per_page, 
            error_out=False
        )
        
        if full:
            items = [serialize_fusion_full(fusion) for fusion in pagination.items]
        else:
            items = [{
                'id': fusion.id,
                'fusion_name': fusion.fusion_name,
                'left_gene': fusion.left_gene,
                'left_breakpoint': fusion.left_breakpoint,
                'right_gene': fusion.right_gene,
                'right_breakpoint': fusion.right_breakpoint,
                'chr_band_a': fusion.chr_band_a,
                'chr_band_b': fusion.chr_band_b,
                'sample_name': fusion.sample_name,
                'avg_ffpm': fusion.avg_ffpm,
                'prot_fusion_type': fusion.prot_fusion_type,
                'created_at': fusion.created_at.isoformat() if fusion.created_at else None
            } for fusion in pagination.items]
        
        return jsonify({
            'code': 200,
            'message': 'success',
            'data': {
                'items': items,
                'total': pagination.total,
                'page': page,
                'per_page': per_page,
                'pages': pagination.pages
            }
        }), 200
        
    except Exception as e:
        return jsonify({
            'code': 500,
            'message': f'获取数据失败: {str(e)}'
        }), 500


@fusion_bp.route('/search/chromosome', methods=['GET'])
@jwt_required(optional=True)
def search_by_chromosome():
    """染色体搜索"""
    try:
        left_chr = request.args.get('left_chr', '', type=str)
        right_chr = request.args.get('right_chr', '', type=str)
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 20, type=int)
        
        query = Fusion.query
        
        if left_chr:
            query = query.filter(Fusion.left_breakpoint.like(f'{left_chr}%'))
        
        if right_chr:
            query = query.filter(Fusion.right_breakpoint.like(f'{right_chr}%'))
        
        query = query.order_by(Fusion.avg_ffpm.desc().nullslast())
        
        pagination = query.paginate(
            page=page,
            per_page=per_page,
            error_out=False
        )
        
        items = [serialize_fusion_full(fusion) for fusion in pagination.items]
        
        return jsonify({
            'code': 200,
            'message': 'success',
            'data': {
                'items': items,
                'total': pagination.total,
                'page': page,
                'per_page': per_page,
                'pages': pagination.pages
            }
        }), 200
        
    except Exception as e:
        return jsonify({
            'code': 500,
            'message': f'染色体搜索失败: {str(e)}'
        }), 500


@fusion_bp.route('/chromosome-bands', methods=['GET'])
@jwt_required(optional=True)
def get_chromosome_bands():
    """获取所有可用的染色体带位置"""
    try:
        left_bands = db.session.query(distinct(Fusion.chr_band_a)).filter(
            Fusion.chr_band_a.isnot(None)
        ).all()
        
        right_bands = db.session.query(distinct(Fusion.chr_band_b)).filter(
            Fusion.chr_band_b.isnot(None)
        ).all()
        
        all_bands = set()
        for band in left_bands:
            if band[0]:
                all_bands.add(band[0])
        for band in right_bands:
            if band[0]:
                all_bands.add(band[0])
        
        sorted_bands = sorted(list(all_bands))
        
        return jsonify({
            'code': 200,
            'message': 'success',
            'data': sorted_bands
        }), 200
        
    except Exception as e:
        return jsonify({
            'code': 500,
            'message': f'获取染色体带失败: {str(e)}'
        }), 500


@fusion_bp.route('/stats', methods=['GET'])
@jwt_required(optional=True)
def get_fusion_stats():
    """获取统计信息"""
    try:
        total_count = Fusion.query.count()
        unique_left_genes = db.session.query(func.count(distinct(Fusion.left_gene))).scalar()
        unique_right_genes = db.session.query(func.count(distinct(Fusion.right_gene))).scalar()
        unique_genes = unique_left_genes + unique_right_genes
        
        return jsonify({
            'code': 200,
            'message': 'success',
            'data': {
                'total_count': total_count,
                'unique_genes': unique_genes
            }
        }), 200
        
    except Exception as e:
        return jsonify({
            'code': 500,
            'message': f'获取统计信息失败: {str(e)}'
        }), 500


@fusion_bp.route('/chromosome/<chr_name>', methods=['GET'])
@jwt_required(optional=True)
def get_chromosome_fusions(chr_name):
    """获取特定染色体上的所有融合基因（优化版：简单查询，快速响应）"""
    try:
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 15, type=int)
        search = request.args.get('search', '', type=str)
        sort_by = request.args.get('sort_by', 'fq', type=str)
        sort_order = request.args.get('sort_order', 'desc', type=str)
        
        query = Fusion.query.filter(
            or_(
                Fusion.left_breakpoint.like(f'{chr_name}:%'),
                Fusion.right_breakpoint.like(f'{chr_name}:%')
            )
        )
        
        if search:
            query = query.filter(
                or_(
                    Fusion.left_gene.ilike(f'%{search}%'),
                    Fusion.right_gene.ilike(f'%{search}%'),
                    Fusion.fusion_name.ilike(f'%{search}%'),
                    Fusion.sample_name.ilike(f'%{search}%')
                )
            )
        
        if sort_by == 'avg_ffpm':
            if sort_order == 'asc':
                query = query.order_by(Fusion.avg_ffpm.asc().nullslast())
            else:
                query = query.order_by(Fusion.avg_ffpm.desc().nullslast())
        else:
            if sort_order == 'asc':
                query = query.order_by(Fusion.fq.asc().nullslast())
            else:
                query = query.order_by(Fusion.fq.desc().nullslast())
        
        pagination = query.paginate(
            page=page,
            per_page=per_page,
            error_out=False
        )
        
        items = [{
            'id': fusion.id,
            'fusion_name': fusion.fusion_name,
            'left_gene': fusion.left_gene,
            'left_breakpoint': fusion.left_breakpoint,
            'right_gene': fusion.right_gene,
            'right_breakpoint': fusion.right_breakpoint,
            'chr_band_a': fusion.chr_band_a,
            'chr_band_b': fusion.chr_band_b,
            'annots': fusion.annots,
            'fq': fusion.fq or 0,
            'avg_ffpm': fusion.avg_ffpm or 0,
            'sample_name': fusion.sample_name,
            'prot_fusion_type': fusion.prot_fusion_type
        } for fusion in pagination.items]
        
        return jsonify({
            'code': 200,
            'message': 'success',
            'data': {
                'items': items,
                'total': pagination.total,
                'page': page,
                'per_page': per_page,
                'pages': pagination.pages,
                'chromosome': chr_name
            }
        }), 200
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({
            'code': 500,
            'message': f'获取染色体数据失败: {str(e)}'
        }), 500


@fusion_bp.route('/by-name/<path:fusion_name>', methods=['GET'])
@jwt_required(optional=True)
def get_fusion_by_name(fusion_name):
    """根据融合名获取所有变体，返回正确的JSON格式"""
    try:
        print(f"[DEBUG] 查询fusion_name: {fusion_name}")

        records = Fusion.query.filter(Fusion.fusion_name == fusion_name).all()
        print(f"[DEBUG] 找到 {len(records)} 条记录")

        if not records:
            return jsonify({
                'code': 404,
                'message': f'未找到融合 {fusion_name}',
                'data': {'columns': [], 'items': []}
            }), 404

        items = []
        for record in records:
            try:
                serialized = serialize_fusion_full(record)
                items.append(serialized)
            except Exception as e:
                print(f"[ERROR] 序列化记录 {record.id} 失败: {str(e)}")
                continue

        columns = list(items[0].keys()) if items else []

        return jsonify({
            'code': 200,
            'message': 'success',
            'data': {
                'columns': columns,
                'items': items
            }
        }), 200
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({
            'code': 500,
            'message': f'获取数据失败: {str(e)}'
        }), 500


@fusion_bp.route('/original/<path:fusion_name>', methods=['GET'])
@jwt_required(optional=True)
def get_fusion_original(fusion_name):
    """获取 fusionall 表原始行"""
    try:
        print(f"[DEBUG] 查询fusion_all表，fusion_name: {fusion_name}")

        cols_all = list(FusionAll.__table__.columns)
        name_col = FusionAll.__table__.columns.get('X.FusionName')
        if name_col is None:
            candidates = ('fusion_name', 'x_fusion_name', 'X_FusionName', 'Fusion_Name', 'FusionName')
            for cand in candidates:
                if hasattr(FusionAll, cand):
                    name_col = getattr(FusionAll, cand)
                    break
        if name_col is None:
            return jsonify({'code': 500,
                            'message': f"FusionAll 未找到融合名列，可用列：{[c.name for c in cols_all]}"}), 500

        rows = db.session.query(*cols_all).filter(name_col == fusion_name).all()
        print(f"[DEBUG] 在fusion_all表找到 {len(rows)} 条记录")

        columns = [c.name for c in cols_all]
        items = [{c.name: row._mapping[c] for c in cols_all} for row in rows]

        return jsonify({'code': 200, 'message': 'success',
                        'data': {'columns': columns, 'items': items}}), 200
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'code': 500, 'message': f'获取原始数据失败: {str(e)}'}), 500


@fusion_bp.route('/list-unique', methods=['GET'])
@jwt_required(optional=True)
def get_unique_fusions():
    """获取每个fusion_name的第一行（去重后的数据）"""
    try:
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 20, type=int)
        search = request.args.get('search', '', type=str)
        
        subquery = db.session.query(
            Fusion.fusion_name,
            func.min(Fusion.id).label('min_id')
        ).group_by(Fusion.fusion_name).subquery()
        
        query = db.session.query(Fusion).join(
            subquery,
            and_(
                Fusion.fusion_name == subquery.c.fusion_name,
                Fusion.id == subquery.c.min_id
            )
        )
        
        if search:
            query = query.filter(
                or_(
                    Fusion.fusion_name.like(f'%{search}%'),
                    Fusion.left_gene.like(f'%{search}%'),
                    Fusion.right_gene.like(f'%{search}%'),
                    Fusion.sample_name.like(f'%{search}%'),
                    Fusion.left_breakpoint.like(f'%{search}%'),
                    Fusion.right_breakpoint.like(f'%{search}%'),
                    Fusion.chr_band_a.like(f'%{search}%'),
                    Fusion.chr_band_b.like(f'%{search}%')
                )
            )
        
        pagination = query.order_by(Fusion.avg_ffpm.desc().nullslast()).paginate(
            page=page,
            per_page=per_page,
            error_out=False
        )
        
        items = [serialize_fusion_full(fusion) for fusion in pagination.items]
        
        return jsonify({
            'code': 200,
            'message': 'success',
            'data': {
                'items': items,
                'total': pagination.total,
                'page': page,
                'per_page': per_page,
                'pages': pagination.pages
            }
        }), 200
        
    except Exception as e:
        print(f"[ERROR] list-unique失败: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'code': 500,
            'message': f'获取数据失败: {str(e)}'
        }), 500


@fusion_bp.route('/stats-unique', methods=['GET'])
@jwt_required(optional=True)
def get_unique_stats():
    """获取去重后的统计信息"""
    try:
        unique_fusion_count = db.session.query(
            func.count(func.distinct(Fusion.fusion_name))
        ).scalar()
        
        unique_left_genes = db.session.query(
            func.count(func.distinct(Fusion.left_gene))
        ).scalar()
        unique_right_genes = db.session.query(
            func.count(func.distinct(Fusion.right_gene))
        ).scalar()
        unique_genes = unique_left_genes + unique_right_genes
        
        total_records = Fusion.query.count()
        
        return jsonify({
            'code': 200,
            'message': 'success',
            'data': {
                'unique_fusion_count': unique_fusion_count,
                'total_records': total_records,
                'unique_genes': unique_genes,
                'chromosomes': 24
            }
        }), 200
        
    except Exception as e:
        print(f"[ERROR] stats-unique失败: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'code': 500,
            'message': f'获取统计信息失败: {str(e)}'
        }), 500

@fusion_bp.route('/search/advanced', methods=['GET'])
@jwt_required(optional=True)
def advanced_search():
    """
    高级搜索接口 - fq 求和版
    🔧 修改：支持 TP+编号 格式的ID搜索（原来是T前缀）
    """
    try:
        search = request.args.get('search', '', type=str).strip()
        exact_gene = request.args.get('exact_gene', 'false', type=str).lower() == 'true'
        strict_match = request.args.get('strict_match', 'false', type=str).lower() == 'true'
        left_chr = request.args.get('left_chr', '', type=str).strip()
        right_chr = request.args.get('right_chr', '', type=str).strip()
        left_gene_filter = request.args.get('left_gene', '', type=str).strip()
        right_gene_filter = request.args.get('right_gene', '', type=str).strip()
        sort_by = request.args.get('sort_by', 'fq', type=str)
        sort_order = request.args.get('sort_order', 'desc', type=str).lower()
        limit = request.args.get('limit', None, type=int)
        
        valid_sort_fields = ['fq', 'avg_ffpm']
        if sort_by not in valid_sort_fields:
            sort_by = 'fq'
        if sort_order not in ['asc', 'desc']:
            sort_order = 'desc'
        
        # 🔧 修改：检查是否为TP前缀ID搜索（如 TP123）
        if search and is_tp_prefixed_id(search):
            search_id = extract_id_from_tp_prefix(search)
            fusion = Fusion.query.get(search_id)
            
            if fusion:
                item = serialize_fusion_full(fusion)
                return jsonify({
                    'code': 200,
                    'message': 'success',
                    'data': {
                        'items': [item],
                        'total': 1,
                        'search': search,
                        'search_type': 'id',
                        'exact_gene': exact_gene,
                        'left_chr': left_chr,
                        'right_chr': right_chr,
                        'left_gene': left_gene_filter,
                        'right_gene': right_gene_filter,
                        'sort_by': sort_by,
                        'sort_order': sort_order
                    }
                }), 200
            else:
                return jsonify({
                    'code': 200,
                    'message': 'success',
                    'data': {
                        'items': [],
                        'total': 0,
                        'search': search,
                        'search_type': 'id',
                        'exact_gene': exact_gene,
                        'left_chr': left_chr,
                        'right_chr': right_chr,
                        'left_gene': left_gene_filter,
                        'right_gene': right_gene_filter,
                        'sort_by': sort_by,
                        'sort_order': sort_order
                    }
                }), 200
        
        # 按 fusion_name 分组，计算 fq 总和 + junction/spanning 总和 + 变体数
        subquery = db.session.query(
            Fusion.fusion_name,
            func.min(Fusion.id).label('min_id'),
            func.sum(func.coalesce(Fusion.fq, 0)).label('total_fq'),
            func.sum(func.coalesce(Fusion.avg_ffpm, 0)).label('total_avg_ffpm'),
            func.sum(func.coalesce(Fusion.avg_junction_read_count, 0)).label('total_jrc'),
            func.sum(func.coalesce(Fusion.avg_spanning_frag_count, 0)).label('total_sfc'),
            func.count(Fusion.id).label('variant_count')
        )
        
        if search:
            is_fusion_name_search = '--' in search
            
            if is_fusion_name_search:
                subquery = subquery.filter(
                    Fusion.fusion_name.ilike(search)
                )
            elif strict_match:
                # 🔧 精准搜索：只匹配基因名精确等于搜索词的融合
                # left_gene / right_gene 格式可能是 "RP2^ENSG00000..." 或 "RP2"
                subquery = subquery.filter(
                    or_(
                        Fusion.left_gene.ilike(f'{search}^%'),
                        Fusion.left_gene.ilike(search),
                        Fusion.right_gene.ilike(f'{search}^%'),
                        Fusion.right_gene.ilike(search),
                    )
                )
            elif exact_gene:
                # Fuzzy Search from the frontend keeps exact_gene=true but strict_match=false.
                # Match PASS the same way as FILTER: keyword contained in fusion/gene names.
                subquery = subquery.filter(
                    or_(
                        Fusion.fusion_name.ilike(f'%{search}%'),
                        Fusion.left_gene.ilike(f'%{search}%'),
                        Fusion.right_gene.ilike(f'%{search}%'),
                    )
                )
            else:
                subquery = subquery.filter(
                    or_(
                        Fusion.fusion_name.ilike(f'%{search}%'),
                        Fusion.left_gene.ilike(f'%{search}%'),
                        Fusion.right_gene.ilike(f'%{search}%')
                    )
                )
        
        if left_chr:
            subquery = subquery.filter(Fusion.left_breakpoint.ilike(f'{left_chr}:%'))
        if right_chr:
            subquery = subquery.filter(Fusion.right_breakpoint.ilike(f'{right_chr}:%'))
        
        if left_gene_filter:
            subquery = subquery.filter(
                or_(
                    Fusion.left_gene.ilike(f'{left_gene_filter}^%'),
                    Fusion.left_gene.ilike(left_gene_filter)
                )
            )
        if right_gene_filter:
            subquery = subquery.filter(
                or_(
                    Fusion.right_gene.ilike(f'{right_gene_filter}^%'),
                    Fusion.right_gene.ilike(right_gene_filter)
                )
            )
        
        subquery = subquery.group_by(Fusion.fusion_name).subquery()
        
        query = db.session.query(
            Fusion,
            subquery.c.total_fq,
            subquery.c.total_avg_ffpm,
            subquery.c.total_jrc,
            subquery.c.total_sfc,
            subquery.c.variant_count
        ).join(
            subquery,
            Fusion.id == subquery.c.min_id
        )
        
        if sort_by == 'fq':
            if sort_order == 'desc':
                query = query.order_by(subquery.c.total_fq.desc().nullslast())
            else:
                query = query.order_by(subquery.c.total_fq.asc().nullslast())
        else:
            if sort_order == 'desc':
                query = query.order_by(subquery.c.total_avg_ffpm.desc().nullslast())
            else:
                query = query.order_by(subquery.c.total_avg_ffpm.asc().nullslast())
        
        if limit and limit > 0:
            query = query.limit(limit)
        
        results = query.all()
        
        items = []
        for fusion, total_fq, total_avg_ffpm, total_jrc, total_sfc, vcount in results:
            item = serialize_fusion_full(fusion)
            item['fq'] = int(total_fq) if total_fq else 0
            item['avg_junction_read_count'] = float(total_jrc) if total_jrc else 0
            item['avg_spanning_frag_count'] = float(total_sfc) if total_sfc else 0
            item['variant_count'] = int(vcount) if vcount else 1
            items.append(item)
        
        return jsonify({
            'code': 200,
            'message': 'success',
            'data': {
                'items': items,
                'total': len(items),
                'search': search,
                'search_type': 'text',
                'exact_gene': exact_gene,
                'left_chr': left_chr,
                'right_chr': right_chr,
                'left_gene': left_gene_filter,
                'right_gene': right_gene_filter,
                'sort_by': sort_by,
                'sort_order': sort_order
            }
        }), 200
        
    except Exception as e:
        import traceback
        print(f"高级搜索错误: {str(e)}")
        print(traceback.format_exc())
        return jsonify({
            'code': 500,
            'message': f'高级搜索失败: {str(e)}'
        }), 500


@fusion_bp.route('/search/network', methods=['GET'])
@jwt_required(optional=True)
def network_search():
    """
    网络图专用搜索接口 - fq 求和版
    🔧 修改：支持 TP+编号 格式的ID搜索
    """
    try:
        search = request.args.get('search', '', type=str).strip()
        exact_gene = request.args.get('exact_gene', 'false', type=str).lower() == 'true'
        strict_match = request.args.get('strict_match', 'false', type=str).lower() == 'true'
        left_chr = request.args.get('left_chr', '', type=str).strip()
        right_chr = request.args.get('right_chr', '', type=str).strip()
        left_gene_filter = request.args.get('left_gene', '', type=str).strip()
        right_gene_filter = request.args.get('right_gene', '', type=str).strip()
        limit = request.args.get('limit', 3000, type=int)
        
        if not search and not left_chr and not right_chr and not left_gene_filter and not right_gene_filter:
            return jsonify({
                'code': 200,
                'message': 'success',
                'data': {'items': [], 'total': 0}
            }), 200
        
        # 🔧 修改：检查是否为TP前缀ID搜索
        if search and is_tp_prefixed_id(search):
            search_id = extract_id_from_tp_prefix(search)
            fusion = Fusion.query.get(search_id)
            
            if fusion:
                item = serialize_fusion_full(fusion)
                return jsonify({
                    'code': 200,
                    'message': 'success',
                    'data': {'items': [item], 'total': 1}
                }), 200
            else:
                return jsonify({
                    'code': 200,
                    'message': 'success',
                    'data': {'items': [], 'total': 0}
                }), 200
        
        subquery = db.session.query(
            Fusion.fusion_name,
            func.min(Fusion.id).label('min_id'),
            func.sum(func.coalesce(Fusion.fq, 0)).label('total_fq'),
            func.sum(func.coalesce(Fusion.avg_junction_read_count, 0)).label('total_jrc'),
            func.sum(func.coalesce(Fusion.avg_spanning_frag_count, 0)).label('total_sfc')
        )
        
        if search:
            is_fusion_name_search = '--' in search
            
            if is_fusion_name_search:
                subquery = subquery.filter(Fusion.fusion_name.ilike(search))
            elif strict_match:
                # 精准搜索：只匹配基因名精确等于搜索词
                subquery = subquery.filter(
                    or_(
                        Fusion.left_gene.ilike(f'{search}^%'),
                        Fusion.left_gene.ilike(search),
                        Fusion.right_gene.ilike(f'{search}^%'),
                        Fusion.right_gene.ilike(search),
                    )
                )
            elif exact_gene:
                # Keep network data aligned with table fuzzy search.
                subquery = subquery.filter(
                    or_(
                        Fusion.fusion_name.ilike(f'%{search}%'),
                        Fusion.left_gene.ilike(f'%{search}%'),
                        Fusion.right_gene.ilike(f'%{search}%'),
                    )
                )
            else:
                subquery = subquery.filter(
                    or_(
                        Fusion.fusion_name.ilike(f'%{search}%'),
                        Fusion.left_gene.ilike(f'%{search}%'),
                        Fusion.right_gene.ilike(f'%{search}%')
                    )
                )
        
        if left_chr:
            subquery = subquery.filter(Fusion.left_breakpoint.ilike(f'{left_chr}:%'))
        if right_chr:
            subquery = subquery.filter(Fusion.right_breakpoint.ilike(f'{right_chr}:%'))
        
        if left_gene_filter:
            subquery = subquery.filter(
                or_(
                    Fusion.left_gene.ilike(f'{left_gene_filter}^%'),
                    Fusion.left_gene.ilike(left_gene_filter)
                )
            )
        if right_gene_filter:
            subquery = subquery.filter(
                or_(
                    Fusion.right_gene.ilike(f'{right_gene_filter}^%'),
                    Fusion.right_gene.ilike(right_gene_filter)
                )
            )
        
        subquery = subquery.group_by(Fusion.fusion_name).subquery()
        
        query = db.session.query(
            Fusion,
            subquery.c.total_fq,
            subquery.c.total_jrc,
            subquery.c.total_sfc
        ).join(
            subquery,
            Fusion.id == subquery.c.min_id
        ).order_by(
            subquery.c.total_fq.desc().nullslast()
        ).limit(limit)
        
        results = query.all()
        
        items = []
        for fusion, total_fq, total_jrc, total_sfc in results:
            item = serialize_fusion_full(fusion)
            item['fq'] = int(total_fq) if total_fq else 0
            item['avg_junction_read_count'] = float(total_jrc) if total_jrc else 0
            item['avg_spanning_frag_count'] = float(total_sfc) if total_sfc else 0
            items.append(item)
        
        return jsonify({
            'code': 200,
            'message': 'success',
            'data': {'items': items, 'total': len(items)}
        }), 200
        
    except Exception as e:
        import traceback
        print(f"网络搜索错误: {str(e)}")
        print(traceback.format_exc())
        return jsonify({
            'code': 500,
            'message': f'网络搜索失败: {str(e)}'
        }), 500


@fusion_bp.route('/by-id/<int:fusion_id>', methods=['GET'])
@jwt_required(optional=True)
def get_fusion_by_id(fusion_id):
    """根据ID获取融合基因详情"""
    try:
        fusion = Fusion.query.get(fusion_id)
        
        if not fusion:
            return jsonify({
                'code': 404,
                'message': f'未找到ID为 {fusion_id} 的融合基因'
            }), 404
        
        return jsonify({
            'code': 200,
            'message': 'success',
            'data': serialize_fusion_full(fusion)
        }), 200
        
    except Exception as e:
        import traceback
        print(f"按ID获取融合基因错误: {str(e)}")
        print(traceback.format_exc())
        return jsonify({
            'code': 500,
            'message': f'获取融合基因失败: {str(e)}'
        }), 500


@fusion_bp.route('/sample-count', methods=['GET'])
@jwt_required(optional=True)
def get_sample_count():
    """获取去重后的样本数量"""
    try:
        unique_sample_count = db.session.query(
            func.count(func.distinct(Fusion.sample_name))
        ).scalar()
        
        return jsonify({
            'code': 200,
            'message': 'success',
            'data': {'sample_count': unique_sample_count or 0}
        }), 200
        
    except Exception as e:
        print(f"[ERROR] 获取样本数量失败: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'code': 500,
            'message': f'获取样本数量失败: {str(e)}'
        }), 500


@fusion_bp.route('/top-fusions', methods=['GET'])
@jwt_required(optional=True)
def get_top_fusions():
    """获取前100个按fq总和排序的融合基因（去重）"""
    try:
        subquery = db.session.query(
            Fusion.fusion_name,
            func.min(Fusion.id).label('min_id'),
            func.sum(func.coalesce(Fusion.fq, 0)).label('total_fq')
        ).group_by(Fusion.fusion_name).subquery()
        
        query = db.session.query(
            Fusion,
            subquery.c.total_fq
        ).join(
            subquery,
            Fusion.id == subquery.c.min_id
        ).order_by(
            subquery.c.total_fq.desc().nullslast()
        ).limit(100)
        
        results = query.all()
        
        items = []
        for f, total_fq in results:
            if f.fusion_name:
                items.append({
                    'id': f.id,
                    'fusion_name': f.fusion_name,
                    'left_gene': f.left_gene,
                    'left_breakpoint': f.left_breakpoint,
                    'right_gene': f.right_gene,
                    'right_breakpoint': f.right_breakpoint,
                    'annots': f.annots,
                    'left_cds_status': f.left_cds_status,
                    'right_cds_status': f.right_cds_status,
                    'fq': int(total_fq) if total_fq else 0,
                    'avg_ffpm': f.avg_ffpm
                })
        
        return jsonify({
            'code': 200,
            'message': 'success',
            'data': {'items': items, 'total': len(items)}
        }), 200
        
    except Exception as e:
        print(f"[ERROR] 获取Top融合基因失败: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'code': 500,
            'message': f'获取数据失败: {str(e)}'
        }), 500

@fusion_bp.route('/top-fusions-cached', methods=['GET'])
@jwt_required(optional=True)
def get_top_fusions_cached():
    """获取预缓存的 Top 100 融合基因（超快响应）"""
    global _top_fusions_cache
    
    try:
        if _top_fusions_cache is not None:
            return jsonify({
                'code': 200,
                'message': 'success (from cache)',
                'data': {
                    'items': _top_fusions_cache['items'],
                    'total': _top_fusions_cache['total']
                }
            }), 200
        
        print("[WARN] Top 100 缓存未命中，正在重新加载...")
        _load_top_fusions_cache()
        
        if _top_fusions_cache is not None:
            return jsonify({
                'code': 200,
                'message': 'success (cache reloaded)',
                'data': {
                    'items': _top_fusions_cache['items'],
                    'total': _top_fusions_cache['total']
                }
            }), 200
        
        return get_top_fusions()
        
    except Exception as e:
        print(f"[ERROR] 获取缓存Top融合基因失败: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'code': 500,
            'message': f'获取数据失败: {str(e)}'
        }), 500


@fusion_bp.route('/cache-status', methods=['GET'])
@jwt_required(optional=True)
def get_cache_status():
    """查看缓存状态（调试用）"""
    import time
    
    status = {
        'suggestion_cache': {
            'fusion_names_count': len(_fusion_name_cache) if _fusion_name_cache else 0,
            'genes_count': len(_gene_cache) if _gene_cache else 0,
            'loaded': _fusion_name_cache is not None
        },
        'top_fusions_cache': {
            'items_count': len(_top_fusions_cache['items']) if _top_fusions_cache else 0,
            'loaded': _top_fusions_cache is not None,
            'cached_at': _top_fusions_cache.get('cached_at') if _top_fusions_cache else None
        }
    }
    
    if _top_fusions_cache and _top_fusions_cache.get('cached_at'):
        age_seconds = time.time() - _top_fusions_cache['cached_at']
        status['top_fusions_cache']['age_minutes'] = round(age_seconds / 60, 1)
    
    return jsonify({'code': 200, 'message': 'success', 'data': status}), 200


@fusion_bp.route('/search-suggest', methods=['GET'])
@jwt_required(optional=True)
def search_suggest():
    """搜索建议 - 缓存版（毫秒级响应）"""
    try:
        query_str = request.args.get('q', '', type=str).strip()
        limit = request.args.get('limit', 10, type=int)
        
        if len(query_str) < 1:
            return jsonify({'code': 200, 'message': 'success', 'data': []}), 200
        
        _ensure_cache()
        
        if not _fusion_name_cache and not _gene_cache:
            return _search_suggest_fallback(query_str, limit)
        
        query_upper = query_str.upper()
        result = []
        
        import bisect
        
        if '--' in query_str:
            idx = bisect.bisect_left(_fusion_name_cache, (query_upper, ''))
            
            while idx < len(_fusion_name_cache) and len(result) < limit:
                upper_name, original_name = _fusion_name_cache[idx]
                if upper_name.startswith(query_upper):
                    result.append({'type': 'fusion', 'value': original_name})
                    idx += 1
                else:
                    break
            
            return jsonify({'code': 200, 'message': 'success', 'data': result}), 200
        
        idx = bisect.bisect_left(_gene_cache, (query_upper, ''))
        
        while idx < len(_gene_cache) and len(result) < limit:
            gene_name, full_value = _gene_cache[idx]
            if gene_name.startswith(query_upper):
                result.append({'type': 'gene', 'value': full_value})
                idx += 1
            else:
                break
        
        if len(result) < limit:
            remaining = limit - len(result)
            idx = bisect.bisect_left(_fusion_name_cache, (query_upper, ''))
            
            count = 0
            while idx < len(_fusion_name_cache) and count < remaining:
                upper_name, original_name = _fusion_name_cache[idx]
                if upper_name.startswith(query_upper):
                    result.append({'type': 'fusion', 'value': original_name})
                    idx += 1
                    count += 1
                else:
                    break
        
        return jsonify({'code': 200, 'message': 'success', 'data': result}), 200
        
    except Exception as e:
        print(f"[ERROR] 搜索建议失败: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'code': 500, 'message': f'搜索建议失败: {str(e)}'}), 500


def _search_suggest_fallback(query_str, limit):
    """数据库回退查询（当缓存不可用时）"""
    result = []
    
    left_genes = db.session.query(Fusion.left_gene).filter(
        Fusion.left_gene.ilike(f'{query_str}%')
    ).distinct().limit(limit).all()
    
    for g in left_genes:
        if g[0] and len(result) < limit:
            result.append({'type': 'gene', 'value': g[0]})
    
    if len(result) < limit:
        remaining = limit - len(result)
        fusion_names = db.session.query(Fusion.fusion_name).filter(
            Fusion.fusion_name.ilike(f'{query_str}%')
        ).distinct().limit(remaining).all()
        
        for f in fusion_names:
            if f[0] and len(result) < limit:
                result.append({'type': 'fusion', 'value': f[0]})
    
    return jsonify({'code': 200, 'message': 'success', 'data': result}), 200


@fusion_bp.route('/gene-suggest', methods=['GET'])
@jwt_required(optional=True)
def gene_suggest():
    """基因名称搜索建议 - 支持按左/右侧基因搜索"""
    try:
        query_str = request.args.get('q', '', type=str).strip()
        side = request.args.get('side', 'both', type=str).strip()
        limit = request.args.get('limit', 10, type=int)
        
        if len(query_str) < 1:
            return jsonify({'code': 200, 'message': 'success', 'data': []}), 200
        
        result = []
        
        if side in ['left', 'both']:
            left_genes = db.session.query(Fusion.left_gene).filter(
                Fusion.left_gene.ilike(f'{query_str}%')
            ).distinct().limit(limit).all()
            
            for g in left_genes:
                if g[0] and len(result) < limit:
                    result.append(g[0])
        
        if side in ['right', 'both'] and len(result) < limit:
            right_genes = db.session.query(Fusion.right_gene).filter(
                Fusion.right_gene.ilike(f'{query_str}%')
            ).distinct().limit(limit - len(result)).all()
            
            for g in right_genes:
                if g[0] and g[0] not in result and len(result) < limit:
                    result.append(g[0])
        
        return jsonify({'code': 200, 'message': 'success', 'data': result}), 200
        
    except Exception as e:
        print(f"[ERROR] 基因搜索建议失败: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'code': 500, 'message': f'基因搜索建议失败: {str(e)}'}), 500

# =====================================================================
# === 样本共现融合分析 API（供 UpSet 图使用）===
# =====================================================================

@fusion_bp.route('/co-occurrence', methods=['GET', 'POST'])
@jwt_required(optional=True)
def get_co_occurrence():
    """Return co-occurring fusions for a sample set, using a lazy sample index and request cache."""
    import traceback

    try:
        if request.method == 'POST':
            body = request.get_json(silent=True) or {}
            samples_param = body.get('samples', '').strip()
            current_fusion = body.get('current_fusion', '').strip()
        else:
            samples_param = request.args.get('samples', '', type=str).strip()
            current_fusion = request.args.get('current_fusion', '', type=str).strip()

        target_samples = {s.strip() for s in samples_param.split(',') if s.strip()}
        if not target_samples:
            return jsonify({'code': 400, 'message': 'samples parameter is required'}), 400

        cache_key = (tuple(sorted(target_samples)), current_fusion)
        cached = _co_cache_get(cache_key)
        if cached is not None:
            return jsonify(cached), 200

        index = _get_co_occurrence_sample_index()
        sample_fusions = {
            sid: set(index.get(sid, set()))
            for sid in target_samples
            if index.get(sid)
        }

        sample_fusions_serializable = {
            sid: sorted(fusions)
            for sid, fusions in sample_fusions.items()
        }

        fusion_sample_count = {}
        for fusions in sample_fusions.values():
            for fn in fusions:
                fusion_sample_count[fn] = fusion_sample_count.get(fn, 0) + 1

        payload = {
            'code': 200,
            'message': 'success',
            'data': {
                'sampleFusions': sample_fusions_serializable,
                'fusionSampleCount': fusion_sample_count,
                'totalSamples': len(sample_fusions_serializable),
                'currentFusion': current_fusion,
            },
        }
        _co_cache_set(cache_key, payload)
        return jsonify(payload), 200

    except Exception as e:
        print(f"[ERROR] co-occurrence query failed: {str(e)}")
        traceback.print_exc()
        return jsonify({'code': 500, 'message': f'co-occurrence analysis failed: {str(e)}'}), 500


def _load_suggestion_cache():
    """加载搜索建议缓存（启动时调用一次）"""
    global _fusion_name_cache, _gene_cache, _cache_timestamp
    import time
    
    print("[CACHE] 开始加载搜索建议缓存...")
    start = time.time()
    
    try:
        fusion_names = db.session.query(
            distinct(Fusion.fusion_name)
        ).filter(Fusion.fusion_name.isnot(None)).all()
        
        _fusion_name_cache = []
        fusion_set = set()
        for f in fusion_names:
            if f[0] and f[0] not in fusion_set:
                fusion_set.add(f[0])
                _fusion_name_cache.append((f[0].upper(), f[0]))
        
        _fusion_name_cache.sort(key=lambda x: x[0])
        
        left_genes = db.session.query(distinct(Fusion.left_gene)).filter(
            Fusion.left_gene.isnot(None)
        ).all()
        right_genes = db.session.query(distinct(Fusion.right_gene)).filter(
            Fusion.right_gene.isnot(None)
        ).all()
        
        gene_set = set()
        for g in left_genes:
            if g[0]:
                gene_name = g[0].split('^')[0].upper() if '^' in g[0] else g[0].upper()
                gene_set.add((gene_name, g[0]))
        for g in right_genes:
            if g[0]:
                gene_name = g[0].split('^')[0].upper() if '^' in g[0] else g[0].upper()
                gene_set.add((gene_name, g[0]))
        
        _gene_cache = sorted(list(gene_set), key=lambda x: x[0])
        _cache_timestamp = time.time()
        
        print(f"[CACHE] 加载完成: {len(_fusion_name_cache)} 个融合名, {len(_gene_cache)} 个基因, 耗时 {time.time()-start:.2f}s")
        
    except Exception as e:
        print(f"[CACHE ERROR] 加载缓存失败: {str(e)}")
        import traceback
        traceback.print_exc()
        _fusion_name_cache = []
        _gene_cache = []
        _cache_timestamp = time.time()

def _load_top_fusions_cache():
    """预加载 Top 100 融合基因缓存（启动时调用一次）"""
    global _top_fusions_cache
    import time
    
    print("[CACHE] 开始加载 Top 100 融合基因缓存...")
    start = time.time()
    
    try:
        subquery = db.session.query(
            Fusion.fusion_name,
            func.min(Fusion.id).label('min_id'),
            func.sum(func.coalesce(Fusion.fq, 0)).label('total_fq')
        ).group_by(Fusion.fusion_name).subquery()
        
        query = db.session.query(
            Fusion,
            subquery.c.total_fq
        ).join(
            subquery,
            Fusion.id == subquery.c.min_id
        ).order_by(
            subquery.c.total_fq.desc().nullslast()
        ).limit(100)
        
        results = query.all()
        
        items = []
        for f, total_fq in results:
            if f.fusion_name:
                items.append({
                    'id': f.id,
                    'fusion_name': f.fusion_name,
                    'left_gene': f.left_gene,
                    'left_breakpoint': f.left_breakpoint,
                    'right_gene': f.right_gene,
                    'right_breakpoint': f.right_breakpoint,
                    'annots': f.annots,
                    'left_cds_status': f.left_cds_status,
                    'right_cds_status': f.right_cds_status,
                    'fq': int(total_fq) if total_fq else 0,
                    'avg_ffpm': f.avg_ffpm
                })
        
        _top_fusions_cache = {
            'items': items,
            'total': len(items),
            'cached_at': time.time()
        }
        
        print(f"[CACHE] Top 100 融合基因缓存加载完成: {len(items)} 条记录, 耗时 {time.time()-start:.2f}s")
        
    except Exception as e:
        print(f"[CACHE ERROR] Top 100 缓存加载失败: {str(e)}")
        import traceback
        traceback.print_exc()
        _top_fusions_cache = None

def _ensure_cache():
    """确保缓存已加载"""
    global _fusion_name_cache, _gene_cache, _cache_timestamp
    import time
    
    if _fusion_name_cache is None or _cache_timestamp is None or (time.time() - _cache_timestamp > 3600):
        _load_suggestion_cache()
