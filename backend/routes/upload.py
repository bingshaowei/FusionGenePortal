from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required
from extensions import db
from models import Fusion
import pandas as pd
from io import StringIO

upload_bp = Blueprint('upload', __name__, url_prefix="/api/upload")

# ✅ 与 CSV 模板保持一致的列名（必须完全匹配）
EXPECTED_COLUMNS = [
    'fusion_name', 'junction_read_count', 'spanning_frag_count', 'est_j', 'est_s',
    'splice_type', 'left_gene', 'left_breakpoint', 'right_gene', 'right_breakpoint',
    'large_anchor_support', 'left_break_dinuc', 'left_break_entropy', 'right_break_dinuc', 'right_break_entropy',
    'annots', 'cds_left_id', 'cds_left_range', 'cds_right_id', 'cds_right_range',
    'prot_fusion_type', 'fusion_model', 'fusion_cds', 'fusion_transl',
    'pfam_left', 'pfam_right', 'all_count', 'sample_name',
    'result_function_left', 'result_exon_left', 'result_breakpoint_left',
    'result_function_right', 'result_exon_right', 'result_breakpoint_right',
    'new_fusion_name', 'transcript_left_range', 'transcript_right_range', 'transcript_length',
    'left_cds_status', 'right_cds_status', 'transcript_left_length', 'transcript_right_length',
    'alignment_length_awt', 'score_awt', 'alignment_length_bwt', 'score_bwt',
    'leftbreakpoint_left', 'leftbreakpoint_right', 'rightbreakpoint_left', 'rightbreakpoint_right'
]

@upload_bp.route('/', methods=['POST'])
@jwt_required()
def upload_fusion_file():
    if 'file' not in request.files:
        return jsonify({"success": False, "error": "未上传任何文件"}), 400

    file = request.files['file']
    if not file.filename.endswith('.csv'):
        return jsonify({"success": False, "error": "仅支持 CSV 格式"}), 400

    try:
        # 解码 CSV 内容
        content = file.read().decode('utf-8')
        df = pd.read_csv(StringIO(content))

        # 校验列名一致性
        if list(df.columns) != EXPECTED_COLUMNS:
            return jsonify({
                "success": False,
                "error": "CSV 文件格式错误，列名不匹配。请使用示例模板上传"
            }), 400

        # 将每一行转换为 Fusion 对象并批量写入数据库
        fusion_objs = []
        for _, row in df.iterrows():
            fusion = Fusion(**row.to_dict())
            fusion_objs.append(fusion)

        db.session.bulk_save_objects(fusion_objs)
        db.session.commit()
        return jsonify({"success": True, "message": f"已成功导入 {len(fusion_objs)} 条融合记录"})
    
    except Exception as e:
        print("❌ 文件上传失败:", e)
        db.session.rollback()
        return jsonify({"success": False, "error": "服务器内部错误"}), 500

