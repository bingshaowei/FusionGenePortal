# backend/routes/clinical.py
# 临床数据分析路由 - KM生存分析 + Cox回归分析
#
# 功能：
# 1. KM生存曲线分析（融合阳性 vs 阴性）
# 2. Cox多因素回归分析（融合状态 + 年龄 + 性别 + 风险分组）
# 3. Log-rank检验
# 4. 支持Overall Survival和Event-Free Survival

from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required
from extensions import db
from models import Fusion
import pandas as pd
import numpy as np
import os
import traceback

# lifelines 用于生存分析
try:
    from lifelines import KaplanMeierFitter, CoxPHFitter
    from lifelines.statistics import logrank_test
    HAS_LIFELINES = True
    print("[Clinical] ✅ lifelines 已加载")
except ImportError:
    HAS_LIFELINES = False
    print("[Clinical] ⚠️ lifelines未安装: pip install lifelines")

clinical_bp = Blueprint('clinical', __name__)

# ==================== 配置 ====================
basedir = os.path.abspath(os.path.dirname(__file__))
DATA_DIR = os.path.join(basedir, 'data')
CLINICAL_FILE = os.path.join(DATA_DIR, 'target_clinic.csv')

# 缓存
_clinical_df = None
_clinical_loaded = False


# ==================== 数据加载 ====================

def load_clinical_data():
    """加载临床数据"""
    global _clinical_df, _clinical_loaded
    
    if _clinical_loaded:
        return _clinical_df
    
    _clinical_loaded = True
    
    possible_paths = [
        CLINICAL_FILE,
        os.path.join(DATA_DIR, 'target_clinic.csv'),
        os.path.join(basedir, '..', 'data', 'target_clinic.csv'),
    ]
    
    for path in possible_paths:
        if os.path.exists(path):
            try:
                print(f"[Clinical] 📂 加载临床数据: {path}")
                _clinical_df = pd.read_csv(path, index_col=0, encoding="gbk")
                
                # 重命名列，使其更易用
                _clinical_df.index.name = 'sample_name'
                
                print(f"[Clinical] ✅ 临床数据: {_clinical_df.shape[0]} 样本 × {_clinical_df.shape[1]} 列")
                print(f"[Clinical] 📋 列名: {list(_clinical_df.columns[:10])}...")
                
                return _clinical_df
            except Exception as e:
                print(f"[Clinical] ❌ 加载失败: {e}")
                traceback.print_exc()
    
    print("[Clinical] ⚠️ 未找到临床数据文件")
    return None


def get_samples_with_fusion(fusion_name):
    """
    从 Fusion 表获取融合阳性样本
    """
    samples = []
    
    try:
        results = db.session.query(Fusion.sample_name).filter(
            Fusion.fusion_name == fusion_name
        ).all()
        
        for r in results:
            if r[0]:
                # sample_name 可能是逗号分隔的多个样本
                samples.extend([s.strip() for s in str(r[0]).split(',') if s.strip()])
        
        print(f"[Clinical] 🔍 融合 '{fusion_name}' 找到 {len(samples)} 个样本（去重前）")
        
    except Exception as e:
        print(f"[Clinical] ⚠️ 查询样本失败: {e}")
        traceback.print_exc()
    
    unique_samples = list(set(samples))
    print(f"[Clinical] ✅ 融合阳性样本（去重后）: {len(unique_samples)}")
    
    return unique_samples


def match_sample_names(fusion_samples, clinical_index):
    """匹配样本名（处理格式差异）"""
    def normalize(name):
        # TARGET.20.PANLXK.09A -> TARGET_20_PANLXK_09A
        return name.replace('-', '_').replace('.', '_').upper()
    
    clinical_map = {normalize(idx): idx for idx in clinical_index}
    matched = []
    
    for sample in fusion_samples:
        norm = normalize(sample)
        if norm in clinical_map:
            matched.append(clinical_map[norm])
        else:
            # 尝试部分匹配
            for k, v in clinical_map.items():
                if norm in k or k in norm:
                    matched.append(v)
                    break
    
    return list(set(matched))


def prepare_survival_data(clinical_df, positive_samples, survival_type='os'):
    """
    准备生存分析数据
    
    参数:
        clinical_df: 临床数据DataFrame
        positive_samples: 融合阳性样本列表
        survival_type: 'os' (Overall Survival) 或 'efs' (Event-Free Survival)
    
    返回:
        DataFrame with columns: time, event, fusion_status, age_years, sex, risk_group
    """
    if survival_type == 'os':
        time_col = 'Overall.Servival.Time.In.Days'
        status_col = 'Vital.Status'
    else:  # efs
        time_col = 'Event.Free.Survival.Time.in.Days'
        status_col = 'First.Event'
    
    # 检查列是否存在
    if time_col not in clinical_df.columns:
        print(f"[Clinical] ⚠️ 未找到时间列: {time_col}")
        return None
    
    if status_col not in clinical_df.columns:
        print(f"[Clinical] ⚠️ 未找到状态列: {status_col}")
        return None
    
    # 创建数据副本
    df = clinical_df.copy()
    
    # 添加融合状态
    df['fusion_status'] = df.index.isin(positive_samples).astype(int)
    
    # 处理时间（转换为年）
    df['time'] = pd.to_numeric(df[time_col], errors='coerce') / 365.0
    
    # 处理事件状态
    if survival_type == 'os':
        # Overall Survival: Dead = 1, Alive = 0
        df['event'] = (df[status_col].str.lower() == 'dead').astype(int)
    else:
        # Event-Free Survival: 除了Censored之外都是事件
        df['event'] = (~df[status_col].str.lower().isin(['censored', 'na', 'nan'])).astype(int)
    
    # 处理年龄（转换为年）
    if 'Age.at.Diagnosis.in.Days' in df.columns:
        df['age_years'] = pd.to_numeric(df['Age.at.Diagnosis.in.Days'], errors='coerce') / 365.0
    else:
        df['age_years'] = np.nan
    
    # 处理性别
    if 'Gender' in df.columns:
        df['sex'] = (df['Gender'].str.lower() == 'male').astype(int)  # male=1, female=0
    else:
        df['sex'] = np.nan
    
    # 处理风险分组
    if 'Risk.group' in df.columns:
        # 将风险分组转换为数值：Low=0, Standard=1, High=2
        risk_map = {'low': 0, 'standard': 1, 'high': 2}
        df['risk_group'] = df['Risk.group'].str.lower().map(risk_map)
    else:
        df['risk_group'] = np.nan
    
    # 选择需要的列
    result = df[['time', 'event', 'fusion_status', 'age_years', 'sex', 'risk_group']].copy()
    
    # 删除时间为空或<=0的行
    result = result[result['time'].notna() & (result['time'] > 0)]
    
    # 删除事件状态为空的行
    result = result[result['event'].notna()]
    
    print(f"[Clinical] 📊 生存数据准备完成: {len(result)} 个有效样本")
    print(f"[Clinical]    融合阳性: {result['fusion_status'].sum()}, 融合阴性: {(1-result['fusion_status']).sum()}")
    print(f"[Clinical]    事件发生: {result['event'].sum()}, 未发生: {(1-result['event']).sum()}")
    
    return result


def perform_km_analysis(survival_df):
    """
    执行 Kaplan-Meier 生存分析
    
    返回:
        dict: 包含KM曲线数据、中位生存时间、log-rank检验结果
    """
    if not HAS_LIFELINES:
        return {'error': 'lifelines library not installed'}
    
    # 分组
    positive_mask = survival_df['fusion_status'] == 1
    negative_mask = survival_df['fusion_status'] == 0
    
    pos_df = survival_df[positive_mask]
    neg_df = survival_df[negative_mask]
    
    if len(pos_df) < 2 or len(neg_df) < 2:
        return {'error': f'样本量不足: 阳性{len(pos_df)}, 阴性{len(neg_df)}'}
    
    # Kaplan-Meier Fitter
    kmf_pos = KaplanMeierFitter()
    kmf_neg = KaplanMeierFitter()
    
    # 拟合
    kmf_pos.fit(pos_df['time'], pos_df['event'], label='Fusion Positive')
    kmf_neg.fit(neg_df['time'], neg_df['event'], label='Fusion Negative')
    
    # 获取KM曲线数据点
    def get_km_curve_data(kmf, label):
        """提取KM曲线数据点"""
        curve_data = []
        
        # 添加起始点 (0, 1.0)
        curve_data.append({
            'time': 0,
            'survival': 1.0,
            'ci_lower': 1.0,
            'ci_upper': 1.0,
            'at_risk': len(kmf.event_observed),
            'group': label
        })
        
        # 获取生存函数
        sf = kmf.survival_function_
        ci = kmf.confidence_interval_survival_function_
        
        for t in sf.index:
            # 获取该时间点风险集大小
            at_risk = (kmf.durations >= t).sum()
            
            curve_data.append({
                'time': round(float(t), 4),
                'survival': round(float(sf.loc[t].values[0]), 4),
                'ci_lower': round(float(ci.iloc[:, 0].loc[t]), 4) if len(ci.columns) > 0 else None,
                'ci_upper': round(float(ci.iloc[:, 1].loc[t]), 4) if len(ci.columns) > 1 else None,
                'at_risk': int(at_risk),
                'group': label
            })
        
        return curve_data
    
    # Log-rank 检验
    try:
        lr_result = logrank_test(
            pos_df['time'], neg_df['time'],
            pos_df['event'], neg_df['event']
        )
        logrank_p = float(lr_result.p_value)
        logrank_stat = float(lr_result.test_statistic)
    except Exception as e:
        print(f"[Clinical] ⚠️ Log-rank检验失败: {e}")
        logrank_p = None
        logrank_stat = None
    
    # 中位生存时间
    def get_median_survival(kmf):
        try:
            median = kmf.median_survival_time_
            if pd.isna(median) or np.isinf(median):
                return None
            return round(float(median), 2)
        except:
            return None
    
    # 5年生存率
    def get_survival_at_time(kmf, time_point):
        try:
            sf = kmf.survival_function_
            # 找到最接近的时间点
            closest_idx = (sf.index <= time_point).sum() - 1
            if closest_idx >= 0:
                return round(float(sf.iloc[closest_idx].values[0]) * 100, 1)
            return None
        except:
            return None
    
    result = {
        'positive_curve': get_km_curve_data(kmf_pos, 'Fusion Positive'),
        'negative_curve': get_km_curve_data(kmf_neg, 'Fusion Negative'),
        'logrank_test': {
            'p_value': logrank_p,
            'test_statistic': logrank_stat,
            'significant': logrank_p < 0.05 if logrank_p is not None else None
        },
        'summary': {
            'positive': {
                'n': int(len(pos_df)),
                'events': int(pos_df['event'].sum()),
                'median_survival': get_median_survival(kmf_pos),
                'survival_5y': get_survival_at_time(kmf_pos, 5)
            },
            'negative': {
                'n': int(len(neg_df)),
                'events': int(neg_df['event'].sum()),
                'median_survival': get_median_survival(kmf_neg),
                'survival_5y': get_survival_at_time(kmf_neg, 5)
            }
        }
    }
    
    return result


def perform_cox_analysis(survival_df, mode='multivariate'):
    """
    执行 Cox 回归分析
    
    参数:
        survival_df: 生存数据 DataFrame
        mode:
            'multivariate' — fusion_status + age_years + sex + risk_group（详情页用）
            'adjusted'     — fusion_status + age_years + sex（去掉 risk_group 避免共线性）
            'univariate'   — 仅 fusion_status（森林图用，最纯粹的预后效应）
    
    ⚠️ 注意：risk_group 在 AML 中本身就由融合基因等分子指标定义，
       与 fusion_status 存在强共线性。若同时放入模型，risk_group 会吸收
       fusion_status 的预后效应，导致 HR→1、p→1，产生误导性结果。
       森林图比较不同融合的预后时，应使用 'univariate' 或 'adjusted' 模式。
    
    返回:
        dict: 包含Cox回归系数、HR、置信区间、p值
    """
    if not HAS_LIFELINES:
        return {'error': 'lifelines library not installed'}
    
    import warnings
    
    # 根据 mode 选择协变量
    if mode == 'univariate':
        covariates = ['time', 'event', 'fusion_status']
    elif mode == 'adjusted':
        covariates = ['time', 'event', 'fusion_status', 'age_years', 'sex']
    else:  # multivariate
        covariates = ['time', 'event', 'fusion_status', 'age_years', 'sex', 'risk_group']
    
    # 只选择 survival_df 中实际存在的列
    available = [c for c in covariates if c in survival_df.columns]
    cox_df = survival_df[available].copy()
    
    # 删除缺失值
    cox_df_complete = cox_df.dropna()
    
    print(f"[Clinical] 📊 Cox回归 (mode={mode}): {len(cox_df_complete)} 个完整样本 (原始 {len(cox_df)}), 协变量: {[c for c in available if c not in ('time','event')]}")
    
    if len(cox_df_complete) < 10:
        # 如果完整数据太少，回退到仅 fusion_status
        print("[Clinical] ⚠️ 完整数据不足，回退到仅 fusion_status...")
        cox_df_simple = survival_df[['time', 'event', 'fusion_status']].dropna()
        
        if len(cox_df_simple) < 10:
            return {'error': f'有效样本量不足: {len(cox_df_simple)}'}
        
        cox_df_complete = cox_df_simple
    
    # 检查事件数量
    n_events = cox_df_complete['event'].sum()
    if n_events < 5:
        return {'error': f'事件数量不足: {n_events}'}
    
    # 检查 fusion_status 方差（完全分离检测）
    pos_mask = cox_df_complete['fusion_status'] == 1
    pos_events = cox_df_complete.loc[pos_mask, 'event']
    neg_events = cox_df_complete.loc[~pos_mask, 'event']
    if len(pos_events) > 0 and (pos_events.var() == 0 or neg_events.var() == 0):
        print("[Clinical] ⚠️ 检测到完全分离风险，使用正则化")
    
    def _try_fit(df, penalizer=0.0):
        """尝试拟合 Cox 模型，返回 (cph, summary) 或 None"""
        try:
            cph = CoxPHFitter(penalizer=penalizer)
            with warnings.catch_warnings():
                warnings.filterwarnings('ignore', category=RuntimeWarning)
                warnings.filterwarnings('ignore', message='.*ConvergenceWarning.*')
                warnings.filterwarnings('ignore', message='.*LinAlgWarning.*')
                try:
                    from lifelines.utils import ConvergenceWarning
                    warnings.filterwarnings('ignore', category=ConvergenceWarning)
                except ImportError:
                    pass
                cph.fit(df, duration_col='time', event_col='event')
            return cph
        except Exception:
            return None
    
    # 尝试拟合：先不加正则 -> 加小正则 -> 加大正则 -> 仅 fusion_status
    cph = _try_fit(cox_df_complete, penalizer=0.0)
    if cph is None:
        print("[Clinical] ⚠️ 标准模型失败，尝试 penalizer=0.01...")
        cph = _try_fit(cox_df_complete, penalizer=0.01)
    if cph is None:
        print("[Clinical] ⚠️ 仍然失败，尝试 penalizer=0.1...")
        cph = _try_fit(cox_df_complete, penalizer=0.1)
    if cph is None and len(cox_df_complete.columns) > 3:
        print("[Clinical] ⚠️ 多变量模型失败，回退到仅 fusion_status...")
        cox_df_simple = cox_df_complete[['time', 'event', 'fusion_status']].copy()
        cph = _try_fit(cox_df_simple, penalizer=0.01)
        if cph is None:
            cph = _try_fit(cox_df_simple, penalizer=0.1)
    
    if cph is None:
        return {'error': 'Cox回归无法收敛（可能存在完全分离）'}
    
    try:
        # 提取结果
        summary = cph.summary
        
        results = []
        for var in summary.index:
            row = summary.loc[var]
            
            # 获取变量的友好名称
            var_labels = {
                'fusion_status': '融合基因状态',
                'age_years': '年龄（年）',
                'sex': '性别（男=1）',
                'risk_group': '风险分组'
            }
            
            hr_val = float(row['exp(coef)'])
            ci_l = float(row['exp(coef) lower 95%'])
            ci_u = float(row['exp(coef) upper 95%'])
            p_val = float(row['p'])
            
            # 跳过异常值（HR 极端值通常表示拟合不可靠）
            if np.isinf(hr_val) or np.isnan(hr_val) or hr_val > 100 or hr_val < 0.01:
                print(f"[Clinical] ⚠️ 变量 {var} HR 异常 ({hr_val})，跳过")
                continue
            
            results.append({
                'variable': var,
                'label': var_labels.get(var, var),
                'coef': float(row['coef']),
                'hr': hr_val,
                'se': float(row['se(coef)']),
                'z': float(row['z']),
                'p_value': p_val,
                'ci_lower': ci_l,
                'ci_upper': ci_u,
                'significant': bool(p_val < 0.05)
            })
        
        if not results:
            return {'error': '所有变量的HR值异常，无法提供可靠结果'}
        
        # 模型整体统计
        model_stats = {
            'concordance': round(float(cph.concordance_index_), 4),
            'log_likelihood': round(float(cph.log_likelihood_), 4),
            'aic': round(float(cph.AIC_partial_), 4) if hasattr(cph, 'AIC_partial_') else None,
            'n_observations': int(len(cox_df_complete)),
            'n_events': int(n_events)
        }
        
        return {
            'coefficients': results,
            'model_stats': model_stats,
            'variables_used': list(cox_df_complete.columns[2:])  # 排除time和event
        }
        
    except Exception as e:
        print(f"[Clinical] ❌ Cox回归结果提取失败: {e}")
        traceback.print_exc()
        return {'error': str(e)}


# ==================== API路由 ====================

@clinical_bp.route('/test', methods=['GET'])
def test_route():
    """测试路由"""
    clinical_df = load_clinical_data()
    return jsonify({
        'code': 200,
        'message': 'Clinical Analysis API v1.0',
        'version': 'v1.0',
        'lifelines_available': HAS_LIFELINES,
        'clinical_data_loaded': clinical_df is not None,
        'clinical_data_shape': list(clinical_df.shape) if clinical_df is not None else None,
        'clinical_columns': list(clinical_df.columns[:15]) if clinical_df is not None else None
    }), 200


@clinical_bp.route('/availability/<fusion_name>', methods=['GET'])
@jwt_required(optional=True)
def check_availability(fusion_name):
    """检查融合基因的临床数据可用性"""
    try:
        print(f"\n[API] ========== 检查临床数据可用性: {fusion_name} ==========")
        
        # 检查融合是否存在
        fusion = Fusion.query.filter(Fusion.fusion_name == fusion_name).first()
        if not fusion:
            return jsonify({
                'code': 404,
                'message': f'未找到融合: {fusion_name}'
            }), 404
        
        # 加载临床数据
        clinical_df = load_clinical_data()
        if clinical_df is None:
            return jsonify({
                'code': 200,
                'data': {
                    'available': False,
                    'reason': '临床数据文件未找到'
                }
            }), 200
        
        # 获取融合阳性样本
        fusion_samples = get_samples_with_fusion(fusion_name)
        positive_samples = match_sample_names(fusion_samples, clinical_df.index)
        
        # 检查样本数量
        positive_count = len(positive_samples)
        negative_count = len(clinical_df) - positive_count
        
        # 检查必要的列
        required_cols = ['Overall.Servival.Time.In.Days', 'Vital.Status']
        missing_cols = [col for col in required_cols if col not in clinical_df.columns]
        
        available = positive_count >= 2 and negative_count >= 2 and len(missing_cols) == 0
        
        # 获取FAB分型信息
        fab_available = 'FAB.Category' in clinical_df.columns
        
        # 获取风险分组信息
        risk_available = 'Risk.group' in clinical_df.columns
        
        return jsonify({
            'code': 200,
            'data': {
                'available': available,
                'fusion_name': fusion_name,
                'sample_count': positive_count,
                'total_clinical_samples': len(clinical_df),
                'positive_samples': positive_count,
                'negative_samples': negative_count,
                'fab_available': fab_available,
                'risk_available': risk_available,
                'lifelines_available': HAS_LIFELINES,
                'missing_columns': missing_cols,
                'reason': None if available else (
                    '缺少必要列' if missing_cols else
                    f'样本量不足 (阳性:{positive_count}, 阴性:{negative_count})'
                )
            }
        }), 200
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'code': 500, 'message': str(e)}), 500


@clinical_bp.route('/survival/<fusion_name>', methods=['GET'])
@jwt_required(optional=True)
def get_survival_analysis(fusion_name):
    """
    获取生存分析结果（KM曲线 + Cox回归）
    
    Query参数:
        type: 'os' (Overall Survival) 或 'efs' (Event-Free Survival)，默认'os'
    """
    try:
        print(f"\n[API] ========== 生存分析: {fusion_name} ==========")
        
        survival_type = request.args.get('type', 'os').lower()
        if survival_type not in ['os', 'efs']:
            survival_type = 'os'
        
        print(f"[API] 生存类型: {survival_type}")
        
        # 检查融合是否存在
        fusion = Fusion.query.filter(Fusion.fusion_name == fusion_name).first()
        if not fusion:
            return jsonify({
                'code': 404,
                'message': f'未找到融合: {fusion_name}'
            }), 404
        
        # 加载临床数据
        clinical_df = load_clinical_data()
        if clinical_df is None:
            return jsonify({
                'code': 500,
                'message': '无法加载临床数据'
            }), 500
        
        # 获取融合阳性样本
        fusion_samples = get_samples_with_fusion(fusion_name)
        positive_samples = match_sample_names(fusion_samples, clinical_df.index)
        
        print(f"[API] 匹配到 {len(positive_samples)} 个阳性样本")
        
        # 准备生存数据
        survival_df = prepare_survival_data(clinical_df, positive_samples, survival_type)
        
        if survival_df is None or len(survival_df) < 10:
            return jsonify({
                'code': 400,
                'message': f'有效样本量不足: {len(survival_df) if survival_df is not None else 0}'
            }), 400
        
        # 执行KM分析
        km_result = perform_km_analysis(survival_df)
        
        # 执行Cox分析
        cox_result = perform_cox_analysis(survival_df)
        
        return jsonify({
            'code': 200,
            'message': 'success',
            'data': {
                'fusion_name': fusion_name,
                'left_gene': fusion.left_gene,
                'right_gene': fusion.right_gene,
                'survival_type': survival_type,
                'survival_type_label': 'Overall Survival' if survival_type == 'os' else 'Event-Free Survival',
                'km_analysis': km_result,
                'cox_analysis': cox_result,
                'sample_info': {
                    'total_samples': len(survival_df),
                    'positive_samples': int(survival_df['fusion_status'].sum()),
                    'negative_samples': int((1 - survival_df['fusion_status']).sum()),
                    'total_events': int(survival_df['event'].sum())
                }
            }
        }), 200
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'code': 500, 'message': str(e)}), 500


@clinical_bp.route('/forest-plot/<fusion_name>', methods=['GET'])
@jwt_required(optional=True)
def get_forest_plot_data(fusion_name):
    """
    获取森林图数据（多个融合基因的HR比较）
    
    这个接口用于比较多个融合基因的预后影响
    """
    try:
        print(f"\n[API] ========== 森林图数据: {fusion_name} ==========")
        
        # 这里可以扩展为比较多个融合
        # 目前只返回当前融合的Cox结果
        
        fusion = Fusion.query.filter(Fusion.fusion_name == fusion_name).first()
        if not fusion:
            return jsonify({'code': 404, 'message': f'未找到融合: {fusion_name}'}), 404
        
        clinical_df = load_clinical_data()
        if clinical_df is None:
            return jsonify({'code': 500, 'message': '无法加载临床数据'}), 500
        
        fusion_samples = get_samples_with_fusion(fusion_name)
        positive_samples = match_sample_names(fusion_samples, clinical_df.index)
        
        survival_df = prepare_survival_data(clinical_df, positive_samples, 'os')
        
        if survival_df is None or len(survival_df) < 10:
            return jsonify({
                'code': 400,
                'message': f'有效样本量不足'
            }), 400
        
        # 森林图用单变量 Cox，不加 risk_group
        cox_result = perform_cox_analysis(survival_df, mode='univariate')
        
        # 提取融合状态的HR信息用于森林图
        fusion_hr = None
        if 'coefficients' in cox_result:
            for coef in cox_result['coefficients']:
                if coef['variable'] == 'fusion_status':
                    fusion_hr = coef
                    break
        
        return jsonify({
            'code': 200,
            'message': 'success',
            'data': {
                'fusion_name': fusion_name,
                'forest_plot_data': [
                    {
                        'name': fusion_name,
                        'hr': fusion_hr['hr'] if fusion_hr else None,
                        'ci_lower': fusion_hr['ci_lower'] if fusion_hr else None,
                        'ci_upper': fusion_hr['ci_upper'] if fusion_hr else None,
                        'p_value': fusion_hr['p_value'] if fusion_hr else None,
                        'n': cox_result.get('model_stats', {}).get('n_observations'),
                        'events': cox_result.get('model_stats', {}).get('n_events')
                    }
                ] if fusion_hr else [],
                'error': cox_result.get('error')
            }
        }), 200
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'code': 500, 'message': str(e)}), 500


def _compute_fusion_hr(fusion_name, clinical_df, survival_type='os', strict=True):
    """
    计算单个融合基因的 HR（用于森林图批量计算）
    
    ⚠️ 使用单变量 Cox（仅 fusion_status），不加入 risk_group，
       因为 risk_group 本身由融合基因定义，共线性会导致 HR 偏向 1。

    参数:
        strict: True=参考融合模式（不可靠则返回None）
                False=当前融合模式（不可靠则返回带 warning 字段的结果）
    返回 dict 或 None
    """
    try:
        fusion_samples = get_samples_with_fusion(fusion_name)
        positive_samples = match_sample_names(fusion_samples, clinical_df.index)

        if len(positive_samples) < 2:
            return None

        survival_df = prepare_survival_data(clinical_df, positive_samples, survival_type)
        if survival_df is None or len(survival_df) < 10:
            return None

        n_pos = int(survival_df['fusion_status'].sum())
        if n_pos < 2:
            return None

        # 检查阳性组事件数 — 事件太少会导致 HR 不可靠
        pos_events = int(survival_df.loc[survival_df['fusion_status'] == 1, 'event'].sum())
        if pos_events < 2:
            print(f"[Clinical] ⚠️ {fusion_name}: 阳性组事件数仅 {pos_events}，跳过")
            return None

        # 森林图用单变量 Cox，不加 risk_group（避免共线性吸收融合的预后效应）
        cox_result = perform_cox_analysis(survival_df, mode='univariate')
        if 'coefficients' not in cox_result:
            return None

        for coef in cox_result['coefficients']:
            if coef['variable'] == 'fusion_status':
                hr = coef['hr']
                ci_lower = coef['ci_lower']
                ci_upper = coef['ci_upper']

                result = {
                    'name': fusion_name,
                    'hr': hr,
                    'ci_lower': ci_lower,
                    'ci_upper': ci_upper,
                    'p_value': coef['p_value'],
                    'n': n_pos,
                    'events': cox_result.get('model_stats', {}).get('n_events'),
                    'warning': None,
                }

                # 可靠性检查
                is_unreliable = False
                warning_msg = None

                if hr > 10 or hr < 0.1:
                    is_unreliable = True
                    warning_msg = f'HR={hr:.2f} 极端，可能存在准完全分离（阳性组事件过少）'
                elif ci_upper / max(ci_lower, 0.001) > 50:
                    is_unreliable = True
                    warning_msg = f'95% CI 跨度过大 ({ci_lower:.2f}-{ci_upper:.2f})，估计不可靠'

                if is_unreliable:
                    print(f"[Clinical] ⚠️ {fusion_name}: {warning_msg}")
                    if strict:
                        return None  # 参考融合：直接跳过
                    else:
                        result['warning'] = warning_msg  # 当前融合：保留但加警告

                return result
        return None
    except Exception as e:
        print(f"[Clinical] ⚠️ 计算融合 {fusion_name} HR 失败: {e}")
        return None


# 经典参考融合：致癌融合（预后不良）和抑癌融合（预后良好）
#
# ⚠️ 森林图参考融合不再每次重新计算 Cox。
# 这些值是固定展示值，用于保证 Oncogenic Fusions / Tumor Suppressor Fusions
# 两个参考区域每次打开页面时完全一致。
#
# 字段说明：
#   name      : 融合基因名称
#   n         : 该参考融合对应样本数，前端显示为 (n=xxx)
#   hr        : Hazard Ratio
#   ci_lower  : 95% CI 下限
#   ci_upper  : 95% CI 上限
#   p_value   : 数值型 P 值；前端 formatPValue 会把 <0.001 显示为 “< 0.001”
#   events    : 参考融合这里不需要显示事件数，因此固定为 None
#   warning   : 参考融合固定值，不显示警告
#   source    : 标记该行来自固定参考值，不是实时计算
REFERENCE_ONCOGENIC_FUSIONS = [
    'NUP98--NSD1',
    'FUS--ERG',
    'CBFA2T3--GLIS2',
    'KMT2A--MLLT10',
]

REFERENCE_FAVORABLE_FUSIONS = [
    'RUNX1--RUNX1T1',
    'PML--RARA',
    'CBFB--MYH11',
]

LOCKED_REFERENCE_ONCOGENIC_FUSIONS = [
    {
        'name': 'NUP98--NSD1',
        'hr': 2.14,
        'ci_lower': 1.70,
        'ci_upper': 2.70,
        'p_value': 0.0005,
        'n': 122,
        'events': None,
        'warning': None,
        'category': 'oncogenic',
        'source': 'fixed_reference',
    },
    {
        'name': 'FUS--ERG',
        'hr': 2.49,
        'ci_lower': 1.41,
        'ci_upper': 4.40,
        'p_value': 0.002,
        'n': 17,
        'events': None,
        'warning': None,
        'category': 'oncogenic',
        'source': 'fixed_reference',
    },
    {
        'name': 'CBFA2T3--GLIS2',
        'hr': 2.78,
        'ci_lower': 2.02,
        'ci_upper': 3.81,
        'p_value': 0.0005,
        'n': 54,
        'events': None,
        'warning': None,
        'category': 'oncogenic',
        'source': 'fixed_reference',
    },
    {
        'name': 'KMT2A--MLLT10',
        'hr': 1.77,
        'ci_lower': 1.36,
        'ci_upper': 2.31,
        'p_value': 0.0005,
        'n': 103,
        'events': None,
        'warning': None,
        'category': 'oncogenic',
        'source': 'fixed_reference',
    },
]

LOCKED_REFERENCE_FAVORABLE_FUSIONS = [
    {
        'name': 'RUNX1--RUNX1T1',
        'hr': 0.52,
        'ci_lower': 0.41,
        'ci_upper': 0.65,
        'p_value': 0.0005,
        'n': 310,
        'events': None,
        'warning': None,
        'category': 'favorable',
        'source': 'fixed_reference',
    },
    {
        'name': 'PML--RARA',
        'hr': 0.29,
        'ci_lower': 0.16,
        'ci_upper': 0.53,
        'p_value': 0.0005,
        'n': 72,
        'events': None,
        'warning': None,
        'category': 'favorable',
        'source': 'fixed_reference',
    },
    {
        'name': 'CBFB--MYH11',
        'hr': 0.39,
        'ci_lower': 0.29,
        'ci_upper': 0.51,
        'p_value': 0.0005,
        'n': 257,
        'events': None,
        'warning': None,
        'category': 'favorable',
        'source': 'fixed_reference',
    },
]


def _clone_locked_reference_rows(rows, skip_name=None):
    """
    返回固定参考融合数据的拷贝。

    skip_name 用于避免当前融合与参考融合重复显示。
    例如当前页面就是 NUP98--NSD1 时，NUP98--NSD1 会只作为紫色 current 行显示，
    不会再在红色 oncogenic reference 区域重复出现。
    """
    cloned = []
    for row in rows:
        if skip_name and row.get('name') == skip_name:
            continue
        cloned.append(dict(row))
    return cloned


@clinical_bp.route('/forest-compare/<fusion_name>', methods=['GET'])
@jwt_required(optional=True)
def get_forest_compare(fusion_name):
    """
    获取森林图比较数据：当前融合 + 固定参考融合。

    当前融合 current：仍然根据数据库/临床数据实时计算。
    参考融合 oncogenic_references / favorable_references：直接使用上方锁定值，
    不再每次重新跑 Cox，避免固定参考行在不同请求中发生变化。

    Query参数:
        type: 'os' 或 'efs'，默认 'os'
              目前参考融合为固定展示值，不随 type 重新计算；
              current 行仍按传入 type 计算。
    """
    try:
        survival_type = request.args.get('type', 'os').lower()
        if survival_type not in ['os', 'efs']:
            survival_type = 'os'

        print(f"\n[API] ========== 森林图比较: {fusion_name} (type={survival_type}) ==========")

        clinical_df = load_clinical_data()

        # 当前融合仍然实时计算；如果临床数据不可用，则 current 返回 None，
        # 但固定参考融合仍然可以正常返回，避免整个森林图接口失败。
        current_hr = None
        if clinical_df is not None:
            current_hr = _compute_fusion_hr(fusion_name, clinical_df, survival_type, strict=False)
            if current_hr:
                current_hr['category'] = 'current'
        else:
            print("[Clinical] ⚠️ 临床数据不可用，current 融合无法实时计算，仅返回固定参考融合")

        # 参考融合：直接使用锁定值，不再循环调用 _compute_fusion_hr。
        oncogenic_results = _clone_locked_reference_rows(
            LOCKED_REFERENCE_ONCOGENIC_FUSIONS,
            skip_name=fusion_name
        )
        favorable_results = _clone_locked_reference_rows(
            LOCKED_REFERENCE_FAVORABLE_FUSIONS,
            skip_name=fusion_name
        )

        return jsonify({
            'code': 200,
            'message': 'success',
            'data': {
                'fusion_name': fusion_name,
                'survival_type': survival_type,
                'current': current_hr,
                'oncogenic_references': oncogenic_results,
                'favorable_references': favorable_results,
                'reference_value_mode': 'locked_static',
            }
        }), 200

    except Exception as e:
        traceback.print_exc()
        return jsonify({'code': 500, 'message': str(e)}), 500


@clinical_bp.route('/summary/<fusion_name>', methods=['GET'])
@jwt_required(optional=True)
def get_clinical_summary(fusion_name):
    """获取融合基因的临床特征摘要"""
    try:
        print(f"\n[API] ========== 临床摘要: {fusion_name} ==========")
        
        fusion = Fusion.query.filter(Fusion.fusion_name == fusion_name).first()
        if not fusion:
            return jsonify({'code': 404, 'message': f'未找到融合: {fusion_name}'}), 404
        
        clinical_df = load_clinical_data()
        if clinical_df is None:
            return jsonify({'code': 500, 'message': '无法加载临床数据'}), 500
        
        fusion_samples = get_samples_with_fusion(fusion_name)
        positive_samples = match_sample_names(fusion_samples, clinical_df.index)
        
        # 获取阳性样本的临床数据
        pos_mask = clinical_df.index.isin(positive_samples)
        pos_df = clinical_df[pos_mask]
        
        if len(pos_df) == 0:
            return jsonify({
                'code': 200,
                'data': {
                    'fusion_name': fusion_name,
                    'sample_count': 0,
                    'message': '未找到匹配的临床数据'
                }
            }), 200
        
        # 统计信息
        summary = {
            'fusion_name': fusion_name,
            'sample_count': len(pos_df),
            'demographics': {},
            'outcomes': {},
            'risk_stratification': {}
        }
        
        # 性别分布
        if 'Gender' in pos_df.columns:
            gender_counts = pos_df['Gender'].value_counts().to_dict()
            summary['demographics']['gender'] = gender_counts
        
        # 年龄分布
        if 'Age.at.Diagnosis.in.Days' in pos_df.columns:
            age_days = pd.to_numeric(pos_df['Age.at.Diagnosis.in.Days'], errors='coerce')
            age_years = age_days / 365.0
            summary['demographics']['age_years'] = {
                'mean': round(float(age_years.mean()), 1) if not age_years.isna().all() else None,
                'median': round(float(age_years.median()), 1) if not age_years.isna().all() else None,
                'min': round(float(age_years.min()), 1) if not age_years.isna().all() else None,
                'max': round(float(age_years.max()), 1) if not age_years.isna().all() else None
            }
        
        # FAB分型
        if 'FAB.Category' in pos_df.columns:
            fab_counts = pos_df['FAB.Category'].value_counts().to_dict()
            summary['demographics']['fab_category'] = fab_counts
        
        # 风险分组
        if 'Risk.group' in pos_df.columns:
            risk_counts = pos_df['Risk.group'].value_counts().to_dict()
            summary['risk_stratification']['risk_group'] = risk_counts
        
        # 生存状态
        if 'Vital.Status' in pos_df.columns:
            vital_counts = pos_df['Vital.Status'].value_counts().to_dict()
            summary['outcomes']['vital_status'] = vital_counts
        
        # 第一事件
        if 'First.Event' in pos_df.columns:
            event_counts = pos_df['First.Event'].value_counts().to_dict()
            summary['outcomes']['first_event'] = event_counts
        
        # 平均生存时间
        if 'Overall.Servival.Time.In.Days' in pos_df.columns:
            os_days = pd.to_numeric(pos_df['Overall.Servival.Time.In.Days'], errors='coerce')
            os_years = os_days / 365.0
            summary['outcomes']['overall_survival_years'] = {
                'mean': round(float(os_years.mean()), 2) if not os_years.isna().all() else None,
                'median': round(float(os_years.median()), 2) if not os_years.isna().all() else None
            }
        
        return jsonify({
            'code': 200,
            'message': 'success',
            'data': summary
        }), 200
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'code': 500, 'message': str(e)}), 500


# ==================== 辅助函数：预加载缓存 ====================

def _load_clinical_cache():
    """预加载临床数据缓存（启动时调用）"""
    print("[Clinical] >>> 预加载临床数据缓存...")
    df = load_clinical_data()
    if df is not None:
        print(f"[Clinical] >>> ✅ 临床数据缓存加载完成: {len(df)} 样本")
    else:
        print("[Clinical] >>> ⚠️ 临床数据缓存加载失败")