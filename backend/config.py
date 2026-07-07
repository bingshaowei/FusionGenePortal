# backend/config.py
import os

class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY", "sniffer-secret-key")
    
    # ✅ 改用SQLite
    SQLALCHEMY_DATABASE_URI = os.environ.get(
        "DATABASE_URL",
        "sqlite:///child_cancer.db"  # 改成这个
    )
    
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    JWT_SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "sniffer-jwt-secret")
    UPLOAD_FOLDER = os.path.abspath("uploads")
    MAX_CONTENT_LENGTH = 1000 * 1024 * 1024
    CORS_ORIGINS = ["http://localhost:3000"]
