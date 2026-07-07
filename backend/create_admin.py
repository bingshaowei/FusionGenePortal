# create_admin.py
from werkzeug.security import generate_password_hash
from flask import Flask
from models import db, User

app = Flask(__name__)
app.config.from_object('config.Config')  # 或根据你的项目结构调整

db.init_app(app)

with app.app_context():
    # 创建初始内部账号
    if not User.query.filter_by(username='child_cancer').first():
        admin = User(
            username='child_cancer',
            password_hash=generate_password_hash('yaolizu666'),
            role='internal'
        )
        db.session.add(admin)
        db.session.commit()
        print("✅ 初始内部用户已创建：child_cancer")
    else:
        print("ℹ️ 用户 child_cancer 已存在，无需重复创建")
