// src/contexts/AuthContext.jsx
import React, { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

// 🔧 API 基础地址 - 确保指向后端
const API_BASE = '';

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  // 初始化：检查本地存储
  useEffect(() => {
    const storedToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');
    
    if (storedToken && storedUser) {
      try {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
        console.log('✅ 已恢复登录状态');
      } catch (e) {
        console.error('解析用户信息失败:', e);
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      }
    }
    
    setLoading(false);
  }, []);

  // 登录函数
  const login = async (username, password) => {
    try {
      // 🔧 使用绝对路径！
      const response = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, password })
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        const newToken = data.access_token;
        const userData = { username: data.username };
        
        localStorage.setItem('token', newToken);
        localStorage.setItem('user', JSON.stringify(userData));
        setToken(newToken);
        setUser(userData);
        
        console.log('✅ 登录成功:', data.username);
        return { success: true };
      } else {
        console.error('❌ 登录失败:', data.message);
        return { success: false, message: data.message || '登录失败' };
      }
    } catch (error) {
      console.error('❌ 登录请求失败:', error);
      return { success: false, message: '网络错误，请重试' };
    }
  };

  // 退出登录
  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    // 清除 SNIFFER 任务状态
    localStorage.removeItem('sniffer_task');
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};