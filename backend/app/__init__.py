# backend/app/__init__.py
from flask import Flask
from config import Config
from extensions import db, jwt
from routes import register_blueprints

def create_app(config_class=Config):  # ✅ 支持传 config
    app = Flask(__name__)
    app.config.from_object(config_class)

    db.init_app(app)    # ✅ VERY IMPORTANT：绑定 app 到 db
    jwt.init_app(app)

    register_blueprints(app)
    return app
