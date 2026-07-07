# backend/app.py
# 🆕 新增: gdsc_bp 蓝图 (GDSC 细胞系药物敏感性数据)

from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_jwt_extended import (
    JWTManager, create_access_token, jwt_required
)
from datetime import timedelta
from extensions import db
from routes.fusions import fusion_bp, _load_suggestion_cache, _load_top_fusions_cache
from routes.transcriptome import transcriptome_bp
from routes.clinical import clinical_bp, _load_clinical_cache
from routes.sniffer import sniffer_bp
from routes.arriba_routes import arriba_bp
from routes.fusion_deleted_routes import deleted_bp, _load_deleted_csv
from routes.cellfusion_routes import cellfusion_bp, _load_cellfusion_csv
from routes.gdsc_routes import gdsc_bp, _get_expression_df, _get_drug_data                            # 🆕 GDSC 药物敏感性
import os
from routes.protein_structure import protein_structure_bp

app = Flask(__name__)

# --- 数据库配置 ---
basedir = os.path.abspath(os.path.dirname(__file__))
database_path = os.path.join(basedir, 'instance', 'child_cancer.db')
app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{database_path}'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# --- JWT 配置 ---
app.config['JWT_SECRET_KEY'] = 'your-secret-key-change-in-production'
app.config['JWT_TOKEN_LOCATION'] = ['headers']
app.config['JWT_HEADER_NAME'] = 'Authorization'
app.config['JWT_HEADER_TYPE'] = 'Bearer'
app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(hours=24)

# --- 文件上传配置 ---
app.config['MAX_CONTENT_LENGTH'] = 20 * 1024 * 1024 * 1024

print(f"\n🔍 数据库路径: {database_path}")
print(f"📊 数据库文件存在: {os.path.exists(database_path)}\n")

# 初始化扩展
db.init_app(app)
jwt = JWTManager(app)
CORS(app, resources={r"/api/*": {"origins": "*"}}, supports_credentials=False)

# 注册蓝图
app.register_blueprint(fusion_bp,           url_prefix='/api/fusion')
app.register_blueprint(transcriptome_bp,    url_prefix='/api/transcriptome')
app.register_blueprint(clinical_bp,         url_prefix='/api/clinical')
app.register_blueprint(protein_structure_bp,url_prefix='/api/protein')
app.register_blueprint(sniffer_bp,          url_prefix='/api/sniffer')
app.register_blueprint(arriba_bp,           url_prefix='/api/arriba')
app.register_blueprint(deleted_bp,          url_prefix='/api/deleted')
app.register_blueprint(cellfusion_bp,       url_prefix='/api/cellfusion')
app.register_blueprint(gdsc_bp)             # 🆕 GDSC（url_prefix 已在 Blueprint 中定义为 /api/gdsc）

# ==================== 🔐 用户账号配置 ====================
VALID_USERS = {
    'Fenhuazu': 'Fenhuazu666'
}

# 🔥 预加载所有缓存
with app.app_context():
    # Preload GDSC in the gunicorn master. With --preload, workers inherit the loaded data
    # instead of each worker paying the first-request CSV parsing cost.
    try:
        print(">>> [GDSC] preloading expression/drug data...")
        expr_df = _get_expression_df()
        _get_drug_data()
        print(f">>> GDSC preload finished: expression={expr_df.shape[0]} x {expr_df.shape[1]}")
    except Exception as e:
        print(f">>> GDSC preload failed; falling back to lazy loading: {e}")

    print("=" * 55)
    print(">>> 正在预加载缓存...")
    print("=" * 55)

    # 1. 搜索建议缓存
    try:
        print(">>> [1/5] 加载搜索建议缓存...")
        _load_suggestion_cache()
        print(">>> ✅ 搜索建议缓存加载完成！")
    except Exception as e:
        print(f">>> ⚠️  搜索建议缓存加载失败: {e}")

    # 2. Top 100 融合基因缓存
    try:
        print(">>> [2/5] 加载 Top 100 融合基因缓存...")
        _load_top_fusions_cache()
        print(">>> ✅ Top 100 融合基因缓存加载完成！")
    except Exception as e:
        print(f">>> ⚠️  Top 100 缓存加载失败: {e}")

    # 3. 临床数据缓存
    try:
        print(">>> [3/5] 加载临床数据缓存...")
        _load_clinical_cache()
        print(">>> ✅ 临床数据缓存加载完成！")
    except Exception as e:
        print(f">>> ⚠️  临床数据缓存加载失败: {e}")

    # 4. 低可信度融合基因 CSV
    try:
        print(">>> [4/5] 加载低可信度融合基因 CSV...")
        _load_deleted_csv()
        print(">>> ✅ 低可信度融合基因 CSV 加载完成！")
    except Exception as e:
        print(f">>> ⚠️  低可信度融合基因 CSV 加载失败: {e}")

    # 5. CCLE 细胞系融合基因 CSV
    try:
        print(">>> [5/5] 加载 CCLE 细胞系融合基因数据 (cellfusion_final.csv)...")
        _load_cellfusion_csv()
        print(">>> ✅ CCLE 细胞系数据加载完成！")
    except Exception as e:
        print(f">>> ⚠️  CCLE 细胞系数据加载失败: {e}")

    # GDSC 数据为延迟加载（首次请求时自动加载），无需预加载
    print(">>> ℹ️  GDSC 药物敏感性数据将在首次请求时延迟加载")

    print("=" * 55)
    print(">>> 🎉 所有缓存预加载完成！")
    print("=" * 55 + "\n")


# ---------------- 基础路由 ----------------
@app.route('/')
def home():
    return jsonify({'message': 'Fusion Gene Portal API', 'status': 'running'})


@app.route('/api/auth/login', methods=['POST'])
def login():
    """
    用户登录接口。未传账号密码时签发 guest token（免登录访问公开数据）。
    """
    if request.is_json:
        data = request.get_json(silent=True) or {}
    else:
        data = {}

    username = (data.get('username') or '').strip()
    password = data.get('password') or ''

    # 未提供账号密码 → guest token
    if not username and not password:
        token = create_access_token(identity='guest')
        return jsonify({
            'success': True,
            'access_token': token,
            'username': 'guest',
            'code': 200
        }), 200

    if username in VALID_USERS and VALID_USERS[username] == password:
        token = create_access_token(identity=username)
        return jsonify({
            'success': True,
            'access_token': token,
            'username': username,
            'code': 200
        }), 200

    return jsonify({'success': False, 'message': '用户名或密码错误'}), 401


@app.route('/api/test/public')
def test_public():
    return jsonify({'message': 'Public endpoint OK', 'code': 200})


@app.route('/api/test/protected')
@jwt_required()
def test_protected():
    return jsonify({'message': 'Protected endpoint OK', 'code': 200})


@app.route('/api/routes')
def list_routes():
    routes = []
    for rule in app.url_map.iter_rules():
        routes.append({
            'path': str(rule),
            'methods': sorted(rule.methods - {'HEAD', 'OPTIONS'}),
            'endpoint': rule.endpoint
        })
    return jsonify(sorted(routes, key=lambda x: x['path']))


# ---------------- JWT 错误处理 ----------------
@jwt.unauthorized_loader
def missing_token_callback(err_msg):
    return jsonify({'msg': 'Missing or invalid Authorization header', 'detail': err_msg}), 401

@jwt.invalid_token_loader
def invalid_token_callback(err_msg):
    return jsonify({'msg': 'Invalid token', 'detail': err_msg}), 422

@jwt.expired_token_loader
def expired_token_callback(header, payload):
    return jsonify({'msg': 'Token expired'}), 401


# ---------------- 调试接口 ----------------
@app.route('/api/debug/db-info')
def db_info():
    try:
        from models import Fusion
        total = Fusion.query.count()
        samples = Fusion.query.limit(3).all()
        sample_data = [
            {
                'id': f.id,
                'fusion_name': f.fusion_name,
                'left_gene': f.left_gene,
                'right_gene': f.right_gene,
                'left_breakpoint': f.left_breakpoint,
                'right_breakpoint': f.right_breakpoint,
            }
            for f in samples
        ]
        return jsonify({
            'database_path': database_path,
            'database_exists': os.path.exists(database_path),
            'total_records': total,
            'sample_data': sample_data,
        })
    except Exception as e:
        return jsonify({
            'error': str(e),
            'database_path': database_path,
            'database_exists': os.path.exists(database_path),
        }), 500


# ---------------- 启动 ----------------
if __name__ == '__main__':
    with app.app_context():
        try:
            from models import Fusion
            count = Fusion.query.count()
            print(f"✅ 数据库连接成功！共有 {count} 条 Fusion 记录")
            sample = Fusion.query.first()
            if sample:
                print(f"📝 样例数据: {sample.fusion_name} ({sample.left_gene} - {sample.right_gene})")
            print()
        except Exception as e:
            print(f"⚠️  数据库连接失败: {str(e)}\n")

    print("=" * 60)
    print("🚀 Fusion Gene Portal API 正在启动...")
    print(f"📍 主页: http://127.0.0.1:5000")
    print(f"🔐 登录账号: Fenhuazu / Fenhuazu666")
    print(f"📊 数据库检查: http://127.0.0.1:5000/api/debug/db-info")
    print(f"📋 路由列表:   http://127.0.0.1:5000/api/routes")
    print(f"🧬 蛋白质结构: http://127.0.0.1:5000/api/protein/")
    print(f"🧬 转录组API:  http://127.0.0.1:5000/api/transcriptome/")
    print(f"🏥 临床分析:   http://127.0.0.1:5000/api/clinical/")
    print(f"🔍 SNIFFER:    http://127.0.0.1:5000/api/sniffer/")
    print(f"🎨 Arriba:     http://127.0.0.1:5000/api/arriba/")
    print(f"🚫 低可信度:   http://127.0.0.1:5000/api/deleted/")
    print(f"🔬 CCLE细胞系: http://127.0.0.1:5000/api/cellfusion/")
    print(f"💊 GDSC药敏:   http://127.0.0.1:5000/api/gdsc/check")  # 🆕
    print(f"🔥 缓存状态:   http://127.0.0.1:5000/api/fusion/cache-status")
    print("=" * 60 + "\n")

    app.run(debug=True, host='0.0.0.0', port=5000)

