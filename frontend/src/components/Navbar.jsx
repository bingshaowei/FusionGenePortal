import React from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';

const Navbar = () => {
  const { language, setLanguage, t } = useLanguage();
  const { user, logout } = useAuth();
  const toggleLangLabel = language === 'en' ? '中文' : 'EN';

  return (
    <header className="w-full relative z-10 shadow-md">
      {/* 背景图层 */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: "url('/zju_background.png')",
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          zIndex: -2,
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-r from-blue-900/80 to-indigo-800/80 backdrop-blur-md z-0" />

      <nav className="relative max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        {/* Logo */}
        <Link
          to="/home"
          className="text-3xl font-extrabold text-white drop-shadow-xl tracking-wide hover:scale-105 transition-transform"
        >
          {t.siteName}
        </Link>

        {/* 菜单项：首页 | 搜索 | SNIFFER | 登录/头像 | EN */}
        <ul className="flex items-center space-x-6 text-white font-medium text-base">
          {/* 首页 */}
          <li>
            <Link to="/home" className="hover:text-blue-200 transition">
              {t.nav.home}
            </Link>
          </li>
          
          {/* 搜索 */}
          <li>
            <Link to="/search" className="hover:text-blue-200 transition">
              {t.nav.search}
            </Link>
          </li>

          {/* Drug-Gene */}
          <li>
            <Link to="/drug-gene" className="hover:text-blue-200 transition">
              Drug-Gene
            </Link>
          </li>
          
          {/* SNIFFER */}
          <li>
            <Link to="/sniffer" className="hover:text-blue-200 transition">
              {t.nav.sniffer}
            </Link>
          </li>
          
          {/* 登录/头像 */}
          {user ? (
            <li className="relative group">
              {/* 头像 */}
              <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-white cursor-pointer hover:border-blue-300 transition">
                <svg 
                  viewBox="0 0 100 100" 
                  className="w-full h-full bg-gradient-to-br from-blue-400 to-purple-500"
                >
                  {/* 简约用户头像 SVG */}
                  <circle cx="50" cy="35" r="20" fill="white" opacity="0.9"/>
                  <ellipse cx="50" cy="85" rx="30" ry="25" fill="white" opacity="0.9"/>
                  {/* 装饰眼睛和微笑 */}
                  <circle cx="42" cy="32" r="3" fill="#6366f1"/>
                  <circle cx="58" cy="32" r="3" fill="#6366f1"/>
                  <path d="M 42 42 Q 50 48 58 42" stroke="#6366f1" strokeWidth="2" fill="none"/>
                </svg>
              </div>
              
              {/* 下拉菜单 */}
              <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                <div className="px-4 py-3 border-b border-gray-100">
                  <p className="text-sm text-gray-500">{language === 'zh' ? '登录账户' : 'Logged in as'}</p>
                  <p className="text-sm font-semibold text-gray-800 truncate">{user.username}</p>
                </div>
                <button
                  onClick={logout}
                  className="w-full text-left px-4 py-3 text-sm text-red-600 hover:bg-red-50 transition rounded-b-lg"
                >
                  {t.profile?.logout || '退出登录'}
                </button>
              </div>
            </li>
          ) : (
            <li>
              <Link to="/login" className="hover:text-blue-200 transition">
                {t.nav.login}
              </Link>
            </li>
          )}
          
          {/* 切换语言按钮 - 放在最后 */}
          <li>
            <button
              onClick={() => setLanguage(language === 'en' ? 'zh' : 'en')}
              className="bg-white/80 text-gray-900 px-3 py-1.5 rounded-full shadow hover:bg-white transition font-semibold"
            >
              {toggleLangLabel}
            </button>
          </li>
        </ul>
      </nav>
    </header>
  );
};

export default Navbar;

