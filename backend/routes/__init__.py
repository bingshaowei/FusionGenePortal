# backend/routes/__init__.py
from flask import Flask
from .auth_routes import auth_bp      # ← 改成 auth_routes
from .fusions import fusion_bp        # ← 保持 fusions (不是 fusion_routes)
from .upload import upload_bp
from .analyze import analyze_bp
from .sniffer import sniffer_bp
from .profile import profile_bp

def register_blueprints(app: Flask):
    """注册所有蓝图"""
    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(fusion_bp, url_prefix="/api/fusions")
    app.register_blueprint(upload_bp, url_prefix="/api/upload")
    app.register_blueprint(analyze_bp, url_prefix="/api/analyze")
    app.register_blueprint(sniffer_bp, url_prefix="/api/sniffer")
    app.register_blueprint(profile_bp, url_prefix="/api")
    
    print("✅ 所有路由已注册")
