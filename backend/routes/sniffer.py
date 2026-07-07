# backend/routes/sniffer.py
# SNIFFER 融合基因检测 API 路由 - 支持 TSV 和 FASTQ 两种模式

from flask import Blueprint, jsonify, request, send_file
from flask_jwt_extended import jwt_required, get_jwt_identity
import os
import subprocess
import uuid
import threading
import time
import re
from datetime import datetime
from werkzeug.utils import secure_filename

sniffer_bp = Blueprint('sniffer', __name__)

# ==================== 配置 ====================
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'uploads', 'sniffer')
RESULT_FOLDER = os.path.join(BASE_DIR, 'results', 'sniffer')

# 🔧 配置路径
FASTA_PATH = '/mnt/c/Users/15850/Desktop/fusion-gene-portal/backend/data/GRCh38.primary_assembly.genome.fa'
DEFAULT_THREADS = 4

ALLOWED_EXTENSIONS = {'fastq', 'fq', 'gz'}
ALLOWED_TSV_EXTENSIONS = {'tsv', 'csv', 'txt'}

# 确保目录存在
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(RESULT_FOLDER, exist_ok=True)

# 任务状态存储 (生产环境建议用 Redis)
task_status = {}


def _reject_guest():
    """SNIFFER 页面必须真实登录；guest token 视为未登录。"""
    username = get_jwt_identity()
    if not username or username == 'guest':
        return jsonify({'code': 401, 'message': 'SNIFFER 需要登录'}), 401
    return None


# ==================== R 脚本模板 - FASTQ 模式 ====================
R_SCRIPT_TEMPLATE_FASTQ = '''#!/usr/bin/env Rscript
# ============================================================
# SNIFFER 融合基因检测脚本 - FASTQ 完整流程
# 任务ID: {task_id}
# 生成时间: {generated_at}
# ============================================================

TASK_ID <- "{task_id}"
FUSION_FILE_PATH <- "{fusion_file_path}"
OUTPUT_DIR <- "{output_dir}"
FASTA_PATH <- "{fasta_path}"
THREADS <- {threads}

message("=", strrep("=", 50))
message(">>> SNIFFER 任务启动 (FASTQ 模式)")
message(">>> 任务ID: ", TASK_ID)
message(">>> 输入路径: ", FUSION_FILE_PATH)
message(">>> 输出路径: ", OUTPUT_DIR)
message(">>> FASTA路径: ", FASTA_PATH)
message(">>> 启动时间: ", Sys.time())
message("=", strrep("=", 50))

setwd(OUTPUT_DIR)

message("\\n>>> 正在加载 FusionTools 包...")
library(FusionTools)
message(">>> FusionTools 加载成功！")

message(">>> 开始 SNIFFER 分析...")

result <- tryCatch({{
  SNIFFER(
    fusion.file.path = FUSION_FILE_PATH,
    provided.fusion.file = NULL,
    fasta.path = FASTA_PATH,
    prefix = paste0("SNIFFER_", TASK_ID),
    min.junction = 1,
    min.all.counts = 2,
    min.est_J = 1,
    min.est.counts = 2,
    est.counts.filter = TRUE,
    Seq.similarity.filter = TRUE,
    conda.env = "base",
    threads = THREADS,
    Seq.similarity.alpha = c(24, 15, 20.6),
    seq.similarity.result.step2 = NULL,
    GC.filter = FALSE,
    du.fusion.filter = TRUE,
    WT.exp.filter = FALSE,
    force.batch.filter = FALSE,
    LDAS.filter = TRUE,
    LDAS.filter.alpha = c(0.05, 25),
    protien.coding.fusion.filter = FALSE,
    filter.abnormal.ratio = FALSE,
    twin.detection = TRUE,
    filter.twin.fusion = FALSE,
    filter.approximation = FALSE,
    FFPM.cal = FALSE
  )
}}, error = function(e) {{
  message(">>> ❌ SNIFFER 运行出错: ", e$message)
  return(NULL)
}})

if (!is.null(result)) {{
  message("\\n>>> ✅ SNIFFER 分析完成！")
  message(">>> 检测到 ", nrow(result), " 条融合记录")
  message(">>> 独立融合基因: ", length(unique(result$X.FusionName)), " 个")
  
  result_file <- file.path(OUTPUT_DIR, "final_results.csv")
  write.csv(result, file = result_file, row.names = FALSE)
  message(">>> 结果已保存至: ", result_file)
  
  cat("\\n__SNIFFER_STATUS__:SUCCESS\\n")
  cat("__RESULT_FILE__:", result_file, "\\n")
  cat("__TOTAL_RECORDS__:", nrow(result), "\\n")
  cat("__UNIQUE_FUSIONS__:", length(unique(result$X.FusionName)), "\\n")
  
  genes <- unique(c(
    sapply(strsplit(as.character(result$X.FusionName), "--"), `[`, 1),
    sapply(strsplit(as.character(result$X.FusionName), "--"), `[`, 2)
  ))
  cat("__GENES_COUNT__:", length(genes), "\\n")
  
  if ("LeftBreakpoint" %in% colnames(result)) {{
    chroms <- unique(sapply(strsplit(as.character(result$LeftBreakpoint), ":"), `[`, 1))
    cat("__CHROMOSOMES__:", length(chroms), "\\n")
  }}
  
  top_fusions <- head(unique(result$X.FusionName), 20)
  cat("__FUSION_LIST__:", paste(top_fusions, collapse=","), "\\n")
  
}} else {{
  message("\\n>>> ❌ SNIFFER 分析失败！")
  cat("\\n__SNIFFER_STATUS__:FAILED\\n")
}}

message("\\n>>> 结束时间: ", Sys.time())
message("=", strrep("=", 50))
'''


# ==================== R 脚本模板 - TSV 模式 (融合相似性筛选) ====================
R_SCRIPT_TEMPLATE_TSV = '''#!/usr/bin/env Rscript
# ============================================================
# SNIFFER 融合基因检测脚本 - TSV 相似性筛选模式
# 任务ID: {task_id}
# 生成时间: {generated_at}
# ============================================================

TASK_ID <- "{task_id}"
FUSION_FILE <- "{fusion_file}"
OUTPUT_DIR <- "{output_dir}"
FASTA_PATH <- "{fasta_path}"
THREADS <- {threads}

message("=", strrep("=", 50))
message(">>> SNIFFER 任务启动 (TSV 相似性筛选模式)")
message(">>> 任务ID: ", TASK_ID)
message(">>> 输入文件: ", FUSION_FILE)
message(">>> 输出路径: ", OUTPUT_DIR)
message(">>> FASTA路径: ", FASTA_PATH)
message(">>> 启动时间: ", Sys.time())
message("=", strrep("=", 50))

setwd(OUTPUT_DIR)

message("\\n>>> 正在加载 FusionTools 包...")
library(FusionTools)
message(">>> FusionTools 加载成功！")

# 读取用户提供的融合文件
message(">>> 正在读取融合结果文件...")
fusion_data <- tryCatch({{
  # 尝试读取 TSV/CSV 文件
  if (grepl("\\.csv$", FUSION_FILE, ignore.case = TRUE)) {{
    read.csv(FUSION_FILE, stringsAsFactors = FALSE)
  }} else {{
    read.delim(FUSION_FILE, stringsAsFactors = FALSE)
  }}
}}, error = function(e) {{
  message(">>> ❌ 读取文件失败: ", e$message)
  return(NULL)
}})

if (is.null(fusion_data) || nrow(fusion_data) == 0) {{
  message(">>> ❌ 融合文件为空或读取失败！")
  cat("\\n__SNIFFER_STATUS__:FAILED\\n")
  quit(status = 1)
}}

message(">>> 读取到 ", nrow(fusion_data), " 条融合记录")

# 执行 SNIFFER 分析（提供已有的融合文件）
message(">>> 开始 SNIFFER 相似性筛选分析...")

result <- tryCatch({{
  SNIFFER(
    fusion.file.path = NULL,
    provided.fusion.file = fusion_data,
    fasta.path = FASTA_PATH,
    prefix = paste0("SNIFFER_TSV_", TASK_ID),
    min.junction = 1,
    min.all.counts = 2,
    min.est_J = 1,
    min.est.counts = 2,
    est.counts.filter = TRUE,
    Seq.similarity.filter = TRUE,
    conda.env = "base",
    threads = THREADS,
    Seq.similarity.alpha = c(24, 15, 20.6),
    seq.similarity.result.step2 = NULL,
    GC.filter = FALSE,
    du.fusion.filter = TRUE,
    WT.exp.filter = FALSE,
    force.batch.filter = FALSE,
    LDAS.filter = TRUE,
    LDAS.filter.alpha = c(0.05, 25),
    protien.coding.fusion.filter = FALSE,
    filter.abnormal.ratio = FALSE,
    twin.detection = TRUE,
    filter.twin.fusion = FALSE,
    filter.approximation = FALSE,
    FFPM.cal = FALSE
  )
}}, error = function(e) {{
  message(">>> ❌ SNIFFER 运行出错: ", e$message)
  return(NULL)
}})

if (!is.null(result)) {{
  message("\\n>>> ✅ SNIFFER 相似性筛选完成！")
  message(">>> 筛选后保留 ", nrow(result), " 条融合记录")
  message(">>> 独立融合基因: ", length(unique(result$X.FusionName)), " 个")
  
  result_file <- file.path(OUTPUT_DIR, "filtered_results.csv")
  write.csv(result, file = result_file, row.names = FALSE)
  message(">>> 结果已保存至: ", result_file)
  
  cat("\\n__SNIFFER_STATUS__:SUCCESS\\n")
  cat("__RESULT_FILE__:", result_file, "\\n")
  cat("__TOTAL_RECORDS__:", nrow(result), "\\n")
  cat("__UNIQUE_FUSIONS__:", length(unique(result$X.FusionName)), "\\n")
  
  genes <- unique(c(
    sapply(strsplit(as.character(result$X.FusionName), "--"), `[`, 1),
    sapply(strsplit(as.character(result$X.FusionName), "--"), `[`, 2)
  ))
  cat("__GENES_COUNT__:", length(genes), "\\n")
  
  if ("LeftBreakpoint" %in% colnames(result)) {{
    chroms <- unique(sapply(strsplit(as.character(result$LeftBreakpoint), ":"), `[`, 1))
    cat("__CHROMOSOMES__:", length(chroms), "\\n")
  }}
  
  top_fusions <- head(unique(result$X.FusionName), 20)
  cat("__FUSION_LIST__:", paste(top_fusions, collapse=","), "\\n")
  
  # 计算并输出筛选统计
  original_count <- nrow(fusion_data)
  filtered_count <- nrow(result)
  removed_count <- original_count - filtered_count
  cat("__ORIGINAL_COUNT__:", original_count, "\\n")
  cat("__REMOVED_COUNT__:", removed_count, "\\n")
  
}} else {{
  message("\\n>>> ❌ SNIFFER 分析失败！")
  cat("\\n__SNIFFER_STATUS__:FAILED\\n")
}}

message("\\n>>> 结束时间: ", Sys.time())
message("=", strrep("=", 50))
'''


# ==================== 辅助函数 ====================
def allowed_file(filename):
    """检查文件扩展名是否允许 (FASTQ)"""
    lower_name = filename.lower()
    if lower_name.endswith('.gz'):
        lower_name = lower_name[:-3]
    return '.' in lower_name and lower_name.rsplit('.', 1)[1] in ALLOWED_EXTENSIONS


def allowed_tsv_file(filename):
    """检查文件扩展名是否允许 (TSV/CSV)"""
    lower_name = filename.lower()
    return '.' in lower_name and lower_name.rsplit('.', 1)[1] in ALLOWED_TSV_EXTENSIONS


def validate_fastq_pair(file1_name, file2_name):
    """验证是否为配对的 FASTQ 文件"""
    patterns = [
        ('_1.', '_2.'), ('_R1.', '_R2.'), ('_R1_', '_R2_'), ('.1.', '.2.'),
        ('_1_', '_2_'), ('_R1', '_R2'), ('_1.fq', '_2.fq'), ('_1.fastq', '_2.fastq')
    ]
    
    for p1, p2 in patterns:
        if (p1 in file1_name and p2 in file2_name) or \
           (p2 in file1_name and p1 in file2_name):
            return True
    
    return ('1' in file1_name and '2' in file2_name) or \
           ('2' in file1_name and '1' in file2_name)


def parse_r_output(stdout):
    """解析 R 脚本输出，提取结果信息"""
    result = {
        'status': 'FAILED',
        'result_file': None,
        'total': 0,
        'unique_fusions': 0,
        'genes': 0,
        'chromosomes': 0,
        'fusion_list': [],
        'original_count': 0,
        'removed_count': 0
    }
    
    output = stdout.decode('utf-8') if isinstance(stdout, bytes) else stdout
    
    status_match = re.search(r'__SNIFFER_STATUS__:(\w+)', output)
    if status_match:
        result['status'] = status_match.group(1)
    
    file_match = re.search(r'__RESULT_FILE__:\s*(.+)', output)
    if file_match:
        result['result_file'] = file_match.group(1).strip()
    
    total_match = re.search(r'__TOTAL_RECORDS__:\s*(\d+)', output)
    if total_match:
        result['total'] = int(total_match.group(1))
    
    unique_match = re.search(r'__UNIQUE_FUSIONS__:\s*(\d+)', output)
    if unique_match:
        result['unique_fusions'] = int(unique_match.group(1))
    
    genes_match = re.search(r'__GENES_COUNT__:\s*(\d+)', output)
    if genes_match:
        result['genes'] = int(genes_match.group(1))
    
    chrom_match = re.search(r'__CHROMOSOMES__:\s*(\d+)', output)
    if chrom_match:
        result['chromosomes'] = int(chrom_match.group(1))
    
    list_match = re.search(r'__FUSION_LIST__:\s*(.+)', output)
    if list_match:
        fusion_str = list_match.group(1).strip()
        if fusion_str:
            result['fusion_list'] = [f.strip() for f in fusion_str.split(',') if f.strip()]
    
    # TSV 模式特有的统计
    original_match = re.search(r'__ORIGINAL_COUNT__:\s*(\d+)', output)
    if original_match:
        result['original_count'] = int(original_match.group(1))
    
    removed_match = re.search(r'__REMOVED_COUNT__:\s*(\d+)', output)
    if removed_match:
        result['removed_count'] = int(removed_match.group(1))
    
    return result


def run_sniffer_task(task_id, upload_dir, output_dir, mode='fastq', fusion_file=None):
    """执行 SNIFFER 分析任务"""
    try:
        task_status[task_id]['status'] = 'running'
        task_status[task_id]['progress'] = 5
        task_status[task_id]['message'] = '正在准备分析环境...'
        
        # 根据模式选择不同的 R 脚本
        if mode == 'tsv':
            r_script = R_SCRIPT_TEMPLATE_TSV.format(
                task_id=task_id,
                generated_at=datetime.now().isoformat(),
                fusion_file=fusion_file,
                output_dir=output_dir,
                fasta_path=FASTA_PATH,
                threads=DEFAULT_THREADS
            )
        else:
            r_script = R_SCRIPT_TEMPLATE_FASTQ.format(
                task_id=task_id,
                generated_at=datetime.now().isoformat(),
                fusion_file_path=upload_dir,
                output_dir=output_dir,
                fasta_path=FASTA_PATH,
                threads=DEFAULT_THREADS
            )
        
        r_script_path = os.path.join(output_dir, 'sniffer_script.R')
        with open(r_script_path, 'w', encoding='utf-8') as f:
            f.write(r_script)
        
        task_status[task_id]['progress'] = 10
        task_status[task_id]['message'] = '正在启动 R 环境...'
        
        # 执行 R 脚本
        process = subprocess.Popen(
            ['Rscript', '--vanilla', r_script_path],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=output_dir
        )
        
        # 进度更新
        if mode == 'tsv':
            progress_stages = [
                (15, '正在加载 FusionTools 包...'),
                (25, '正在读取融合结果文件...'),
                (40, '正在进行外显子注释...'),
                (55, '正在进行序列相似性筛选...'),
                (70, '正在进行重复融合过滤...'),
                (85, '正在进行 LDAS 过滤...'),
                (90, '正在生成筛选结果...'),
            ]
        else:
            progress_stages = [
                (15, '正在加载 FusionTools 包...'),
                (25, '正在合并融合基因文件...'),
                (35, '正在进行外显子注释...'),
                (45, '正在进行转录本长度注释...'),
                (55, '正在进行 EST 计数过滤...'),
                (65, '正在进行序列相似性过滤...'),
                (75, '正在进行重复融合过滤...'),
                (85, '正在进行 LDAS 过滤...'),
                (90, '正在生成最终结果...'),
            ]
        
        stage_index = 0
        while process.poll() is None:
            time.sleep(3)
            if stage_index < len(progress_stages):
                progress, message = progress_stages[stage_index]
                task_status[task_id]['progress'] = progress
                task_status[task_id]['message'] = message
                stage_index += 1
        
        stdout, stderr = process.communicate()
        
        # 保存日志
        log_file = os.path.join(output_dir, 'sniffer.log')
        with open(log_file, 'w', encoding='utf-8') as f:
            f.write("=== STDOUT ===\n")
            f.write(stdout.decode('utf-8', errors='ignore'))
            f.write("\n\n=== STDERR ===\n")
            f.write(stderr.decode('utf-8', errors='ignore'))
        
        # 解析结果
        parsed_result = parse_r_output(stdout)
        
        if parsed_result['status'] == 'SUCCESS':
            task_status[task_id]['status'] = 'completed'
            task_status[task_id]['progress'] = 100
            task_status[task_id]['message'] = '分析完成！'
            
            result_data = {
                'total': parsed_result['total'],
                'unique_fusions': parsed_result['unique_fusions'],
                'genes': parsed_result['genes'],
                'chromosomes': parsed_result['chromosomes'],
                'fusion_list': parsed_result['fusion_list'],
                'result_file': parsed_result['result_file'] or os.path.join(output_dir, 'filtered_results.csv' if mode == 'tsv' else 'final_results.csv'),
                'mode': mode
            }
            
            # TSV 模式额外统计
            if mode == 'tsv':
                result_data['original_count'] = parsed_result['original_count']
                result_data['removed_count'] = parsed_result['removed_count']
            
            task_status[task_id]['result'] = result_data
        else:
            error_msg = stderr.decode('utf-8', errors='ignore')[:500] if stderr else '未知错误'
            task_status[task_id]['status'] = 'failed'
            task_status[task_id]['message'] = f'分析失败: {error_msg}'
            task_status[task_id]['progress'] = 0
            
    except Exception as e:
        task_status[task_id]['status'] = 'failed'
        task_status[task_id]['message'] = f'任务执行异常: {str(e)}'
        task_status[task_id]['progress'] = 0


# ==================== API 路由 ====================

@sniffer_bp.route('/upload', methods=['POST'])
@jwt_required()
def upload_fastq():
    """上传 FASTQ 文件并启动 SNIFFER 分析"""
    rejected = _reject_guest()
    if rejected:
        return rejected
    username = get_jwt_identity()
    
    if 'file1' not in request.files or 'file2' not in request.files:
        return jsonify({
            'success': False,
            'message': '请上传两个 FASTQ 文件 (file1 和 file2)'
        }), 400
    
    file1 = request.files['file1']
    file2 = request.files['file2']
    
    if file1.filename == '' or file2.filename == '':
        return jsonify({
            'success': False,
            'message': '文件名不能为空'
        }), 400
    
    if not allowed_file(file1.filename) or not allowed_file(file2.filename):
        return jsonify({
            'success': False,
            'message': '只支持 .fastq, .fq, .fastq.gz, .fq.gz 格式的文件'
        }), 400
    
    if not validate_fastq_pair(file1.filename, file2.filename):
        return jsonify({
            'success': False,
            'message': '请确保上传的是配对的 FASTQ 文件 (如 sample_1.fastq 和 sample_2.fastq)'
        }), 400
    
    # 生成任务ID
    task_id = f"{username}_{datetime.now().strftime('%Y%m%d%H%M%S')}_{uuid.uuid4().hex[:8]}"
    
    # 创建目录
    upload_dir = os.path.join(UPLOAD_FOLDER, task_id)
    output_dir = os.path.join(RESULT_FOLDER, task_id)
    os.makedirs(upload_dir, exist_ok=True)
    os.makedirs(output_dir, exist_ok=True)
    
    # 保存文件
    file1_path = os.path.join(upload_dir, secure_filename(file1.filename))
    file2_path = os.path.join(upload_dir, secure_filename(file2.filename))
    file1.save(file1_path)
    file2.save(file2_path)
    
    # 初始化任务状态
    task_status[task_id] = {
        'task_id': task_id,
        'status': 'pending',
        'progress': 0,
        'message': '任务已创建，等待启动...',
        'created_at': datetime.now().isoformat(),
        'username': username,
        'files': [file1.filename, file2.filename],
        'upload_dir': upload_dir,
        'output_dir': output_dir,
        'mode': 'fastq',
        'result': None
    }
    
    # 启动后台任务
    thread = threading.Thread(
        target=run_sniffer_task,
        args=(task_id, upload_dir, output_dir, 'fastq', None)
    )
    thread.daemon = True
    thread.start()
    
    return jsonify({
        'success': True,
        'task_id': task_id,
        'message': 'SNIFFER 分析任务已启动 (FASTQ 模式)'
    })


@sniffer_bp.route('/upload-tsv', methods=['POST'])
@jwt_required()
def upload_tsv():
    """上传 TSV 融合结果文件并启动 SNIFFER 相似性筛选"""
    rejected = _reject_guest()
    if rejected:
        return rejected
    username = get_jwt_identity()
    
    if 'fusion_file' not in request.files:
        return jsonify({
            'success': False,
            'message': '请上传融合结果文件 (fusion_file)'
        }), 400
    
    fusion_file = request.files['fusion_file']
    
    if fusion_file.filename == '':
        return jsonify({
            'success': False,
            'message': '文件名不能为空'
        }), 400
    
    if not allowed_tsv_file(fusion_file.filename):
        return jsonify({
            'success': False,
            'message': '只支持 .tsv, .csv, .txt 格式的文件'
        }), 400
    
    # 生成任务ID
    task_id = f"tsv_{username}_{datetime.now().strftime('%Y%m%d%H%M%S')}_{uuid.uuid4().hex[:8]}"
    
    # 创建目录
    upload_dir = os.path.join(UPLOAD_FOLDER, task_id)
    output_dir = os.path.join(RESULT_FOLDER, task_id)
    os.makedirs(upload_dir, exist_ok=True)
    os.makedirs(output_dir, exist_ok=True)
    
    # 保存文件
    fusion_file_path = os.path.join(upload_dir, secure_filename(fusion_file.filename))
    fusion_file.save(fusion_file_path)
    
    # 初始化任务状态
    task_status[task_id] = {
        'task_id': task_id,
        'status': 'pending',
        'progress': 0,
        'message': '任务已创建，等待启动...',
        'created_at': datetime.now().isoformat(),
        'username': username,
        'files': [fusion_file.filename],
        'upload_dir': upload_dir,
        'output_dir': output_dir,
        'mode': 'tsv',
        'result': None
    }
    
    # 启动后台任务
    thread = threading.Thread(
        target=run_sniffer_task,
        args=(task_id, upload_dir, output_dir, 'tsv', fusion_file_path)
    )
    thread.daemon = True
    thread.start()
    
    return jsonify({
        'success': True,
        'task_id': task_id,
        'message': 'SNIFFER 相似性筛选任务已启动 (TSV 模式)'
    })


@sniffer_bp.route('/status/<task_id>', methods=['GET'])
@jwt_required()
def get_task_status(task_id):
    """查询任务状态"""
    rejected = _reject_guest()
    if rejected:
        return rejected
    username = get_jwt_identity()
    
    if task_id not in task_status:
        return jsonify({'success': False, 'message': '任务不存在'}), 404
    
    task = task_status[task_id]
    
    if task['username'] != username:
        return jsonify({'success': False, 'message': '无权访问此任务'}), 403
    
    return jsonify({
        'success': True,
        'data': {
            'task_id': task['task_id'],
            'status': task['status'],
            'progress': task['progress'],
            'message': task['message'],
            'result': task.get('result'),
            'files': task.get('files', []),
            'mode': task.get('mode', 'fastq')
        }
    })


@sniffer_bp.route('/download/<task_id>', methods=['GET'])
@jwt_required()
def download_result(task_id):
    """下载分析结果文件"""
    rejected = _reject_guest()
    if rejected:
        return rejected
    username = get_jwt_identity()
    
    if task_id not in task_status:
        return jsonify({'success': False, 'message': '任务不存在'}), 404
    
    task = task_status[task_id]
    
    if task['username'] != username:
        return jsonify({'success': False, 'message': '无权访问此任务'}), 403
    
    if task['status'] != 'completed':
        return jsonify({'success': False, 'message': '任务尚未完成'}), 400
    
    result_file = task.get('result', {}).get('result_file')
    if not result_file or not os.path.exists(result_file):
        # 尝试默认路径
        mode = task.get('mode', 'fastq')
        default_filename = 'filtered_results.csv' if mode == 'tsv' else 'final_results.csv'
        result_file = os.path.join(task['output_dir'], default_filename)
        if not os.path.exists(result_file):
            return jsonify({'success': False, 'message': '结果文件不存在'}), 404
    
    mode = task.get('mode', 'fastq')
    download_name = f'SNIFFER_{"filtered" if mode == "tsv" else "result"}_{task_id}.csv'
    
    return send_file(
        result_file,
        as_attachment=True,
        download_name=download_name
    )


@sniffer_bp.route('/history', methods=['GET'])
@jwt_required()
def get_history():
    """获取用户的历史任务列表"""
    rejected = _reject_guest()
    if rejected:
        return rejected
    username = get_jwt_identity()
    
    user_tasks = [
        {
            'task_id': task['task_id'],
            'status': task['status'],
            'progress': task['progress'],
            'created_at': task['created_at'],
            'files': task.get('files', []),
            'mode': task.get('mode', 'fastq'),
            'result': task.get('result') if task['status'] == 'completed' else None
        }
        for task in task_status.values()
        if task['username'] == username
    ]
    
    user_tasks.sort(key=lambda x: x['created_at'], reverse=True)
    
    return jsonify({
        'success': True,
        'data': user_tasks[:10]
    })


@sniffer_bp.route('/config', methods=['GET'])
@jwt_required()
def get_config():
    """获取当前配置信息（调试用）"""
    rejected = _reject_guest()
    if rejected:
        return rejected
    return jsonify({
        'success': True,
        'config': {
            'upload_folder': UPLOAD_FOLDER,
            'result_folder': RESULT_FOLDER,
            'fasta_path': FASTA_PATH,
            'threads': DEFAULT_THREADS,
            'gtf_note': '使用 FusionTools 包内置的 GDC GTF 数据',
            'supported_modes': ['fastq', 'tsv']
        }
    })