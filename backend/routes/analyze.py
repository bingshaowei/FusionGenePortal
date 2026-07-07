from flask import Blueprint, request, jsonify
import pandas as pd
from io import StringIO

analyze_bp = Blueprint('analyze', __name__, url_prefix="/api/analyze")

# ✅ 与模板完全一致的列名要求
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

@analyze_bp.route('/', methods=['POST'])
def analyze_csv():
    if 'file' not in request.files:
        return jsonify({"error": "未上传文件"}), 400

    file = request.files['file']
    if not file.filename.endswith('.csv'):
        return jsonify({"error": "仅支持 CSV 格式"}), 400

    try:
        stream = StringIO(file.read().decode("utf-8"))
        df = pd.read_csv(stream)

        # ✅ 校验列名与模板一致
        if list(df.columns) != EXPECTED_COLUMNS:
            return jsonify({"error": "文件列名不符合要求，请参考示例模板"}), 400

        results = df.to_dict(orient='records')  # 每行转为字典
        return jsonify({"fusions": results})
    
    except Exception as e:
        print("分析失败：", e)
        return jsonify({"error": "分析失败"}), 500

