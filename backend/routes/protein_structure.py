# backend/routes/protein_structure.py
# 蛋白质结构预测 API - ESMFold 代理 + 已有 PDB 缓存读取（已停用本地 ColabFold 计算）
#
# 运行逻辑：
#   1. 网站后端在 base 环境运行 Flask。
#   2. 预测时支持两种调用方式（通过 COLABFOLD_USE_CONDA 切换）：
#        COLABFOLD_USE_CONDA=false（默认）：直接调用 COLABFOLD_BIN，适合 localcolabfold 安装方式。
#        COLABFOLD_USE_CONDA=true          ：通过 conda run -n <env> 调用，适合独立 conda 环境。
#   3. 预测任务后台执行：/predict-start 启动，/predict-status 轮询，避免长连接 504。
#   4. PDB 保存到三类缓存目录：
#        普通 FusionDetail:        backend/pdb_cache/cache/T编号.pdb
#        FusionDeletedDetail:      backend/pdb_cache/deleted_cache/TF编号.pdb
#        CellLineFusionDetail:     backend/pdb_cache/cellfusion_cache/融合名_变体编号.pdb
#   5. ColabFold 原始输出保存在 backend/pdb_cache/colabfold_jobs/source/文件名去后缀/ 方便排错。

import copy
import glob
import os
import re
import shutil
import subprocess
import time
import uuid
import threading
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote

from flask import Blueprint, jsonify, request, send_file
from flask_jwt_extended import jwt_required

protein_structure_bp = Blueprint('protein_structure', __name__)

# ==================== 基础配置 ====================
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDB_BASE_DIR = os.path.join(BASE_DIR, 'pdb_cache')

PDB_DIRS = {
    'cache':      os.path.join(PDB_BASE_DIR, 'cache'),
    'deleted':    os.path.join(PDB_BASE_DIR, 'deleted_cache'),
    'cellfusion': os.path.join(PDB_BASE_DIR, 'cellfusion_cache'),
}
COLABFOLD_JOB_BASE_DIR = os.environ.get(
    'COLABFOLD_JOB_BASE_DIR',
    os.path.join(PDB_BASE_DIR, 'colabfold_jobs'),
)

for _name, _path in PDB_DIRS.items():
    os.makedirs(_path, exist_ok=True)
    print(f'[Protein Structure] PDB缓存目录({_name}): {_path}')
os.makedirs(COLABFOLD_JOB_BASE_DIR, exist_ok=True)
print(f'[Protein Structure] ColabFold任务目录已保留但不再启动计算: {COLABFOLD_JOB_BASE_DIR}')

# ==================== ColabFold / AlphaFold2 配置 ====================

# ---- 调用方式 ----
# False（默认）：直接调用 COLABFOLD_BIN，适合 localcolabfold
#               （~/localcolabfold 安装后 colabfold_batch 已在 PATH 里）
# True          ：通过 conda run -n COLABFOLD_ENV 调用，适合独立 conda 环境
COLABFOLD_USE_CONDA = os.environ.get('COLABFOLD_USE_CONDA', 'false').lower() == 'true'

# conda 模式下使用的参数
CONDA_EXE     = os.environ.get('CONDA_EXE',     '/home/fenhuazu/miniconda3/bin/conda')
COLABFOLD_ENV = os.environ.get('COLABFOLD_ENV', 'colabfold310')

# localcolabfold 模式下的可执行文件路径。
# 若 colabfold_batch 已在 PATH 里，填 'colabfold_batch' 即可；
# 也可写绝对路径，例如：
#   /home/fenhuazu/localcolabfold/colabfold-conda/bin/colabfold_batch
COLABFOLD_BIN = os.environ.get(
    'COLABFOLD_BIN',
    '/home/fenhuazu/localcolabfold/.pixi/envs/default/bin/colabfold_batch'
)

# ---- 预测参数 ----
# single_sequence：完全本地，不依赖远程 MSA 服务，推荐网站使用。
COLABFOLD_MSA_MODE      = os.environ.get('COLABFOLD_MSA_MODE',      'single_sequence')
COLABFOLD_NUM_RECYCLE   = os.environ.get('COLABFOLD_NUM_RECYCLE',   '1')
COLABFOLD_NUM_MODELS    = os.environ.get('COLABFOLD_NUM_MODELS',    '1')
# 通过环境变量追加额外参数，例如：export COLABFOLD_EXTRA_ARGS="--amber --use-gpu-relax"
COLABFOLD_EXTRA_ARGS    = os.environ.get('COLABFOLD_EXTRA_ARGS',    '').strip()
COLABFOLD_TIMEOUT_SECONDS = int(os.environ.get('COLABFOLD_TIMEOUT_SECONDS', str(3 * 60 * 60)))

# ---- GPU 显存参数（传递给 colabfold_batch 子进程）----
# 与手动运行时 export 的变量保持一致，避免 Flask 父进程的污染环境影响 ColabFold。
XLA_PREALLOCATE    = os.environ.get('COLABFOLD_XLA_PREALLOCATE',    'false')
XLA_MEM_FRACTION   = os.environ.get('COLABFOLD_XLA_MEM_FRACTION',   '0.70')
# 需要从子进程环境中移除的变量（会与 localcolabfold 内置 CUDA 库冲突）
_COLABFOLD_ENV_UNSET = ['TF_FORCE_UNIFIED_MEMORY', 'XLA_PYTHON_CLIENT_ALLOCATOR', 'LD_LIBRARY_PATH']

# ---- 并发配置 ----
# fusion protein 预测长度可以放宽；但序列越长，本地 ColabFold 会明显变慢。
MAX_SEQUENCE_LENGTH = int(os.environ.get('COLABFOLD_MAX_SEQUENCE_LENGTH', '2000'))
# 单 GPU 服务器建议 1；多 GPU 可酌情调高。
MAX_WORKERS = int(os.environ.get('COLABFOLD_MAX_WORKERS', '1'))

# 本版本显式停用本地 ColabFold / AlphaFold2 计算，避免网站预测时卡住。
COLABFOLD_ENABLED = False

# ---- 打印当前调用模式，方便启动时确认 ----
print('[Protein Structure] 本地 ColabFold / AlphaFold2 计算已停用；仅保留 ESMFold 代理和已有 PDB 缓存读取。')

# 后台任务状态，适合当前 Flask 单进程/少量任务场景；生产大并发可以替换为 Redis/Celery。
EXECUTOR       = ThreadPoolExecutor(max_workers=MAX_WORKERS)
JOBS           = {}
RUNNING_BY_KEY = {}
JOB_LOCK       = threading.Lock()
JOB_TTL_SECONDS = 12 * 60 * 60

# 有效氨基酸
VALID_AA = set('ACDEFGHIKLMNPQRSTVWY')


# ==================== 工具函数 ====================
def clean_sequence(seq):
    if not seq:
        return ''
    return ''.join(c for c in str(seq).upper() if c in VALID_AA)


def _safe_variant_id(vid):
    """
    把 variant_id 转为文件名安全的形式，防止路径穿越。
    允许字母、数字、下划线和中横线；其它字符统一替换为下划线。
    """
    return re.sub(r'[^A-Za-z0-9_-]', '_', str(vid or '').strip())


def _normalize_source(source, variant_id=None):
    """
    统一缓存来源：cache / deleted / cellfusion。
    如果前端未传 source，则根据 ID 自动推断：
      TF2029              -> deleted
      928 或 T928         -> cache
      RUNX1--RUNX1_1      -> cellfusion
    """
    raw = (source or '').strip().lower()
    alias_map = {
        '':               '',
        'default':        'cache',
        'normal':         'cache',
        'fusion':         'cache',
        'pdb':            'cache',
        'cache':          'cache',
        'deleted':        'deleted',
        'deleted_cache':  'deleted',
        'fusion_deleted': 'deleted',
        'cell':           'cellfusion',
        'cellline':       'cellfusion',
        'cell_line':      'cellfusion',
        'cellfusion':     'cellfusion',
        'cellfusion_cache': 'cellfusion',
    }
    mapped = alias_map.get(raw)
    if mapped:
        return mapped

    vid = str(variant_id or '').strip()
    if re.match(r'^TF\d+$', vid, flags=re.IGNORECASE):
        return 'deleted'
    if re.match(r'^T?\d+$', vid, flags=re.IGNORECASE):
        return 'cache'
    return 'cellfusion'


def _get_source_from_request(default_variant_id=None):
    data = request.get_json(silent=True) or {}
    return _normalize_source(
        request.args.get('source') or data.get('source') or data.get('cacheSource'),
        default_variant_id,
    )


def _filename_for_variant(variant_id, source=None):
    """
    根据页面类型决定文件名：
      source=cache:      123/T123 -> T123.pdb
      source=deleted:    2029/TF2029 -> TF2029.pdb
      source=cellfusion: RUNX1--RUNX1_1 -> RUNX1--RUNX1_1.pdb
    """
    source = _normalize_source(source, variant_id)
    raw  = str(variant_id or '').strip()
    safe = _safe_variant_id(raw)

    if source == 'deleted':
        base = safe if re.match(r'^TF\d+$', safe, flags=re.IGNORECASE) else f'TF{safe}'
    elif source == 'cellfusion':
        base = safe
    else:
        base = safe if re.match(r'^T\d+$', safe, flags=re.IGNORECASE) else f'T{safe}'

    return f'{base}.pdb'


def get_pdb_filepath(variant_id, source=None):
    source   = _normalize_source(source, variant_id)
    filename = _filename_for_variant(variant_id, source)
    return os.path.join(PDB_DIRS[source], filename)


def _download_url(variant_id, source=None):
    source = _normalize_source(source, variant_id)
    return f'/api/protein/download/{quote(str(variant_id), safe="")}?source={source}'


def _content_url(variant_id, source=None):
    source = _normalize_source(source, variant_id)
    return f'/api/protein/pdb-content/{quote(str(variant_id), safe="")}?source={source}'


def _job_response(job):
    return {
        'success':     job.get('status') not in ('error',),
        'job_id':      job.get('job_id'),
        'status':      job.get('status'),
        'variant_id':  job.get('variant_id'),
        'source':      job.get('source'),
        'filename':    job.get('filename'),
        'url':         job.get('url'),
        'content_url': job.get('content_url'),
        'message':     job.get('message'),
        'cached':      job.get('cached', False),
        'work_dir':    job.get('work_dir'),
        'log_file':    job.get('log_file'),
        'created_at':  job.get('created_at'),
        'updated_at':  job.get('updated_at'),
    }


def _cleanup_jobs():
    now = time.time()
    with JOB_LOCK:
        expired = [jid for jid, j in JOBS.items() if now - j.get('created_at', now) > JOB_TTL_SECONDS]
        for jid in expired:
            key = JOBS[jid].get('cache_key')
            if key and RUNNING_BY_KEY.get(key) == jid:
                RUNNING_BY_KEY.pop(key, None)
            JOBS.pop(jid, None)


def _job_work_dir(source, filename):
    base = os.path.splitext(filename)[0]
    return os.path.join(COLABFOLD_JOB_BASE_DIR, source, base)


def _write_fasta(path, sequence, fasta_name):
    # fasta name 只保留安全字符，避免 colabfold 输出名里出现奇怪字符。
    safe_name = re.sub(r'[^A-Za-z0-9_.-]', '_', fasta_name)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(f'>{safe_name}\n')
        # 每 80 个氨基酸换行，方便排查。
        for i in range(0, len(sequence), 80):
            f.write(sequence[i:i + 80] + '\n')


def _make_colabfold_env():
    """
    构造传给 colabfold_batch 子进程的干净环境变量。

    与手动运行前执行的操作等价：
        unset TF_FORCE_UNIFIED_MEMORY
        unset XLA_PYTHON_CLIENT_ALLOCATOR
        unset LD_LIBRARY_PATH
        export XLA_PYTHON_CLIENT_PREALLOCATE=false
        export XLA_PYTHON_CLIENT_MEM_FRACTION=0.70
    """
    env = copy.copy(os.environ)
    # 移除与 localcolabfold 内置 CUDA 库冲突的变量
    for key in _COLABFOLD_ENV_UNSET:
        env.pop(key, None)
    # 按需分配显存，避免 JAX 一次性预占全部 GPU 显存
    env['XLA_PYTHON_CLIENT_PREALLOCATE']  = XLA_PREALLOCATE
    env['XLA_PYTHON_CLIENT_MEM_FRACTION'] = XLA_MEM_FRACTION
    return env


def _build_colabfold_command(input_fasta, output_dir):
    """
    根据 COLABFOLD_USE_CONDA 构建调用命令：
      False（localcolabfold）: colabfold_batch [args] input output
      True （conda 环境）    : conda run -n <env> colabfold_batch [args] input output
    """
    if COLABFOLD_USE_CONDA:
        cmd = [CONDA_EXE, 'run', '-n', COLABFOLD_ENV, COLABFOLD_BIN]
    else:
        cmd = [COLABFOLD_BIN]

    if COLABFOLD_MSA_MODE:
        cmd.extend(['--msa-mode', COLABFOLD_MSA_MODE])
    if COLABFOLD_NUM_RECYCLE:
        cmd.extend(['--num-recycle', str(COLABFOLD_NUM_RECYCLE)])
    if COLABFOLD_NUM_MODELS:
        cmd.extend(['--num-models', str(COLABFOLD_NUM_MODELS)])
    if COLABFOLD_EXTRA_ARGS:
        cmd.extend(COLABFOLD_EXTRA_ARGS.split())

    cmd.extend([input_fasta, output_dir])
    return cmd


def _find_best_pdb(output_dir):
    """
    在 ColabFold 输出目录中找到最佳 PDB 文件。
    ColabFold 1.6.x 输出文件名示例：
        T123_unrelaxed_rank_001_alphafold2_ptm_model_1_seed_000.pdb
        T123_relaxed_rank_001_alphafold2_ptm_model_1_seed_000.pdb
    优先级：relaxed_rank_001 > unrelaxed_rank_001 > rank_001 > rank_1 > ranked_0 > model_1
    """
    pdb_files = glob.glob(os.path.join(output_dir, '**', '*.pdb'), recursive=True)
    if not pdb_files:
        return None

    preferred_patterns = [
        'relaxed_rank_001',
        'unrelaxed_rank_001',
        'rank_001',
        'rank_1',
        'ranked_0',
        'model_1',
    ]
    for pattern in preferred_patterns:
        for pdb in pdb_files:
            if pattern in os.path.basename(pdb):
                return pdb

    # 兜底：取最新修改的 PDB
    pdb_files.sort(key=lambda p: os.path.getmtime(p), reverse=True)
    return pdb_files[0]


def _mark_job(job_id, **updates):
    with JOB_LOCK:
        job = JOBS.get(job_id)
        if job:
            job.update(updates)
            job['updated_at'] = time.time()


def _run_colabfold_prediction(job_id, variant_id, sequence, source):
    """
    后台执行本地 ColabFold / AlphaFold2 预测。
    当前版本已停用本地 ColabFold；即使被旧代码误调用，也会直接返回，不会启动 subprocess。
    """
    if not COLABFOLD_ENABLED:
        source = _normalize_source(source, variant_id)
        filename = os.path.basename(get_pdb_filepath(variant_id, source))
        cache_key = f'{source}:{filename}'
        _mark_job(
            job_id,
            status='error',
            message='本地 AlphaFold2/ColabFold 预测已停用。请使用 ESMFold 或外部网站预测。',
        )
        with JOB_LOCK:
            RUNNING_BY_KEY.pop(cache_key, None)
        print(f'[ColabFold] 已停用，未启动预测: {filename}')
        return
    source         = _normalize_source(source, variant_id)
    final_pdb_path = get_pdb_filepath(variant_id, source)
    filename       = os.path.basename(final_pdb_path)
    cache_key      = f'{source}:{filename}'
    work_dir       = _job_work_dir(source, filename)
    input_fasta    = os.path.join(work_dir, 'input.fasta')
    output_dir     = os.path.join(work_dir, 'output')
    log_file       = os.path.join(work_dir, 'run.log')

    try:
        os.makedirs(work_dir,   exist_ok=True)
        os.makedirs(output_dir, exist_ok=True)

        _mark_job(
            job_id,
            status='running',
            message='Local ColabFold is predicting the protein structure. '
                    'First run can be slow because JAX/model/GPU initialization may take several minutes.',
            work_dir=work_dir,
            log_file=log_file,
        )

        # 任务启动后再检查一次，避免重复任务同时写文件。
        if os.path.exists(final_pdb_path):
            _mark_job(
                job_id,
                status='success',
                message='PDB已存在',
                url=_download_url(variant_id, source),
                content_url=_content_url(variant_id, source),
                cached=True,
            )
            with JOB_LOCK:
                RUNNING_BY_KEY.pop(cache_key, None)
            return

        _write_fasta(input_fasta, sequence, os.path.splitext(filename)[0])
        cmd = _build_colabfold_command(input_fasta, output_dir)

        print(f'[ColabFold] 开始预测 {filename}，source={source}，长度: {len(sequence)}aa')
        print(f'[ColabFold] 工作目录: {work_dir}')
        print(f'[ColabFold] 命令: {" ".join(cmd)}')
        print(f'[ColabFold] 调用模式: {"conda run" if COLABFOLD_USE_CONDA else "localcolabfold 直接调用"}')

        with open(log_file, 'w', encoding='utf-8') as log:
            log.write(f'Command: {" ".join(cmd)}\n')
            log.write(f'Input FASTA: {input_fasta}\n')
            log.write(f'Output dir: {output_dir}\n')
            log.write(f'XLA_PYTHON_CLIENT_PREALLOCATE: {XLA_PREALLOCATE}\n')
            log.write(f'XLA_PYTHON_CLIENT_MEM_FRACTION: {XLA_MEM_FRACTION}\n\n')
            log.flush()

            completed = subprocess.run(
                cmd,
                cwd=work_dir,
                stdout=log,
                stderr=subprocess.STDOUT,
                text=True,
                timeout=COLABFOLD_TIMEOUT_SECONDS,
                check=False,
                env=_make_colabfold_env(),   # 传入干净的 GPU 环境变量
            )

        if completed.returncode != 0:
            raise RuntimeError(
                f'ColabFold预测失败，返回码 {completed.returncode}。请查看日志: {log_file}'
            )

        best_pdb = _find_best_pdb(output_dir)
        if not best_pdb:
            raise RuntimeError(f'ColabFold运行结束，但未找到 PDB 文件。请查看日志: {log_file}')

        if not os.path.exists(best_pdb) or os.path.getsize(best_pdb) == 0:
            raise RuntimeError(f'找到的 PDB 文件为空: {best_pdb}')

        # 简单校验 PDB 是否包含 ATOM 记录。
        with open(best_pdb, 'r', encoding='utf-8', errors='ignore') as f:
            head = f.read(20000)
        if 'ATOM' not in head:
            raise RuntimeError(f'PDB 文件中未检测到 ATOM 记录: {best_pdb}')

        os.makedirs(os.path.dirname(final_pdb_path), exist_ok=True)
        tmp_path = f'{final_pdb_path}.tmp.{job_id}'
        shutil.copyfile(best_pdb, tmp_path)
        os.replace(tmp_path, final_pdb_path)

        print(f'[ColabFold] {filename} 成功保存: {final_pdb_path}')
        _mark_job(
            job_id,
            status='success',
            message='预测成功',
            url=_download_url(variant_id, source),
            content_url=_content_url(variant_id, source),
            cached=False,
        )
        with JOB_LOCK:
            RUNNING_BY_KEY.pop(cache_key, None)

    except subprocess.TimeoutExpired:
        msg = f'ColabFold预测超时，超过 {COLABFOLD_TIMEOUT_SECONDS // 60} 分钟。可缩短序列或稍后重试。'
        _mark_job(job_id, status='error', message=msg)
        with JOB_LOCK:
            RUNNING_BY_KEY.pop(cache_key, None)
        print(f'[ColabFold] {filename} 超时')

    except Exception as e:
        _mark_job(job_id, status='error', message=str(e))
        with JOB_LOCK:
            RUNNING_BY_KEY.pop(cache_key, None)
        print(f'[ColabFold] {filename} 异常: {e}')


# ==================== API 路由 ====================
@protein_structure_bp.route('/status', methods=['GET'])
def api_status():
    """API状态：本地 ColabFold 计算已停用，仅保留 ESMFold 代理与 PDB 缓存读取。"""
    try:
        counts = {}
        for source, path in PDB_DIRS.items():
            counts[source] = len([f for f in os.listdir(path) if f.endswith('.pdb')]) if os.path.exists(path) else 0
        return jsonify({
            'status':              'running',
            'backend':             'esmfold_only',
            'colabfold_enabled':   False,
            'message':             'Local ColabFold / AlphaFold2 prediction is disabled. Use /api/protein/esm-fold or external prediction websites.',
            'esm_fold_proxy':      True,
            'esm_fold_max_aa':     600,
            'cached_files':        counts,
            'active_jobs':         0,
            'storage_dirs':        PDB_DIRS,
            'job_base_dir':        COLABFOLD_JOB_BASE_DIR,
        })
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


@protein_structure_bp.route('/check/<path:variant_id>', methods=['GET'])
@jwt_required()
def check_pdb_exists(variant_id):
    """检查 PDB 是否存在"""
    source   = _get_source_from_request(variant_id)
    filepath = get_pdb_filepath(variant_id, source)
    filename = os.path.basename(filepath)
    exists   = os.path.exists(filepath)
    print(f'[Protein] 检查 {filename} ({source}): {"存在" if exists else "不存在"}')

    response = {
        'exists':     exists,
        'variant_id': variant_id,
        'source':     source,
        'filename':   filename,
    }
    if exists:
        response['url']        = _download_url(variant_id, source)
        response['content_url'] = _content_url(variant_id, source)
        response['file_size']  = os.path.getsize(filepath)
    return jsonify(response)


def _start_prediction_job(variant_id):
    """
    本地 ColabFold / AlphaFold2 计算已停用。
    仅在已有 PDB 缓存存在时返回缓存；否则明确告诉前端使用 ESMFold 或外部网站。
    """
    data = request.get_json(silent=True) or {}
    sequence = clean_sequence(data.get('sequence', ''))

    source   = _get_source_from_request(variant_id)
    filepath = get_pdb_filepath(variant_id, source)
    filename = os.path.basename(filepath)

    if os.path.exists(filepath):
        return jsonify({
            'success':     True,
            'status':      'success',
            'message':     'PDB已存在',
            'variant_id':  variant_id,
            'source':      source,
            'filename':    filename,
            'url':         _download_url(variant_id, source),
            'content_url': _content_url(variant_id, source),
            'cached':      True,
        }), 200

    return jsonify({
        'success':    False,
        'status':     'disabled',
        'variant_id': variant_id,
        'source':     source,
        'filename':   filename,
        'sequence_length': len(sequence),
        'message':    '本地 AlphaFold2/ColabFold 预测已停用。请使用 ESMFold 预览；如果序列超过 ESMFold 范围，请点击前端下方按钮复制序列并跳转到对应网站预测。',
    }), 410


@protein_structure_bp.route('/predict-start/<path:variant_id>', methods=['POST'])
@jwt_required()
def predict_structure_start(variant_id):
    """本地 ColabFold 已停用：不再启动后台预测任务。"""
    return _start_prediction_job(variant_id)


@protein_structure_bp.route('/predict/<path:variant_id>', methods=['POST'])
@jwt_required()
def predict_structure(variant_id):
    """
    兼容旧接口。
    本地 ColabFold 已停用：不再启动后台预测任务。
    """
    return _start_prediction_job(variant_id)


@protein_structure_bp.route('/predict-status/<string:job_id>', methods=['GET'])
@jwt_required()
def predict_structure_status(job_id):
    """本地 ColabFold 已停用，因此不会再产生新的后台任务。"""
    return jsonify({
        'success': False,
        'status': 'disabled',
        'job_id': job_id,
        'message': '本地 AlphaFold2/ColabFold 预测已停用；前端应使用 ESMFold 或外部网站预测。'
    }), 410


@protein_structure_bp.route('/download/<path:variant_id>', methods=['GET'])
@jwt_required()
def download_pdb(variant_id):
    """下载 PDB"""
    source   = _get_source_from_request(variant_id)
    filepath = get_pdb_filepath(variant_id, source)
    filename = os.path.basename(filepath)
    if not os.path.exists(filepath):
        return jsonify({'success': False, 'message': '文件不存在', 'filename': filename, 'source': source}), 404
    return send_file(
        filepath,
        mimetype='chemical/x-pdb',
        as_attachment=True,
        download_name=filename,
    )


@protein_structure_bp.route('/pdb-content/<path:variant_id>', methods=['GET'])
@jwt_required()
def get_pdb_content(variant_id):
    """获取 PDB 内容，用于 3Dmol.js 前端渲染"""
    source   = _get_source_from_request(variant_id)
    filepath = get_pdb_filepath(variant_id, source)
    filename = os.path.basename(filepath)
    if not os.path.exists(filepath):
        return jsonify({'success': False, 'message': '文件不存在', 'filename': filename, 'source': source}), 404
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return jsonify({
                'success':     True,
                'variant_id':  variant_id,
                'source':      source,
                'filename':    filename,
                'pdb_content': f.read(),
            })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@protein_structure_bp.route('/esm-fold', methods=['POST'])
@jwt_required()
def esm_fold_proxy():
    """
    代理 ESMFold API 请求，绕过浏览器 CORS 限制。
    前端无法直接调用 api.esmatlas.com（CORS），改由后端转发。
    返回：{ success, pdb_content } 或 { success: false, message }
    """
    import urllib.request as _url_req
    import urllib.error   as _url_err

    data     = request.get_json(silent=True) or {}
    sequence = clean_sequence(data.get('sequence', ''))

    if not sequence:
        return jsonify({'success': False, 'message': '无效氨基酸序列'}), 400

    ESM_PROXY_MAX = 600
    if len(sequence) > ESM_PROXY_MAX:
        return jsonify({
            'success': False,
            'message': f'序列长度 {len(sequence)}aa 超过 ESMFold 代理限制 {ESM_PROXY_MAX}aa'
        }), 400

    print(f'[ESMFold] 代理请求，序列长度 {len(sequence)}aa')
    try:
        req = _url_req.Request(
            'https://api.esmatlas.com/foldSequence/v1/pdb/',
            data=sequence.encode('utf-8'),
            headers={'Content-Type': 'text/plain'},
            method='POST',
        )
        with _url_req.urlopen(req, timeout=90) as resp:
            pdb_content = resp.read().decode('utf-8', errors='replace')

        if 'ATOM' not in pdb_content:
            print('[ESMFold] 返回内容不含 ATOM 记录，视为失败')
            return jsonify({'success': False, 'message': 'ESMFold 返回内容不包含有效 PDB 结构'}), 502

        print(f'[ESMFold] 代理成功，PDB {len(pdb_content)} 字节')
        return jsonify({'success': True, 'pdb_content': pdb_content})

    except _url_err.HTTPError as e:
        msg = f'ESMFold API 返回 HTTP {e.code}'
        print(f'[ESMFold] {msg}')
        return jsonify({'success': False, 'message': msg}), 502
    except _url_err.URLError as e:
        msg = f'ESMFold API 连接失败: {e.reason}'
        print(f'[ESMFold] {msg}')
        return jsonify({'success': False, 'message': msg}), 502
    except TimeoutError:
        msg = 'ESMFold API 请求超时（>90s）'
        print(f'[ESMFold] {msg}')
        return jsonify({'success': False, 'message': msg}), 504
    except Exception as e:
        msg = f'ESMFold 代理异常: {str(e)}'
        print(f'[ESMFold] {msg}')
        return jsonify({'success': False, 'message': msg}), 500


print('[Protein Structure] 蓝图已加载：esmfold_only，local_colabfold disabled')
