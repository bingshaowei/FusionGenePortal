# backend/init_db.py
from app import create_app
from extensions import db
from models import User
from werkzeug.security import generate_password_hash

def main():
    app = create_app()  # 不传 config，使用默认 DevelopmentConfig 即可

    with app.app_context():  # ✅ 关键：保证所有 db 操作在上下文中
        db.create_all()
        print("✅ 数据库表已成功创建")

        # ✅ 确保 User 操作在 app 上下文中
        if not User.query.filter_by(username='child_cancer').first():
            user = User(
                username='child_cancer',
                password_hash=generate_password_hash("yaolizu666"),
                role="admin"
            )
            db.session.add(user)
            db.session.commit()
            print("✅ 管理员用户已创建")
        else:
            print("ℹ️ 管理员用户已存在")

if __name__ == "__main__":
    main()







