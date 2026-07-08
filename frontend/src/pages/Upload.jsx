import React, { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';

const Upload = () => {
  const { t } = useLanguage();
  const { token } = useAuth();
  const [file, setFile] = useState(null);
  const [message, setMessage] = useState('');

  // 未登录用户重定向到登录页
  if (!token) {
    return <Navigate to="/login" replace />;
  }

  const handleFileChange = (e) => {
    setFile(e.target.files[0] || null);
    setMessage('');
  };

  const handleUpload = (e) => {
    e.preventDefault();
    if (!file) return;
    setMessage('');
    const formData = new FormData();
    formData.append('file', file);
    fetch('/api/upload', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token
      },
      body: formData
    })
      .then(res => res.ok ? res.json() : Promise.reject(res.status))
      .then(data => {
        // 根据后端返回判断成功与否
        setMessage(data.success ? t.upload.success : t.upload.failure);
      })
      .catch(err => {
        console.error("Upload error:", err);
        setMessage(t.upload.failure);
      });
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">{t.upload.title}</h1>
      <form onSubmit={handleUpload}>
        <p className="mb-2">{t.upload.hint}</p>
        <input 
          type="file" 
          accept=".csv" 
          onChange={handleFileChange}
          className="mb-4"
        />
        <br />
        <button 
          type="submit" 
          disabled={!file}
          className={`px-4 py-2 rounded text-white ${file ? 'bg-green-600' : 'bg-gray-400'}`}
        >
          {t.upload.button}
        </button>
      </form>
      {message && (
        <p className="mt-4 whitespace-pre-wrap">{message}</p>
      )}
    </div>
  );
};

export default Upload;
