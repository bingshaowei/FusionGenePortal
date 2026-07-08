import React from 'react';
import { Navigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';

const Profile = () => {
  const { t } = useLanguage();
  const { user, logout, authLoading } = useAuth();

  // 未登录则跳转登录页
  if (!user && !authLoading) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">{t.profile.title}</h1>
      {user ? (
        <div className="mb-4">
          <p className="text-lg mb-2">{t.profile.welcome(user.username || user.name || '')}</p>
          {/* 可扩展显示更多用户信息 */}
        </div>
      ) : (
        <p>Loading...</p>
      )}
      <button 
        onClick={() => logout()} 
        className="px-4 py-2 bg-red-600 text-white rounded"
      >
        {t.profile.logout}
      </button>
    </div>
  );
};

export default Profile;
