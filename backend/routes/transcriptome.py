# backend/routes/transcriptome.py
# 转录组分析路由 - v4.3 本地R富集绘图版
#
# 修复内容：
# 1. 🔥🔥🔥 修复 p 值计算 - Fisher检验结果正确返回给前端
# 2. 富集分析不再调用 Enrichr API，而是在后端调用 R/clusterProfiler 完成 GO/KEGG 分析和绘图
# 3. GO/KEGG 使用合并后的显著差异基因，不再拆分上调/下调分别富集
# 4. 富集图由 R 输出 PNG/PDF，前端直接展示 PNG，并提供 PDF 下载

from flask import Blueprint, jsonify, request, send_from_directory
from flask_jwt_extended import jwt_required
from extensions import db
from models import Fusion
import pandas as pd
import numpy as np
import os
import traceback
import json
import re
import subprocess
import hashlib
import shutil
import threading

# scipy用于统计检验
try:
    from scipy import stats
    HAS_SCIPY = True
except ImportError:
    HAS_SCIPY = False

# pyDESeq2
try:
    from pydeseq2.dds import DeseqDataSet
    from pydeseq2.ds import DeseqStats
    HAS_PYDESEQ2 = True
    print("[Transcriptome] ✅ pyDESeq2 已加载")
except ImportError:
    HAS_PYDESEQ2 = False
    print("[Transcriptome] ⚠️ pyDESeq2未安装: pip install pydeseq2")

# statsmodels备用
try:
    from statsmodels.stats.multitest import multipletests
    HAS_STATSMODELS = True
except ImportError:
    HAS_STATSMODELS = False

transcriptome_bp = Blueprint('transcriptome', __name__)

# ==================== 配置 ====================
basedir = os.path.abspath(os.path.dirname(__file__))
DATA_DIR = os.path.join(basedir, 'data')
MATRIX_CACHE_DIR = os.path.join(DATA_DIR, 'matrix_cache')

# 两个数据文件
EXPRESSION_FILE = os.path.join(DATA_DIR, 'normalized.all.count.csv')  # TPM用于表达量比较
COUNT_FILE = os.path.join(DATA_DIR, 'raw_count.csv')  # raw count用于DESeq2

# 差异分析参数
LOG2FC_THRESHOLD = 1.0
FDR_THRESHOLD = 0.05

# 预计算 DESeq2 结果目录：backend/routes/data/precomputed_deseq
PRECOMPUTED_DESEQ_DIR = os.path.join(DATA_DIR, 'precomputed_deseq')

# R富集分析输出目录：PNG/PDF/CSV都会保存在这里
R_ENRICHMENT_DIR = os.path.join(DATA_DIR, 'r_enrichment_results')
R_ENRICHMENT_TMP_DIR = os.path.join(DATA_DIR, 'r_enrichment_tmp')
R_ENRICHMENT_SCRIPT = os.path.join(DATA_DIR, 'run_go_kegg_enrichment.R')
os.makedirs(R_ENRICHMENT_DIR, exist_ok=True)
os.makedirs(R_ENRICHMENT_TMP_DIR, exist_ok=True)

# ==================== R / GO-KEGG 环境配置 ====================
# 服务器部署版：默认通过 conda run -n r452 Rscript 调用 R 4.5.2 环境，
# 不再依赖启动后端前手动 export RSCRIPT_PATH。
# 如需临时改环境，可在启动后端前设置：
#   export R_CONDA_ENV=r452
#   export R_LIBS_USER=/root/R/library
#   export USE_CONDA_RUN_R=1
R_CONDA_ENV = os.environ.get('R_CONDA_ENV', 'r452').strip()
CONDA_EXE = (
    os.environ.get('CONDA_EXE', '').strip()
    or shutil.which('conda')
    or '/opt/miniforge3/bin/conda'
)
USE_CONDA_RUN_R = os.environ.get('USE_CONDA_RUN_R', '1').strip().lower() not in ('0', 'false', 'no')

# 兜底路径：如果关闭 USE_CONDA_RUN_R，才直接调用这个 Rscript。
DEFAULT_RSCRIPT_PATH = '/opt/miniforge3/envs/r452/bin/Rscript'
RSCRIPT_PATH = (
    os.environ.get('RSCRIPT_PATH', '').strip()
    or (DEFAULT_RSCRIPT_PATH if os.path.exists(DEFAULT_RSCRIPT_PATH) else '')
    or shutil.which('Rscript')
)

# R包库路径：默认使用刚配置好的 /root/R/library。
R_LIBS_USER = os.environ.get('R_LIBS_USER', '/root/R/library').strip()


def build_rscript_cmd(r_script, args):
    """构建运行 R 脚本的命令。
    默认使用 conda run -n r452 Rscript，保证 Flask 后端即使在 fusiongp 环境启动，
    GO/KEGG 也会调用 r452 环境里的 R 4.5.2 和 /root/R/library 包库。
    """
    if USE_CONDA_RUN_R and R_CONDA_ENV and CONDA_EXE and os.path.exists(CONDA_EXE):
        return [CONDA_EXE, 'run', '-n', R_CONDA_ENV, 'Rscript', r_script] + list(args)
    return [RSCRIPT_PATH, r_script] + list(args)
try:
    R_ENRICHMENT_TIMEOUT_SECONDS = int(os.environ.get('R_ENRICHMENT_TIMEOUT_SECONDS', '900'))
except ValueError:
    R_ENRICHMENT_TIMEOUT_SECONDS = 900
_r_enrichment_jobs = set()
_r_enrichment_jobs_lock = threading.Lock()


def safe_fusion_name(fusion_name):
    """把融合名转换成预计算JSON文件名。
    例如 RUNX1--RUNX1T1 -> RUNX1__RUNX1T1.json
    """
    s = str(fusion_name).strip().replace('--', '__')
    s = re.sub(r'[^A-Za-z0-9_]+', '_', s)
    s = re.sub(r'_+', '_', s).strip('_')
    return s


def load_precomputed_deseq(fusion_name):
    """优先读取提前算好的DESeq2结果。
    如果不存在，返回 None，后面再走实时计算兜底。
    """
    json_path = os.path.join(
        PRECOMPUTED_DESEQ_DIR,
        safe_fusion_name(fusion_name) + '.json'
    )

    if not os.path.exists(json_path):
        print(f"[Precomputed DESeq2] 未找到: {json_path}")
        return None

    try:
        print(f"[Precomputed DESeq2] ✅ 读取: {json_path}")
        with open(json_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"[Precomputed DESeq2] ❌ 读取失败: {e}")
        traceback.print_exc()
        return None


# 缓存
_expression_df = None
_expression_loaded = False
_count_df = None
_count_loaded = False


# ==================== 数据加载 ====================


def _matrix_cache_path(source_path):
    os.makedirs(MATRIX_CACHE_DIR, exist_ok=True)
    base = os.path.basename(source_path).replace(os.sep, '_')
    return os.path.join(MATRIX_CACHE_DIR, f'{base}.pkl')


def _read_cached_matrix(source_path, label):
    cache_path = _matrix_cache_path(source_path)
    if not os.path.exists(cache_path):
        return None

    try:
        if os.path.getmtime(cache_path) < os.path.getmtime(source_path):
            print(f"[Transcriptome] {label} cache is older than source, rebuilding: {cache_path}")
            return None
    except OSError:
        return None

    try:
        print(f"[Transcriptome] Loading {label} matrix cache: {cache_path}")
        df = pd.read_pickle(cache_path)
        print(f"[Transcriptome] Loaded {label} cache: {df.shape[0]} genes x {df.shape[1]} samples")
        return df
    except Exception as e:
        print(f"[Transcriptome] Failed to read {label} cache, falling back to source file: {e}")
        traceback.print_exc()
        return None


def _write_matrix_cache(df, source_path, label):
    cache_path = _matrix_cache_path(source_path)
    tmp_path = f"{cache_path}.tmp.{os.getpid()}"
    try:
        print(f"[Transcriptome] Writing {label} matrix cache: {cache_path}")
        df.to_pickle(tmp_path)
        os.replace(tmp_path, cache_path)
        print(f"[Transcriptome] {label} matrix cache ready: {cache_path}")
    except Exception as e:
        print(f"[Transcriptome] Failed to write {label} matrix cache: {e}")
        traceback.print_exc()
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except OSError:
            pass


def load_expression_matrix():
    """加载TPM表达矩阵（用于表达量比较图）"""
    global _expression_df, _expression_loaded
    
    if _expression_loaded:
        return _expression_df
    
    _expression_loaded = True
    
    possible_paths = [
        EXPRESSION_FILE,
        os.path.join(DATA_DIR, 'normalized.all.count.csv'),
    ]
    
    for path in possible_paths:
        if os.path.exists(path):
            try:
                cached = _read_cached_matrix(path, 'TPM')
                if cached is not None:
                    _expression_df = cached
                    return _expression_df

                print(f"[Transcriptome] 📂 加载TPM矩阵: {path}")
                _expression_df = pd.read_csv(path, index_col=0)
                _write_matrix_cache(_expression_df, path, 'TPM')
                print(f"[Transcriptome] ✅ TPM矩阵: {_expression_df.shape[0]} 基因 × {_expression_df.shape[1]} 样本")
                return _expression_df
            except Exception as e:
                print(f"[Transcriptome] ❌ 加载失败: {e}")
    
    return None


def read_matrix_auto(path):
    """根据文件扩展名自动读取表达/count矩阵。
    支持 csv、tsv/txt、xlsx/xls；第一列作为基因名索引。
    """
    ext = os.path.splitext(path)[1].lower()

    if ext in ['.xlsx', '.xls']:
        return pd.read_excel(path, index_col=0)

    if ext in ['.tsv', '.txt']:
        return pd.read_csv(path, sep='\t', index_col=0)

    # csv 或无扩展名：优先按逗号读取；如果只读出1列，再尝试tab分隔
    df = pd.read_csv(path, index_col=0)
    if df.shape[1] <= 1:
        try:
            df_tab = pd.read_csv(path, sep='\t', index_col=0)
            if df_tab.shape[1] > df.shape[1]:
                df = df_tab
        except Exception:
            pass
    return df


def load_count_matrix():
    """加载raw count矩阵（用于DESeq2差异分析）"""
    global _count_df, _count_loaded
    
    if _count_loaded:
        return _count_df
    
    _count_loaded = True
    
    possible_paths = [
        COUNT_FILE,
        os.path.join(DATA_DIR, 'raw_count.csv'),
        os.path.join(DATA_DIR, 'raw_count'),
        os.path.join(DATA_DIR, 'raw_count.tsv'),
        os.path.join(DATA_DIR, 'raw_count.txt'),
        os.path.join(DATA_DIR, 'raw_count.xlsx'),
        os.path.join(DATA_DIR, 'raw_count.xls'),
        # 旧文件名保留为兜底，防止部署环境里还没替换文件
        os.path.join(DATA_DIR, 'count_target.csv'),
        os.path.join(DATA_DIR, 'count-target.csv'),
    ]
    
    for path in possible_paths:
        if os.path.exists(path):
            try:
                cached = _read_cached_matrix(path, 'Raw Count')
                if cached is not None:
                    _count_df = cached
                    return _count_df

                print(f"[Transcriptome] 📂 加载Raw Count矩阵: {path}")
                _count_df = read_matrix_auto(path)

                # DESeq2需要原始整数count；这里不做归一化，只把读入的数值转成numeric。
                _count_df = _count_df.apply(pd.to_numeric, errors='coerce').fillna(0)
                _write_matrix_cache(_count_df, path, 'Raw Count')

                print(f"[Transcriptome] ✅ Raw Count矩阵: {_count_df.shape[0]} 基因 × {_count_df.shape[1]} 样本")
                return _count_df
            except Exception as e:
                print(f"[Transcriptome] ❌ 加载失败: {e}")
                traceback.print_exc()
    
    print("[Transcriptome] ⚠️ 未找到raw count矩阵文件，请确认 backend/routes/data/raw_count.csv 是否存在")
    return None


def get_samples_with_fusion(fusion_name):
    """
    🔥 修复：从 Fusion 表获取融合阳性样本
    列名是 fusion_name，不是 x_fusion_name
    """
    samples = []
    
    try:
        # 🔥 直接从 Fusion 表查询，使用 fusion_name 列
        results = db.session.query(Fusion.sample_name).filter(
            Fusion.fusion_name == fusion_name
        ).all()
        
        for r in results:
            if r[0]:
                # sample_name 可能是逗号分隔的多个样本
                samples.extend([s.strip() for s in str(r[0]).split(',') if s.strip()])
        
        print(f"[Transcriptome] 🔍 融合 '{fusion_name}' 找到 {len(samples)} 个样本（去重前）")
        
    except Exception as e:
        print(f"[Transcriptome] ⚠️ 查询样本失败: {e}")
        traceback.print_exc()
    
    unique_samples = list(set(samples))
    print(f"[Transcriptome] ✅ 融合阳性样本（去重后）: {len(unique_samples)}")
    
    return unique_samples


def match_sample_names(fusion_samples, matrix_columns):
    """匹配样本名（处理格式差异）"""
    def normalize(name):
        return name.replace('-', '_').replace('.', '_').upper()
    
    matrix_map = {normalize(col): col for col in matrix_columns}
    matched = []
    
    for sample in fusion_samples:
        norm = normalize(sample)
        if norm in matrix_map:
            matched.append(matrix_map[norm])
        else:
            # 尝试部分匹配
            for k, v in matrix_map.items():
                if norm in k or k in norm:
                    matched.append(v)
                    break
    
    return list(set(matched))


# ==================== 🔥🔥🔥 关键修复：P值计算 🔥🔥🔥 ====================

def is_zero_inflated(values, zero_threshold=1.0, zero_ratio=0.8):
    """
    判断数据是否是零通胀的
    当超过 zero_ratio 比例的样本值 <= zero_threshold 时认为是零通胀
    """
    if len(values) == 0:
        return False
    zero_count = np.sum(values <= zero_threshold)
    ratio = zero_count / len(values)
    return ratio >= zero_ratio


def calculate_fisher_pvalue(pos_values, neg_values, threshold=1.0):
    """
    🔥 使用 Fisher 精确检验计算 p 值
    适用于零通胀数据（一组几乎全是0，另一组有表达）
    """
    # 计算有表达（>threshold）的样本数
    pos_expressed = int(np.sum(pos_values > threshold))
    pos_not_expressed = len(pos_values) - pos_expressed
    neg_expressed = int(np.sum(neg_values > threshold))
    neg_not_expressed = len(neg_values) - neg_expressed
    
    # 构建2x2列联表
    table = [[pos_expressed, pos_not_expressed],
             [neg_expressed, neg_not_expressed]]
    
    print(f"[Transcriptome] 📊 零通胀检验 - 列联表: {table}")
    print(f"[Transcriptome]    阳性表达率: {pos_expressed}/{len(pos_values)} = {pos_expressed/len(pos_values)*100:.1f}%")
    print(f"[Transcriptome]    阴性表达率: {neg_expressed}/{len(neg_values)} = {neg_expressed/len(neg_values)*100:.1f}%")
    
    try:
        # Fisher精确检验
        odds_ratio, p_fisher = stats.fisher_exact(table)
        print(f"[Transcriptome]    Fisher精确检验: p = {p_fisher:.4e}, OR = {odds_ratio:.2f}")
        
        # 处理极小的p值（避免下溢）
        if p_fisher == 0:
            p_fisher = 1e-300
        
        return float(p_fisher)
    except Exception as e:
        print(f"[Transcriptome] ⚠️ Fisher检验失败: {e}")
        # 备用：卡方检验
        try:
            chi2, p_chi2, dof, expected = stats.chi2_contingency(table)
            print(f"[Transcriptome]    卡方检验: p = {p_chi2:.4e}")
            return float(p_chi2)
        except:
            return 1.0


def calculate_real_expression(gene_name, fusion_samples, expression_df):
    """
    🔥🔥🔥 修复版：计算单个基因的真实表达量差异
    核心修复：正确返回 Fisher 检验的 p 值
    """
    if expression_df is None:
        return None
    
    clean_gene = gene_name.split('^')[0] if '^' in gene_name else gene_name
    
    # 查找基因
    gene_found = None
    for idx in expression_df.index:
        if clean_gene.upper() == str(idx).split('^')[0].upper():
            gene_found = idx
            break
        if clean_gene.upper() in str(idx).upper():
            gene_found = idx
            break
    
    if gene_found is None:
        print(f"[Transcriptome] ⚠️ 未找到基因: {clean_gene}")
        return None
    
    gene_expr = expression_df.loc[gene_found]
    all_samples = set(expression_df.columns)
    positive_samples = match_sample_names(fusion_samples, expression_df.columns)
    negative_samples = list(all_samples - set(positive_samples))
    
    if len(positive_samples) == 0:
        print(f"[Transcriptome] ⚠️ 基因 {clean_gene}: 无匹配的阳性样本")
        return None
    
    pos_values = gene_expr[positive_samples].dropna().astype(float).values
    neg_values = gene_expr[negative_samples].dropna().astype(float).values
    
    pos_mean = float(np.mean(pos_values)) if len(pos_values) > 0 else 0
    neg_mean = float(np.mean(neg_values)) if len(neg_values) > 0 else 0
    pos_var = float(np.var(pos_values)) if len(pos_values) > 0 else 0
    neg_var = float(np.var(neg_values)) if len(neg_values) > 0 else 0
    
    print(f"[Transcriptome] 📊 基因 {clean_gene}: 阳性={len(pos_values)}, 阴性={len(neg_values)}")
    print(f"[Transcriptome]    阳性: 均值={pos_mean:.2f}, 方差={pos_var:.2f}")
    print(f"[Transcriptome]    阴性: 均值={neg_mean:.2f}, 方差={neg_var:.2f}")
    
    # 🔥🔥🔥 核心修复：统一的p值计算逻辑 🔥🔥🔥
    final_p = 1.0
    test_method = "none"
    t_stat = 0.0
    
    if HAS_SCIPY and len(pos_values) >= 2 and len(neg_values) >= 2:
        try:
            # 检查是否为零通胀数据
            pos_is_zero_inflated = is_zero_inflated(pos_values)
            neg_is_zero_inflated = is_zero_inflated(neg_values)
            
            print(f"[Transcriptome]    阳性零通胀: {pos_is_zero_inflated}, 阴性零通胀: {neg_is_zero_inflated}")
            
            # 🔥 情况1：一组是零通胀，另一组不是 -> 使用Fisher检验
            if pos_is_zero_inflated != neg_is_zero_inflated:
                print(f"[Transcriptome] 🔥 检测到零通胀差异，使用Fisher精确检验")
                final_p = calculate_fisher_pvalue(pos_values, neg_values, threshold=1.0)
                test_method = "fisher_exact"
            
            # 🔥 情况2：均值差异悬殊（一组接近0，另一组明显高） -> 使用Fisher检验
            elif (neg_mean < 1 and pos_mean > 10) or (pos_mean < 1 and neg_mean > 10):
                print(f"[Transcriptome] 🔥 均值差异悬殊，使用Fisher精确检验")
                final_p = calculate_fisher_pvalue(pos_values, neg_values, threshold=1.0)
                test_method = "fisher_exact"
            
            # 🔥 情况3：正常情况 -> 使用 t检验 + Mann-Whitney
            else:
                p_value_ttest = 1.0
                p_value_mw = 1.0
                
                # Welch t检验
                if pos_var > 0 or neg_var > 0:
                    try:
                        t_stat, p_value_ttest = stats.ttest_ind(pos_values, neg_values, equal_var=False)
                        if np.isnan(p_value_ttest):
                            p_value_ttest = 1.0
                        else:
                            p_value_ttest = float(p_value_ttest)
                        print(f"[Transcriptome]    Welch t-test: p = {p_value_ttest:.4e}")
                    except Exception as e:
                        print(f"[Transcriptome] ⚠️ t-test失败: {e}")
                
                # Mann-Whitney U检验
                try:
                    stat, p_value_mw = stats.mannwhitneyu(
                        pos_values, neg_values, 
                        alternative='two-sided',
                        use_continuity=True
                    )
                    if np.isnan(p_value_mw):
                        p_value_mw = 1.0
                    else:
                        p_value_mw = float(p_value_mw)
                    print(f"[Transcriptome]    Mann-Whitney U: p = {p_value_mw:.4e}")
                except Exception as e:
                    print(f"[Transcriptome] ⚠️ Mann-Whitney 失败: {e}")
                
                # 选择更小的p值
                final_p = min(p_value_ttest, p_value_mw)
                test_method = "ttest_mw"
            
            # 🔥 额外检查：如果p值仍然是1.0，但均值差异很大，强制使用Fisher检验
            if final_p >= 0.99 and abs(pos_mean - neg_mean) > 10:
                print(f"[Transcriptome] 🔥 p值异常(={final_p})，强制使用Fisher精确检验")
                final_p = calculate_fisher_pvalue(pos_values, neg_values, threshold=1.0)
                test_method = "fisher_exact_fallback"
                
        except Exception as e:
            print(f"[Transcriptome] ⚠️ 统计检验失败: {e}")
            traceback.print_exc()
    
    # 确保p值是有效的float
    if np.isnan(final_p) or np.isinf(final_p):
        final_p = 1.0
    
    print(f"[Transcriptome] ✅ 基因 {clean_gene}: 最终 p = {final_p:.4e} (方法: {test_method})")
    
    return {
        'gene': clean_gene,
        'gene_full': gene_found,
        'fusion_positive': {
            'count': int(len(pos_values)),
            'values': [round(float(v), 2) for v in pos_values],
            'mean': round(pos_mean, 2),
            'median': round(float(np.median(pos_values)), 2) if len(pos_values) > 0 else 0,
            'std': round(float(np.std(pos_values)), 2) if len(pos_values) > 0 else 0,
            'min': round(float(np.min(pos_values)), 2) if len(pos_values) > 0 else 0,
            'max': round(float(np.max(pos_values)), 2) if len(pos_values) > 0 else 0
        },
        'fusion_negative': {
            'count': int(len(neg_values)),
            'values': (
                # 全部返回（≤500时直接返回，>500时系统采样500个保持分布代表性）
                [round(float(v), 2) for v in neg_values]
                if len(neg_values) <= 500
                else [round(float(neg_values[int(i * len(neg_values) / 500)]), 2) for i in range(500)]
            ),
            'mean': round(neg_mean, 2),
            'median': round(float(np.median(neg_values)), 2) if len(neg_values) > 0 else 0,
            'std': round(float(np.std(neg_values)), 2) if len(neg_values) > 0 else 0,
            'min': round(float(np.min(neg_values)), 2) if len(neg_values) > 0 else 0,
            'max': round(float(np.max(neg_values)), 2) if len(neg_values) > 0 else 0
        },
        'statistics': {
            'test_method': test_method,
            't_statistic': round(float(t_stat), 4) if not np.isnan(t_stat) else 0,
            'p_value': float(final_p),  # 🔥 直接返回final_p，不要round
            'significant': bool(final_p < 0.05)
        }
    }


# ==================== DESeq2 差异分析 ====================

def perform_deseq2_analysis(count_df, positive_samples, negative_samples):
    """使用pyDESeq2进行差异表达分析"""
    print(f"\n[DESeq2] ========== 差异表达分析 ==========")
    print(f"[DESeq2] 融合阳性样本: {len(positive_samples)}")
    print(f"[DESeq2] 融合阴性样本: {len(negative_samples)}")
    
    if len(positive_samples) < 2:
        print(f"[DESeq2] ⚠️ 阳性样本太少")
        return None
    
    try:
        # 准备数据
        all_samples = positive_samples + negative_samples
        
        # 🔥 检查样本是否都在count_df中
        missing_samples = [s for s in all_samples if s not in count_df.columns]
        if missing_samples:
            print(f"[DESeq2] ⚠️ 以下样本不在count矩阵中: {missing_samples[:5]}...")
            all_samples = [s for s in all_samples if s in count_df.columns]
            positive_samples = [s for s in positive_samples if s in count_df.columns]
            negative_samples = [s for s in negative_samples if s in count_df.columns]
            
            if len(positive_samples) < 2:
                print(f"[DESeq2] ⚠️ 有效阳性样本不足")
                return None
        
        counts = count_df[all_samples].copy()
        
        # 过滤低表达基因
        min_samples = min(10, len(all_samples) // 5)
        gene_filter = (counts > 10).sum(axis=1) >= min_samples
        counts = counts[gene_filter]
        
        print(f"[DESeq2] 过滤后基因数: {len(counts)}")
        
        if len(counts) == 0:
            print(f"[DESeq2] ⚠️ 过滤后无基因")
            return None
        
        # 创建metadata
        metadata = pd.DataFrame({
            'sample': all_samples,
            'condition': ['positive'] * len(positive_samples) + ['negative'] * len(negative_samples)
        }).set_index('sample')
        
        # 确保counts是整数
        counts = counts.astype(int)
        counts_T = counts.T
        
        if HAS_PYDESEQ2:
            print("[DESeq2] 使用 pyDESeq2 进行分析...")
            
            try:
                dds = DeseqDataSet(
                    counts=counts_T,
                    metadata=metadata,
                    design_factors="condition"
                )
                
                dds.deseq2()
                
                stat_res = DeseqStats(dds, contrast=["condition", "positive", "negative"])
                stat_res.summary()
                
                results = stat_res.results_df.copy()
                results['gene'] = results.index
                results = results.rename(columns={
                    'baseMean': 'base_mean',
                    'log2FoldChange': 'log2FC',
                    'pvalue': 'p_value',
                    'padj': 'adj_p_value'
                })
                
            except Exception as e:
                print(f"[DESeq2] ⚠️ pyDESeq2分析失败: {e}")
                traceback.print_exc()
                print("[DESeq2] 回退到简化分析...")
                results = simple_deg_analysis(counts, positive_samples, negative_samples)
        else:
            print("[DESeq2] pyDESeq2 不可用，使用简化分析...")
            results = simple_deg_analysis(counts, positive_samples, negative_samples)
        
        if results is None or len(results) == 0:
            return None
        
        # 添加基因符号
        results['gene_symbol'] = results['gene'].apply(lambda x: str(x).split('^')[0])
        
        # 处理NaN值
        results['log2FC'] = results['log2FC'].fillna(0)
        results['adj_p_value'] = results['adj_p_value'].fillna(1)
        results['p_value'] = results['p_value'].fillna(1) if 'p_value' in results.columns else 1
        
        # 标记显著差异基因
        results['significant'] = (
            (results['adj_p_value'] < FDR_THRESHOLD) & 
            (abs(results['log2FC']) > LOG2FC_THRESHOLD)
        )
        
        # 标记方向
        results['direction'] = 'ns'
        results.loc[(results['significant']) & (results['log2FC'] > 0), 'direction'] = 'up'
        results.loc[(results['significant']) & (results['log2FC'] < 0), 'direction'] = 'down'
        
        up_count = (results['direction'] == 'up').sum()
        down_count = (results['direction'] == 'down').sum()
        print(f"[DESeq2] ✅ 完成！上调: {up_count}, 下调: {down_count}")
        
        return results
        
    except Exception as e:
        print(f"[DESeq2] ❌ 差异分析出错: {e}")
        traceback.print_exc()
        return None


def simple_deg_analysis(counts, positive_samples, negative_samples):
    """简化的差异表达分析（当pyDESeq2不可用时使用）"""
    print("[SimpleDEG] 使用简化方法进行差异分析...")
    
    results = []
    
    for gene in counts.index:
        try:
            pos_vals = counts.loc[gene, positive_samples].values.astype(float)
            neg_vals = counts.loc[gene, negative_samples].values.astype(float)
            
            pos_mean = np.mean(pos_vals) + 1  # 加1避免log(0)
            neg_mean = np.mean(neg_vals) + 1
            
            log2fc = np.log2(pos_mean / neg_mean)
            
            # p值计算
            if np.var(pos_vals) > 0 or np.var(neg_vals) > 0:
                try:
                    _, p_val = stats.ttest_ind(pos_vals, neg_vals, equal_var=False)
                except:
                    p_val = 1.0
            else:
                p_val = 1.0
            
            if np.isnan(p_val):
                p_val = 1.0
                
            results.append({
                'gene': gene,
                'base_mean': (pos_mean + neg_mean) / 2,
                'log2FC': log2fc,
                'p_value': p_val,
                'adj_p_value': p_val  # 简化版不做多重校正
            })
        except Exception as e:
            continue
    
    if not results:
        return None
    
    df = pd.DataFrame(results)
    
    # 简单的FDR校正
    if HAS_STATSMODELS and len(df) > 0:
        try:
            _, adj_pvals, _, _ = multipletests(df['p_value'].fillna(1), method='fdr_bh')
            df['adj_p_value'] = adj_pvals
        except:
            pass
    
    return df


def get_deg_gene_lists(deg_df, p_threshold=0.05):
    """从差异分析结果提取基因列表"""
    if deg_df is None:
        return [], []
    
    # 🔥 只取 p < threshold 的基因
    significant = deg_df[deg_df['adj_p_value'].fillna(1) < p_threshold]
    
    up_genes = significant[significant['log2FC'] > LOG2FC_THRESHOLD]['gene_symbol'].tolist()
    down_genes = significant[significant['log2FC'] < -LOG2FC_THRESHOLD]['gene_symbol'].tolist()
    
    return up_genes, down_genes


# ==================== GO/KEGG富集分析：本地调用R绘图 ====================

def normalize_gene_symbols(gene_list):
    """清理并去重基因名，保持原始顺序。"""
    seen = set()
    cleaned = []
    for gene in gene_list or []:
        if gene is None:
            continue
        g = str(gene).strip()
        if not g:
            continue
        # 如果矩阵基因名类似 SYMBOL^ENSG，优先取 SYMBOL
        g = g.split('^')[0].strip()
        key = g.upper()
        if key not in seen:
            seen.add(key)
            cleaned.append(g)
    return cleaned


def get_combined_deg_gene_list(deg_df, p_threshold=FDR_THRESHOLD):
    """从实时DESeq2结果里提取合并后的显著差异基因。
    这里仍然保留差异分析和火山图原有逻辑，只是富集分析时不再拆成上调/下调。
    """
    if deg_df is None or len(deg_df) == 0:
        return [], [], []

    significant = deg_df[
        (deg_df['adj_p_value'].fillna(1) < p_threshold) &
        (deg_df['log2FC'].fillna(0).abs() > LOG2FC_THRESHOLD)
    ].copy()

    up_genes = significant[significant['log2FC'] > 0]['gene_symbol'].tolist()
    down_genes = significant[significant['log2FC'] < 0]['gene_symbol'].tolist()
    combined_genes = significant['gene_symbol'].tolist()

    return (
        normalize_gene_symbols(combined_genes),
        normalize_gene_symbols(up_genes),
        normalize_gene_symbols(down_genes)
    )


def get_combined_deg_gene_list_from_precomputed(precomputed):
    """从预计算DESeq2 JSON里提取合并后的显著差异基因。"""
    if not precomputed:
        return [], [], []

    up_genes = normalize_gene_symbols(precomputed.get('up_genes', []) or [])
    down_genes = normalize_gene_symbols(precomputed.get('down_genes', []) or [])

    # 兼容只有 up_table/down_table、没有 up_genes/down_genes 的缓存格式
    if not up_genes:
        up_genes = normalize_gene_symbols([row.get('gene') for row in precomputed.get('up_table', []) if isinstance(row, dict)])
    if not down_genes:
        down_genes = normalize_gene_symbols([row.get('gene') for row in precomputed.get('down_table', []) if isinstance(row, dict)])

    combined_genes = normalize_gene_symbols(up_genes + down_genes)
    return combined_genes, up_genes, down_genes


def write_r_enrichment_script():
    """写入R脚本。R脚本负责：
    1) SYMBOL -> ENTREZID；
    2) GO BP/MF/CC富集；
    3) KEGG富集：优先使用 msigdbr 的本地KEGG基因集，避免调用外部网站API；
       如果没有安装 msigdbr，则跳过KEGG，避免外部API调用。
    4) 每类结果输出 CSV、PNG、PDF。

    重要修复：
    - 不再调用 enrichplot::dotplot()，避免 ggplot2 4.x / S7 与 enrichplot/ggtree
      组合时出现 Incompatible methods ("Ops.S7_object", "+.gg") 的兼容性错误。
    - 富集结果仍由 clusterProfiler 计算，但气泡图改为 as.data.frame(enrichResult)
      后使用 ggplot2 手动画图。
    """
    r_code = r"""
args <- commandArgs(trailingOnly = TRUE)
if (length(args) < 3) {
  stop("Usage: Rscript run_go_kegg_enrichment.R <gene_file> <out_dir> <prefix>")
}

gene_file <- args[[1]]
out_dir <- args[[2]]
prefix <- args[[3]]
tmp_dir <- if (length(args) >= 4) args[[4]] else out_dir
dir.create(out_dir, showWarnings = FALSE, recursive = TRUE)
dir.create(tmp_dir, showWarnings = FALSE, recursive = TRUE)
log_step <- function(msg) {
  line <- paste0(format(Sys.time(), "%Y-%m-%d %H:%M:%S"), " | ", msg)
  cat(line, "\n")
}
log_step("R enrichment script started")
unlink(file.path(out_dir, "Rplots.pdf"), force = TRUE)

# 让网站调用 Rscript 时也能找到用户本地安装的 R 包。
# 优先使用环境变量 R_LIBS_USER；如果没有设置，兼容当前服务器的常用路径。
custom_lib <- Sys.getenv("R_LIBS_USER")
if (!identical(custom_lib, "") && dir.exists(custom_lib)) {
  .libPaths(unique(c(custom_lib, .libPaths())))
}
fallback_lib <- "/home/fenhuazu/R/library"
if (dir.exists(fallback_lib)) {
  .libPaths(unique(c(fallback_lib, .libPaths())))
}

# 注意：这里故意不加载 ggplot2/enrichplot/ggtree。
# 之前服务器上的 ggplot2 4.x + S7 会在“+”号拼图层时报
# Incompatible methods ("Ops.S7_object", "+.gg") for "+"。
# 因此富集计算仍用 clusterProfiler，绘图改成 base R，不再经过 ggplot2。
required_pkgs <- c("clusterProfiler", "org.Hs.eg.db", "AnnotationDbi")
missing_pkgs <- required_pkgs[!vapply(required_pkgs, requireNamespace, quietly = TRUE, FUN.VALUE = logical(1))]
if (length(missing_pkgs) > 0) {
  stop(paste0(
    "Missing R packages: ", paste(missing_pkgs, collapse = ", "),
    ". Current .libPaths(): ", paste(.libPaths(), collapse = " | "),
    ". Install with: if (!requireNamespace('BiocManager', quietly=TRUE)) install.packages('BiocManager'); ",
    "BiocManager::install(c('clusterProfiler','org.Hs.eg.db','AnnotationDbi'))"
  ))
}

suppressPackageStartupMessages({
  library(clusterProfiler)
  library(org.Hs.eg.db)
  library(AnnotationDbi)
})

genes <- unique(trimws(readLines(gene_file, warn = FALSE)))
genes <- genes[genes != ""]
if (length(genes) < 3) {
  stop("Too few genes for enrichment analysis")
}

gene_map <- tryCatch(
  clusterProfiler::bitr(
    genes,
    fromType = "SYMBOL",
    toType = c("ENTREZID", "SYMBOL"),
    OrgDb = org.Hs.eg.db
  ),
  error = function(e) data.frame()
)

if (nrow(gene_map) == 0) {
  stop("No gene symbols could be mapped to Entrez IDs. Please check gene symbols/species.")
}

entrez_ids <- unique(as.character(gene_map$ENTREZID))

ratio_to_num <- function(x) {
  if (length(x) == 0 || is.na(x) || x == "") return(NA_real_)
  parts <- strsplit(as.character(x), "/", fixed = TRUE)[[1]]
  if (length(parts) != 2) return(NA_real_)
  suppressWarnings(as.numeric(parts[[1]]) / as.numeric(parts[[2]]))
}

safe_numeric <- function(x, default = 1) {
  y <- suppressWarnings(as.numeric(x))
  y[is.na(y) | is.infinite(y)] <- default
  y
}

shorten_text <- function(x, max_chars = 70) {
  x <- as.character(x)
  ifelse(nchar(x) > max_chars, paste0(substr(x, 1, max_chars - 3), "..."), x)
}

save_empty_result <- function(key) {
  invisible(FALSE)
}

draw_base_dotplot <- function(plot_df, out_file, title, device = c("png", "pdf")) {
  device <- match.arg(device)
  n <- nrow(plot_df)
  if (n == 0) return(FALSE)

  # 反转顺序，让最显著条目显示在上方
  plot_df <- plot_df[rev(seq_len(n)), , drop = FALSE]
  y <- seq_len(n)
  x <- plot_df$GeneRatioNum
  x[is.na(x) | is.infinite(x)] <- 0
  count <- plot_df$Count
  neglog <- plot_df$NegLog10Padj

  scale_small_n <- if (n <= 4) 1.55 else if (n <= 8) 1.30 else if (n <= 12) 1.10 else 1.0
  label_cex <- if (n <= 4) 1.25 else if (n <= 8) 1.05 else if (n <= 12) 0.90 else 0.76
  axis_cex <- if (n <= 4) 1.25 else if (n <= 8) 1.12 else if (n <= 12) 1.00 else 0.90
  title_cex <- if (n <= 4) 1.45 else if (n <= 8) 1.32 else 1.20
  legend_cex <- if (n <= 4) 1.05 else if (n <= 8) 0.95 else 0.82
  point_cex <- (1.4 + 3.4 * (count - min(count, na.rm = TRUE)) / (max(count, na.rm = TRUE) - min(count, na.rm = TRUE) + 1e-9)) * scale_small_n
  pal <- grDevices::colorRampPalette(c("#3b82f6", "#a855f7", "#ef4444"))(100)
  col_idx <- floor(1 + 99 * (neglog - min(neglog, na.rm = TRUE)) / (max(neglog, na.rm = TRUE) - min(neglog, na.rm = TRUE) + 1e-9))
  col_idx[col_idx < 1] <- 1
  col_idx[col_idx > 100] <- 100
  point_col <- pal[col_idx]

  label <- shorten_text(plot_df$Description, if (n <= 6) 92 else 72)
  max_x <- max(x, na.rm = TRUE)
  if (!is.finite(max_x) || max_x <= 0) max_x <- 1

  if (device == "png") {
    grDevices::png(out_file, width = 1600, height = max(1050, 300 + n * 135), res = 170, bg = "white")
  } else {
    grDevices::pdf(out_file, width = 10.2, height = max(6.6, 2.8 + n * 0.52), onefile = FALSE)
  }
  on.exit(grDevices::dev.off(), add = TRUE)

  oldpar <- graphics::par(no.readonly = TRUE)
  on.exit(graphics::par(oldpar), add = TRUE)

  graphics::par(mar = c(5.8, if (n <= 6) 18.5 else 15.5, 5.2, 7.0), xpd = FALSE)
  graphics::plot(
    x, y,
    xlim = c(0, max_x * 1.12),
    ylim = c(0.5, n + 0.5),
    yaxt = "n",
    xlab = "Gene Ratio",
    ylab = "",
    main = title,
    pch = 21,
    bg = point_col,
    col = "white",
    cex = point_cex,
    lwd = 0.8,
    las = 1,
    bty = "l",
    cex.axis = axis_cex,
    cex.lab = axis_cex,
    cex.main = title_cex
  )
  graphics::grid(nx = NA, ny = NULL, col = "grey88", lty = "dotted")
  graphics::points(x, y, pch = 21, bg = point_col, col = "white", cex = point_cex, lwd = 0.8)
  graphics::axis(2, at = y, labels = label, las = 1, tick = FALSE, cex.axis = label_cex)

  # 颜色图例
  graphics::par(xpd = TRUE)
  legend_x <- max_x * 1.18
  legend_y <- n
  legend_vals <- pretty(neglog, n = 4)
  legend_vals <- legend_vals[is.finite(legend_vals)]
  if (length(legend_vals) > 0) {
    legend_cols <- pal[pmax(1, pmin(100, floor(1 + 99 * (legend_vals - min(neglog, na.rm = TRUE)) / (max(neglog, na.rm = TRUE) - min(neglog, na.rm = TRUE) + 1e-9))))]
    graphics::legend(
      legend_x, legend_y,
      legend = format(round(legend_vals, 2), trim = TRUE),
      pt.bg = legend_cols,
      pch = 21,
      pt.cex = 1.4,
      bty = "n",
      title = "-log10(FDR)",
      cex = legend_cex
    )
  }

  # 点大小图例：用分位数/范围点，并增大垂直间距，避免重叠
  count_vals <- unique(round(c(min(count, na.rm = TRUE), stats::quantile(count, probs = c(0.5, 0.8, 1), na.rm = TRUE))))
  count_vals <- sort(unique(count_vals[count_vals > 0]))
  if (length(count_vals) > 0) {
    count_cex <- 1.0 + 2.2 * (count_vals - min(count, na.rm = TRUE)) / (max(count, na.rm = TRUE) - min(count, na.rm = TRUE) + 1e-9)
    graphics::legend(
      legend_x, max(1, n - 6.2),
      legend = count_vals,
      pch = 21,
      pt.bg = "grey70",
      col = "white",
      pt.cex = count_cex,
      bty = "n",
      title = "Count",
      cex = legend_cex,
      y.intersp = 1.8,
      x.intersp = 0.8
    )
  }
  graphics::par(xpd = FALSE)
  return(TRUE)
}

save_enrichment_result <- function(enrich_obj, key, title) {
  out_csv <- file.path(tmp_dir, paste0(prefix, "_", key, ".csv"))
  out_png <- file.path(tmp_dir, paste0(prefix, "_", key, ".png"))
  out_pdf <- file.path(out_dir, paste0(prefix, "_", key, ".pdf"))

  ok <- tryCatch({
    if (is.null(enrich_obj)) {
      save_empty_result(key)
      return(FALSE)
    }

    df <- tryCatch(as.data.frame(enrich_obj), error = function(e) data.frame())
    if (nrow(df) == 0) {
      save_empty_result(key)
      return(FALSE)
    }

    # 兼容 clusterProfiler 输出列。前端会继续读取 CSV，所以这里尽量保留完整结果。
    if (!"GeneRatio" %in% colnames(df)) df$GeneRatio <- NA_character_
    if (!"Count" %in% colnames(df)) df$Count <- 1
    if (!"p.adjust" %in% colnames(df)) {
      if ("qvalue" %in% colnames(df)) {
        df$p.adjust <- df$qvalue
      } else if ("pvalue" %in% colnames(df)) {
        df$p.adjust <- df$pvalue
      } else {
        df$p.adjust <- 1
      }
    }
    if (!"Description" %in% colnames(df)) {
      if ("ID" %in% colnames(df)) {
        df$Description <- df$ID
      } else {
        df$Description <- paste0("Term_", seq_len(nrow(df)))
      }
    }

    df$GeneRatioNum <- vapply(df$GeneRatio, ratio_to_num, numeric(1))
    df$GeneRatioNum[is.na(df$GeneRatioNum) | is.infinite(df$GeneRatioNum)] <- 0
    df$Count <- safe_numeric(df$Count, default = 1)
    df$p.adjust <- safe_numeric(df$p.adjust, default = 1)
    df$NegLog10Padj <- -log10(pmax(df$p.adjust, 1e-300))

    # 按 Count 从高到低排序；Count 相同时再按 FDR 从小到大排序。
    df <- df[order(-df$Count, df$p.adjust), , drop = FALSE]
    tryCatch(write.csv(df, out_csv, row.names = FALSE), error = function(e) {
      message("write csv failed for ", key, ": ", conditionMessage(e))
    })

    show_n <- min(20, nrow(df))
    plot_df <- head(df, show_n)
    if (nrow(plot_df) == 0) return(FALSE)

    png_ok <- draw_base_dotplot(plot_df, out_png, title, device = "png")
    pdf_ok <- draw_base_dotplot(plot_df, out_pdf, title, device = "pdf")
    return(isTRUE(pdf_ok) && isTRUE(png_ok) && file.exists(out_pdf))
  }, error = function(e) {
    message("save_enrichment_result failed for ", key, ": ", conditionMessage(e))
    FALSE
  })

  return(ok)
}

run_go <- function(ont) {
  tryCatch(
    clusterProfiler::enrichGO(
      gene = entrez_ids,
      OrgDb = org.Hs.eg.db,
      keyType = "ENTREZID",
      ont = ont,
      pAdjustMethod = "BH",
      pvalueCutoff = 0.05,
      qvalueCutoff = 0.20,
      readable = TRUE
    ),
    error = function(e) {
      message("enrichGO failed for ", ont, ": ", conditionMessage(e))
      NULL
    }
  )
}

log_step("GO BP started")
go_bp <- run_go("BP")
log_step("GO MF started")
go_mf <- run_go("MF")
log_step("GO CC started")
go_cc <- run_go("CC")

log_step("Saving GO BP")
save_enrichment_result(go_bp, "go_bp", "GO Biological Process")
log_step("Saving GO MF")
save_enrichment_result(go_mf, "go_mf", "GO Molecular Function")
log_step("Saving GO CC")
save_enrichment_result(go_cc, "go_cc", "GO Cellular Component")
log_step("GO outputs saved")

# KEGG: prefer a local pathway-gene cache. If the cache does not exist, create
# it once from KEGGREST; future analyses run offline from CSV files.
kegg_obj <- NULL
kegg_source <- "local KEGG cache"
save_empty_result("kegg")

normalize_kegg_cache <- function(links, names_vec) {
  left <- names(links)
  right <- unname(links)
  term <- ifelse(grepl("path:", left), left, right)
  gene <- ifelse(grepl("^hsa:", left), left, right)
  term <- sub("^path:", "", term)
  gene <- sub("^hsa:", "", gene)
  term2gene <- unique(data.frame(term = as.character(term), gene = as.character(gene)))
  term2gene <- term2gene[grepl("^hsa[0-9]+$", term2gene$term) & grepl("^[0-9]+$", term2gene$gene), , drop = FALSE]

  term_ids <- sub("^path:", "", names(names_vec))
  term_names <- sub(" - Homo sapiens \\(human\\)$", "", as.character(names_vec))
  term2name <- unique(data.frame(term = as.character(term_ids), name = as.character(term_names)))
  term2name <- term2name[grepl("^hsa[0-9]+$", term2name$term), , drop = FALSE]
  list(term2gene = term2gene, term2name = term2name)
}

load_or_create_kegg_cache <- function() {
  cache_dir <- file.path(dirname(out_dir), "kegg_cache")
  dir.create(cache_dir, showWarnings = FALSE, recursive = TRUE)
  term2gene_file <- file.path(cache_dir, "hsa_kegg_term2gene.csv")
  term2name_file <- file.path(cache_dir, "hsa_kegg_term2name.csv")

  if (file.exists(term2gene_file) && file.exists(term2name_file)) {
    term2gene <- read.csv(term2gene_file, stringsAsFactors = FALSE)
    term2name <- read.csv(term2name_file, stringsAsFactors = FALSE)
    if (nrow(term2gene) > 0 && nrow(term2name) > 0) {
      log_step(paste0("Using local KEGG cache: TERM2GENE rows=", nrow(term2gene)))
      return(list(term2gene = term2gene, term2name = term2name, source = "local KEGG cache"))
    }
  }

  if (!requireNamespace("KEGGREST", quietly = TRUE)) {
    stop("KEGGREST is not installed and local KEGG cache is missing")
  }

  old_timeout <- getOption("timeout")
  options(timeout = max(120, old_timeout))
  on.exit(options(timeout = old_timeout), add = TRUE)

  last_error <- NULL
  for (attempt in seq_len(5)) {
    log_step(paste0("Creating KEGG cache from KEGGREST attempt ", attempt))
    cache <- tryCatch({
      links <- KEGGREST::keggLink("pathway", "hsa")
      names_vec <- KEGGREST::keggList("pathway", "hsa")
      normalize_kegg_cache(links, names_vec)
    }, error = function(e) {
      last_error <<- conditionMessage(e)
      NULL
    })

    if (!is.null(cache) && nrow(cache$term2gene) > 0 && nrow(cache$term2name) > 0) {
      write.csv(cache$term2gene, term2gene_file, row.names = FALSE)
      write.csv(cache$term2name, term2name_file, row.names = FALSE)
      log_step(paste0("KEGG cache created: TERM2GENE rows=", nrow(cache$term2gene)))
      cache$source <- "KEGGREST-created local KEGG cache"
      return(cache)
    }
    Sys.sleep(2 * attempt)
  }

  stop(paste0("Could not create KEGG cache from KEGGREST: ", last_error))
}

log_step("KEGG local cache enrichment started")
kegg_cache <- tryCatch(load_or_create_kegg_cache(), error = function(e) {
  kegg_source <<- paste0("KEGG cache unavailable: ", conditionMessage(e))
  message(kegg_source)
  NULL
})

if (!is.null(kegg_cache)) {
  kegg_source <- kegg_cache$source
  kegg_obj <- tryCatch(
    clusterProfiler::enricher(
      gene = entrez_ids,
      TERM2GENE = kegg_cache$term2gene,
      TERM2NAME = kegg_cache$term2name,
      pAdjustMethod = "BH",
      pvalueCutoff = 0.2,
      qvalueCutoff = 0.2,
      minGSSize = 5
    ),
    error = function(e) {
      kegg_source <<- paste0("local KEGG enricher failed: ", conditionMessage(e))
      message(kegg_source)
      NULL
    }
  )
}

if (!is.null(kegg_obj) && nrow(as.data.frame(kegg_obj)) > 0) {
  kegg_source <- paste0(kegg_source, "; enriched terms=", nrow(as.data.frame(kegg_obj)))
  log_step(kegg_source)
} else if (is.null(kegg_obj)) {
  log_step(kegg_source)
} else {
  kegg_source <- paste0(kegg_source, "; no enriched term passed cutoff")
  log_step(kegg_source)
}

log_step("Saving KEGG output")
save_enrichment_result(kegg_obj, "kegg", "KEGG Pathway")
log_step("R enrichment script finished")

meta <- data.frame(
  input_gene_count = length(genes),
  mapped_gene_count = length(entrez_ids),
  kegg_source = kegg_source,
  plot_engine = "base R graphics; no ggplot2/enrichplot dotplot",
  stringsAsFactors = FALSE
)
unlink(file.path(out_dir, "Rplots.pdf"), force = TRUE)
"""
    with open(R_ENRICHMENT_SCRIPT, 'w', encoding='utf-8') as f:
        f.write(r_code)
    return R_ENRICHMENT_SCRIPT


def parse_gene_ratio(ratio):
    """解析 R 输出中的 GeneRatio，如 3/50 -> 0.06。"""
    try:
        if ratio is None or pd.isna(ratio):
            return 0
        parts = str(ratio).split('/')
        if len(parts) == 2:
            return round(float(parts[0]) / float(parts[1]), 4)
    except Exception:
        pass
    return 0


def safe_float(value, default=1.0, min_value=None):
    """把p值等字段安全转换成JSON可序列化float。"""
    try:
        if value is None or pd.isna(value):
            return float(default)
        x = float(value)
        if not np.isfinite(x):
            return float(default)
        if min_value is not None and x < min_value:
            return float(min_value)
        return x
    except Exception:
        return float(default)


def read_r_enrichment_csv(csv_path, max_terms=20):
    """读取 R 输出的富集结果CSV，转成前端展示结构。"""
    if not os.path.exists(csv_path):
        return []

    try:
        df = pd.read_csv(csv_path)
    except Exception:
        return []

    if df is None or len(df) == 0:
        return []

    rows = []
    sort_col = 'p.adjust' if 'p.adjust' in df.columns else None
    if sort_col:
        df = df.sort_values(sort_col)
    df = df.head(max_terms)

    for _, row in df.iterrows():
        adj_p = safe_float(row.get('p.adjust', row.get('p_adjust', 1)), default=1.0, min_value=1e-300)
        p_val = safe_float(row.get('pvalue', row.get('p_value', adj_p)), default=adj_p, min_value=1e-300)
        gene_id = str(row.get('geneID', '') or '')
        genes = [g for g in gene_id.replace(';', '/').split('/') if g]

        rows.append({
            'id': str(row.get('ID', '') or ''),
            'term': str(row.get('Description', row.get('ID', '')) or ''),
            'term_full': str(row.get('Description', row.get('ID', '')) or ''),
            'gene_ratio': parse_gene_ratio(row.get('GeneRatio', '')),
            'gene_ratio_label': str(row.get('GeneRatio', '') or ''),
            'bg_ratio': str(row.get('BgRatio', '') or ''),
            'p_value': p_val,
            'adj_p_value': adj_p,
            'neg_log10_padj': round(-np.log10(adj_p + 1e-300), 2),
            'q_value': safe_float(row.get('qvalue', adj_p), default=adj_p, min_value=1e-300),
            'genes': genes,
            'gene_count': int(row.get('Count', len(genes)) or len(genes))
        })

    return rows


def build_file_url(filename):
    """生成给前端使用的静态文件URL。"""
    return f"/api/transcriptome/enrichment/files/{filename}"


def cleanup_result_dir_non_pdfs(prefix=None):
    """Keep r_enrichment_results as the final PDF-only artifact directory."""
    try:
        for name in os.listdir(R_ENRICHMENT_DIR):
            path = os.path.join(R_ENRICHMENT_DIR, name)
            if not os.path.isfile(path):
                continue
            if prefix and not name.startswith(prefix):
                continue
            if not name.lower().endswith('.pdf') or name == 'Rplots.pdf':
                try:
                    os.remove(path)
                except OSError:
                    pass
    except Exception as e:
        print(f"[R Enrichment] cleanup failed: {e}")


def collect_r_enrichment_outputs(prefix):
    """整理 R 输出 PDF，返回前端展示结构。"""
    plot_titles = {
        'go_bp': 'GO Biological Process',
        'go_mf': 'GO Molecular Function',
        'go_cc': 'GO Cellular Component',
        'kegg': 'KEGG Pathway'
    }

    results = {}
    for key, title in plot_titles.items():
        png_name = f"{prefix}_{key}.png"
        pdf_name = f"{prefix}_{key}.pdf"
        csv_name = f"{prefix}_{key}.csv"

        png_path = os.path.join(R_ENRICHMENT_TMP_DIR, png_name)
        pdf_path = os.path.join(R_ENRICHMENT_DIR, pdf_name)
        csv_path = os.path.join(R_ENRICHMENT_TMP_DIR, csv_name)
        terms = read_r_enrichment_csv(csv_path)

        results[key] = {
            'title': title,
            'available': bool(os.path.exists(pdf_path) and len(terms) > 0),
            'png_url': build_file_url(png_name) if os.path.exists(png_path) else None,
            'pdf_url': build_file_url(pdf_name) if os.path.exists(pdf_path) else None,
            'csv_url': None,
            'terms': terms
        }

    return {
        'plots': results,
        'meta': {}
    }


def is_r_enrichment_cache_complete(prefix):
    """Return True only when cached outputs are usable for the enrichment page."""
    return all(
        os.path.exists(os.path.join(R_ENRICHMENT_DIR, f"{prefix}_{key}.pdf")) and
        os.path.exists(os.path.join(R_ENRICHMENT_TMP_DIR, f"{prefix}_{key}.csv"))
        for key in ['go_bp', 'go_mf', 'go_cc', 'kegg']
    )


def has_go_enrichment_outputs(prefix):
    """GO outputs are enough to render a useful partial enrichment page."""
    for key in ['go_bp', 'go_mf', 'go_cc']:
        pdf_path = os.path.join(R_ENRICHMENT_DIR, f"{prefix}_{key}.pdf")
        png_path = os.path.join(R_ENRICHMENT_TMP_DIR, f"{prefix}_{key}.png")
        csv_path = os.path.join(R_ENRICHMENT_TMP_DIR, f"{prefix}_{key}.csv")
        if os.path.exists(pdf_path) and os.path.exists(png_path) and os.path.exists(csv_path):
            return True
    return False


def run_r_enrichment_background(prefix, cmd, r_env):
    """Best-effort KEGG retry without blocking the current web request."""
    with _r_enrichment_jobs_lock:
        if prefix in _r_enrichment_jobs:
            return False
        _r_enrichment_jobs.add(prefix)

    def worker():
        try:
            print(f"[R Enrichment] 后台重试: {' '.join(cmd)}")
            completed = subprocess.run(
                cmd,
                cwd=R_ENRICHMENT_DIR,
                capture_output=True,
                text=True,
                timeout=R_ENRICHMENT_TIMEOUT_SECONDS,
                env=r_env
            )
            log_path = os.path.join(R_ENRICHMENT_TMP_DIR, f"{prefix}_last_background.log")
            with open(log_path, 'w', encoding='utf-8') as f:
                f.write("returncode=" + str(completed.returncode) + "\n\n")
                f.write("[stdout]\n")
                f.write(completed.stdout or "")
                f.write("\n\n[stderr]\n")
                f.write(completed.stderr or "")
            if completed.returncode != 0:
                print(f"[R Enrichment] 后台重试失败: {completed.stderr[-1000:] if completed.stderr else completed.returncode}")
            else:
                cleanup_result_dir_non_pdfs(prefix)
                print("[R Enrichment] 后台重试完成")
        except subprocess.TimeoutExpired as e:
            log_path = os.path.join(R_ENRICHMENT_TMP_DIR, f"{prefix}_last_background.log")
            with open(log_path, 'w', encoding='utf-8') as f:
                f.write("timeout\n\n[stdout]\n")
                f.write((e.stdout or '') if isinstance(e.stdout, str) else str(e.stdout or ''))
                f.write("\n\n[stderr]\n")
                f.write((e.stderr or '') if isinstance(e.stderr, str) else str(e.stderr or ''))
            print(f"[R Enrichment] 后台重试超时，日志: {log_path}")
        finally:
            with _r_enrichment_jobs_lock:
                _r_enrichment_jobs.discard(prefix)

    threading.Thread(target=worker, daemon=True).start()
    return True


def perform_r_enrichment_analysis(gene_list, fusion_name, force_rerun=False):
    """调用R完成合并差异基因的GO/KEGG富集和绘图。"""
    genes = normalize_gene_symbols(gene_list)
    if len(genes) < 3:
        return {
            'status': 'skipped',
            'message': f'可用于富集分析的显著差异基因太少：{len(genes)}',
            'plots': {},
            'meta': {'input_gene_count': len(genes)}
        }

    if not RSCRIPT_PATH:
        return {
            'status': 'error',
            'message': '服务器未检测到 Rscript。请安装 R，并确认 Rscript 在 PATH 中，或设置环境变量 RSCRIPT_PATH。',
            'plots': {},
            'meta': {'input_gene_count': len(genes)}
        }

    write_r_enrichment_script()

    gene_hash = hashlib.md5('\n'.join(sorted([g.upper() for g in genes])).encode('utf-8')).hexdigest()[:12]
    prefix = f"{safe_fusion_name(fusion_name)}_combined_{gene_hash}"

    gene_file = os.path.join(R_ENRICHMENT_TMP_DIR, f"{prefix}_genes.txt")
    with open(gene_file, 'w', encoding='utf-8') as f:
        f.write('\n'.join(genes) + '\n')

    cmd = build_rscript_cmd(R_ENRICHMENT_SCRIPT, [gene_file, R_ENRICHMENT_DIR, prefix, R_ENRICHMENT_TMP_DIR])
    r_env = os.environ.copy()
    if R_LIBS_USER:
        r_env['R_LIBS_USER'] = R_LIBS_USER

    if not force_rerun and has_go_enrichment_outputs(prefix) and not is_r_enrichment_cache_complete(prefix):
        started = run_r_enrichment_background(prefix, cmd, r_env)
        outputs = collect_r_enrichment_outputs(prefix)
        outputs.update({
            'status': 'partial',
            'message': 'GO结果已生成并先返回；KEGG仍在后台重试，完成后刷新页面即可显示KEGG图。',
            'method': 'R clusterProfiler/enrichGO; KEGG background retry',
            'prefix': prefix,
            'input_gene_count': len(genes),
            'genes': genes[:500],
            'background_kegg_running': started or prefix in _r_enrichment_jobs
        })
        return outputs

    if force_rerun or not is_r_enrichment_cache_complete(prefix):
        print(f"[R Enrichment] 运行命令: {' '.join(cmd)}")

        try:
            completed = subprocess.run(
                cmd,
                cwd=R_ENRICHMENT_DIR,
                capture_output=True,
                text=True,
                timeout=R_ENRICHMENT_TIMEOUT_SECONDS,
                env=r_env
            )
        except subprocess.TimeoutExpired:
            timeout_message = (
                f'R富集分析超过 {R_ENRICHMENT_TIMEOUT_SECONDS} 秒。'
                '通常是 KEGG/msigdbr 基因集加载或计算过慢导致；'
                '已返回已经生成的 GO 结果，KEGG 本次标记为不可用。'
            )
            print(f"[R Enrichment] timeout: {timeout_message}")

            # Cache a minimal marker so the next request can reuse completed GO files
            # instead of repeatedly rerunning and timing out at KEGG.
            outputs = collect_r_enrichment_outputs(prefix)
            outputs.update({
                'status': 'partial',
                'message': timeout_message,
                'method': 'R clusterProfiler/enrichGO; KEGG best-effort',
                'prefix': prefix,
                'input_gene_count': len(genes),
                'genes': genes[:500]
            })
            return outputs

        if completed.returncode != 0:
            print("[R Enrichment] ❌ Rscript stderr:")
            print(completed.stderr)
            print("[R Enrichment] stdout:")
            print(completed.stdout)
            return {
                'status': 'error',
                'message': completed.stderr[-2000:] if completed.stderr else 'Rscript运行失败',
                'plots': {},
                'meta': {'input_gene_count': len(genes)}
            }

        print("[R Enrichment] ✅ Rscript完成")
        cleanup_result_dir_non_pdfs(prefix)
        if completed.stdout:
            print(completed.stdout[-1000:])

    outputs = collect_r_enrichment_outputs(prefix)
    outputs.update({
        'status': 'success',
        'method': 'R clusterProfiler/enrichGO + msigdbr KEGG; plotted by base R graphics',
        'prefix': prefix,
        'input_gene_count': len(genes),
        'genes': genes[:500]
    })
    return outputs


# ==================== API 路由 ====================

@transcriptome_bp.route('/expression/<fusion_name>', methods=['GET'])
@jwt_required(optional=True)
def get_expression_data(fusion_name):
    """获取融合基因表达量对比数据（使用TPM数据）"""
    try:
        print(f"\n[API] ========== 表达量分析: {fusion_name} ==========")
        
        # 🔥 使用 Fusion 表
        fusion = Fusion.query.filter(Fusion.fusion_name == fusion_name).first()
        if not fusion:
            return jsonify({'code': 404, 'message': f'未找到融合: {fusion_name}'}), 404
        
        left_gene = fusion.left_gene or 'Unknown'
        right_gene = fusion.right_gene or 'Unknown'
        inframe_count = Fusion.query.filter(
            Fusion.fusion_name == fusion_name,
            Fusion.prot_fusion_type.ilike('INFRAME')
        ).count()
        
        print(f"[API] 左侧基因: {left_gene}, 右侧基因: {right_gene}")
        
        expression_df = load_expression_matrix()
        fusion_samples = get_samples_with_fusion(fusion_name)
        
        left_expr = None
        right_expr = None
        is_real_data = False
        
        if expression_df is not None and len(fusion_samples) > 0:
            left_expr = calculate_real_expression(left_gene, fusion_samples, expression_df)
            right_expr = calculate_real_expression(right_gene, fusion_samples, expression_df)
            is_real_data = left_expr is not None or right_expr is not None
        
        return jsonify({
            'code': 200,
            'message': 'success',
            'data': {
                'fusion_name': fusion_name,
                'left_gene': left_gene,
                'right_gene': right_gene,
                'left_gene_expression': left_expr,
                'right_gene_expression': right_expr,
                'total_fusion_positive_samples': len(fusion_samples),
                'fusion_info': {
                    'prot_fusion_type': getattr(fusion, 'prot_fusion_type', None),
                    'avg_ffpm': getattr(fusion, 'avg_ffpm', None),
                    'inframe_count': inframe_count
                },
                'is_real_data': is_real_data,
                'data_source': 'normalized.all.count (TPM)'
            }
        }), 200
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'code': 500, 'message': str(e)}), 500


@transcriptome_bp.route('/differential/<fusion_name>', methods=['GET'])
@jwt_required(optional=True)
def get_differential_data(fusion_name):
    """获取差异表达分析数据（使用count数据 + DESeq2）"""
    try:
        print(f"\n[API] ========== 差异分析: {fusion_name} ==========")
        
        # 🔥 使用 Fusion 表
        fusion = Fusion.query.filter(Fusion.fusion_name == fusion_name).first()
        if not fusion:
            return jsonify({'code': 404, 'message': f'未找到融合: {fusion_name}'}), 404
        
        # ✅ 优先读取预计算DESeq2结果；如果存在，就不再现场跑DESeq2
        precomputed = load_precomputed_deseq(fusion_name)
        if precomputed is not None:
            return jsonify({
                'code': 200,
                'message': 'success',
                'data': precomputed
            }), 200

        count_df = load_count_matrix()
        if count_df is None:
            return jsonify({'code': 500, 'message': '无法加载count矩阵'}), 500
        
        fusion_samples = get_samples_with_fusion(fusion_name)
        positive_samples = match_sample_names(fusion_samples, count_df.columns)
        all_samples = list(count_df.columns)
        negative_samples = [s for s in all_samples if s not in positive_samples]
        
        print(f"[API] 阳性样本: {len(positive_samples)}, 阴性样本: {len(negative_samples)}")
        
        if len(positive_samples) < 2:
            return jsonify({
                'code': 400,
                'message': f'融合阳性样本太少 ({len(positive_samples)}), 至少需要2个'
            }), 400
        
        deg_df = perform_deseq2_analysis(count_df, positive_samples, negative_samples)
        
        if deg_df is None:
            return jsonify({'code': 500, 'message': '差异分析失败'}), 500
        
        # 上调基因前100
        up_df = deg_df[deg_df['direction'] == 'up'].sort_values('log2FC', ascending=False).head(100)
        up_table = []
        for _, row in up_df.iterrows():
            up_table.append({
                'gene': row['gene_symbol'],
                'gene_full': row['gene'],
                'log2FC': round(float(row['log2FC']), 4),
                'p_value': float(row['p_value']) if 'p_value' in row and not pd.isna(row['p_value']) else 1,
                'adj_p_value': float(row['adj_p_value']) if not pd.isna(row['adj_p_value']) else 1,
                'base_mean': float(row['base_mean']) if 'base_mean' in row and not pd.isna(row['base_mean']) else 0,
                'direction': 'up'
            })
        
        # 下调基因前100
        down_df = deg_df[deg_df['direction'] == 'down'].sort_values('log2FC', ascending=True).head(100)
        down_table = []
        for _, row in down_df.iterrows():
            down_table.append({
                'gene': row['gene_symbol'],
                'gene_full': row['gene'],
                'log2FC': round(float(row['log2FC']), 4),
                'p_value': float(row['p_value']) if 'p_value' in row and not pd.isna(row['p_value']) else 1,
                'adj_p_value': float(row['adj_p_value']) if not pd.isna(row['adj_p_value']) else 1,
                'base_mean': float(row['base_mean']) if 'base_mean' in row and not pd.isna(row['base_mean']) else 0,
                'direction': 'down'
            })
        
        # 火山图数据
        volcano_data = []
        for _, row in deg_df.iterrows():
            adj_p = row['adj_p_value'] if not pd.isna(row['adj_p_value']) else 1
            volcano_data.append({
                'gene': row['gene_symbol'],
                'log2FC': round(float(row['log2FC']), 4),
                'neg_log10_pval': round(-np.log10(adj_p + 1e-10), 2),
                'significant': bool(row['significant']) if not pd.isna(row['significant']) else False,
                'direction': row['direction']
            })
        
        # 🔥 只取 p < 0.05 的基因做富集分析
        up_genes, down_genes = get_deg_gene_lists(deg_df, p_threshold=0.05)
        
        return jsonify({
            'code': 200,
            'message': 'success',
            'data': {
                'fusion_name': fusion_name,
                'method': 'DESeq2' if HAS_PYDESEQ2 else 'Simple DEG',
                'parameters': {
                    'log2fc_threshold': LOG2FC_THRESHOLD,
                    'fdr_threshold': FDR_THRESHOLD
                },
                'sample_info': {
                    'positive_count': len(positive_samples),
                    'negative_count': len(negative_samples),
                    'positive_samples': positive_samples[:20]
                },
                'summary': {
                    'total_genes_tested': len(deg_df),
                    'up_regulated': len(up_genes),
                    'down_regulated': len(down_genes)
                },
                'up_genes': up_genes,
                'down_genes': down_genes,
                'up_table': up_table,
                'down_table': down_table,
                'volcano_data': volcano_data
            }
        }), 200
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'code': 500, 'message': str(e)}), 500


@transcriptome_bp.route('/enrichment/files/<path:filename>', methods=['GET'])
@jwt_required(optional=True)
def serve_enrichment_file(filename):
    """提供R生成的富集分析PNG/PDF/CSV文件给前端展示和下载。"""
    try:
        # 只允许访问本目录下的基础文件名，避免路径穿越
        safe_name = os.path.basename(filename)
        if safe_name.lower().endswith('.png'):
            return send_from_directory(R_ENRICHMENT_TMP_DIR, safe_name, as_attachment=False)
        return send_from_directory(R_ENRICHMENT_DIR, safe_name, as_attachment=False)
    except Exception as e:
        traceback.print_exc()
        return jsonify({'code': 404, 'message': str(e)}), 404


@transcriptome_bp.route('/enrichment/<fusion_name>', methods=['GET'])
@jwt_required(optional=True)
def get_enrichment_data(fusion_name):
    """基于合并后的显著差异基因，调用本地R进行GO/KEGG富集分析并绘图。"""
    try:
        print(f"\n[API] ========== R富集分析: {fusion_name} ==========")

        fusion = Fusion.query.filter(Fusion.fusion_name == fusion_name).first()
        if not fusion:
            return jsonify({'code': 404, 'message': f'未找到融合: {fusion_name}'}), 404

        total_tested = 0
        combined_genes = []
        up_genes = []
        down_genes = []
        source_note = ''

        # 1) 优先使用预计算DESeq2结果，避免富集页再次跑DESeq2
        precomputed = load_precomputed_deseq(fusion_name)
        if precomputed is not None:
            combined_genes, up_genes, down_genes = get_combined_deg_gene_list_from_precomputed(precomputed)
            summary = precomputed.get('summary', {}) or {}
            total_tested = summary.get('total_genes_tested', 0)
            source_note = 'Precomputed DESeq2 + local R clusterProfiler'
            print(f"[API] 使用预计算DESeq2做合并富集: combined={len(combined_genes)}, up={len(up_genes)}, down={len(down_genes)}")

        # 2) 没有预计算时，沿用原来的DESeq2差异分析逻辑实时计算
        else:
            count_df = load_count_matrix()
            if count_df is None:
                return jsonify({
                    'code': 200,
                    'message': 'success',
                    'data': {
                        'fusion_name': fusion_name,
                        'left_gene': fusion.left_gene,
                        'right_gene': fusion.right_gene,
                        'error': '无法加载count矩阵',
                        'deg_summary': {
                            'total_tested': 0,
                            'combined_count': 0,
                            'up_count': 0,
                            'down_count': 0,
                            'combined_genes': []
                        },
                        'combined_enrichment': {'status': 'error', 'message': '无法加载count矩阵', 'plots': {}},
                        'is_real_data': False,
                        'source': 'local R clusterProfiler'
                    }
                }), 200

            fusion_samples = get_samples_with_fusion(fusion_name)
            positive_samples = match_sample_names(fusion_samples, count_df.columns)
            all_samples = list(count_df.columns)
            negative_samples = [s for s in all_samples if s not in positive_samples]

            deg_df = perform_deseq2_analysis(count_df, positive_samples, negative_samples)
            if deg_df is None:
                return jsonify({
                    'code': 200,
                    'message': 'success',
                    'data': {
                        'fusion_name': fusion_name,
                        'left_gene': fusion.left_gene,
                        'right_gene': fusion.right_gene,
                        'error': '差异分析失败',
                        'deg_summary': {
                            'total_tested': 0,
                            'combined_count': 0,
                            'up_count': 0,
                            'down_count': 0,
                            'combined_genes': []
                        },
                        'combined_enrichment': {'status': 'error', 'message': '差异分析失败', 'plots': {}},
                        'is_real_data': False,
                        'source': 'local R clusterProfiler'
                    }
                }), 200

            combined_genes, up_genes, down_genes = get_combined_deg_gene_list(deg_df, p_threshold=FDR_THRESHOLD)
            total_tested = len(deg_df)
            source_note = 'Real-time DESeq2 + local R clusterProfiler'
            print(f"[API] 实时DESeq2做合并富集: combined={len(combined_genes)}, up={len(up_genes)}, down={len(down_genes)}")

        # 3) 只把合并后的差异基因送入R做GO/KEGG
        force_rerun = str(request.args.get('refresh', '')).strip().lower() in ('1', 'true', 'yes')
        r_enrichment = perform_r_enrichment_analysis(combined_genes, fusion_name, force_rerun=force_rerun)

        return jsonify({
            'code': 200,
            'message': 'success',
            'data': {
                'fusion_name': fusion_name,
                'left_gene': fusion.left_gene,
                'right_gene': fusion.right_gene,
                'deg_summary': {
                    'total_tested': total_tested,
                    'combined_count': len(combined_genes),
                    'up_count': len(up_genes),
                    'down_count': len(down_genes),
                    'combined_genes': combined_genes[:500],
                    'up_genes': up_genes[:100],
                    'down_genes': down_genes[:100]
                },
                'combined_enrichment': r_enrichment,
                'parameters': {
                    'log2fc_threshold': LOG2FC_THRESHOLD,
                    'fdr_threshold': FDR_THRESHOLD,
                    'enrichment_p_threshold': 0.05,
                    'mode': 'combined_up_and_down_genes'
                },
                'is_real_data': True,
                'source': source_note
            }
        }), 200

    except Exception as e:
        traceback.print_exc()
        return jsonify({'code': 500, 'message': str(e)}), 500



@transcriptome_bp.route('/summary/<fusion_name>', methods=['GET'])
@jwt_required(optional=True)
def get_transcriptome_summary(fusion_name):
    try:
        # 🔥 使用 Fusion 表
        fusion = Fusion.query.filter(Fusion.fusion_name == fusion_name).first()
        if not fusion:
            return jsonify({'code': 404, 'message': f'未找到融合: {fusion_name}'}), 404
        
        expression_df = load_expression_matrix()
        count_df = load_count_matrix()
        fusion_samples = get_samples_with_fusion(fusion_name)
        
        positive_count = 0
        negative_count = 0
        if count_df is not None:
            matched = match_sample_names(fusion_samples, count_df.columns)
            positive_count = len(matched)
            negative_count = len(count_df.columns) - positive_count
        
        return jsonify({
            'code': 200,
            'data': {
                'fusion_name': fusion_name,
                'left_gene': fusion.left_gene,
                'right_gene': fusion.right_gene,
                'expression_matrix_loaded': expression_df is not None,
                'count_matrix_loaded': count_df is not None,
                'pydeseq2_available': HAS_PYDESEQ2,
                'total_genes': len(count_df) if count_df is not None else 0,
                'total_samples': len(count_df.columns) if count_df is not None else 0,
                'fusion_positive_samples': positive_count,
                'fusion_negative_samples': negative_count,
                'can_do_differential': positive_count >= 2
            }
        }), 200
    except Exception as e:
        return jsonify({'code': 500, 'message': str(e)}), 500


@transcriptome_bp.route('/test', methods=['GET'])
def test_route():
    expression_df = load_expression_matrix()
    count_df = load_count_matrix()
    return jsonify({
        'code': 200,
        'message': 'Transcriptome API v4.2 - P值修复版',
        'version': 'v4.2',
        'fixes': [
            '🔥 修复 Fisher 检验 p 值正确返回前端',
            '富集分析添加重试机制',
            '差异分析添加更好的错误处理'
        ],
        'pydeseq2_available': HAS_PYDESEQ2,
        'scipy_available': HAS_SCIPY,
        'statsmodels_available': HAS_STATSMODELS,
        'expression_matrix_loaded': expression_df is not None,
        'expression_matrix_shape': list(expression_df.shape) if expression_df is not None else None,
        'count_matrix_loaded': count_df is not None,
        'count_matrix_shape': list(count_df.shape) if count_df is not None else None
    }), 200
