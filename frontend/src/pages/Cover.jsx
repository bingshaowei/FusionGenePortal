// src/pages/Cover.jsx
import React from 'react';
import { useNavigate } from 'react-router-dom';

const Cover = () => {
  const navigate = useNavigate();

  const handleStart = () => {
    navigate('/home');
  };

  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-center bg-cover bg-center relative"
      style={{
        backgroundImage: "url('/dynamic-wallpaper.gif')",
        backgroundSize: 'cover',
        backgroundRepeat: 'no-repeat',
        backgroundAttachment: 'fixed',
      }}
    >
      {/* 半透明内容容器 */}
      <div className="relative z-10 w-full max-w-7xl mx-auto p-6 space-y-12 bg-white/10 backdrop-blur-md rounded-xl shadow-lg mt-20 mb-20">
        
        {/* 大标题 */}
        <div className="text-center animate-fadeInDown">
          <h1 className="text-4xl md:text-5xl font-extrabold text-blue-900 leading-snug">
            Zhejiang University College of Pharmaceutical Sciences <br /> Pediatric Oncology Pharmacology Division
          </h1>
        </div>

        {/* 四个功能块 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 animate-fadeInUp">
          {[
            {
              title: "Fusion Gene Sharing Platform",
              description: "A standardized and visualized service for fusion gene data sharing to promote integration and collaboration."
            },
            {
              title: "Sniffer Algorithm & Fusion Analysis Platform",
              description: "Efficiently and accurately detect and analyze fusion genes using the Sniffer algorithm."
            },
            {
              title: "Gene & Sample Drug Sensitivity Analysis",
              description: "Explore potential therapeutic targets and resistance mechanisms based on gene expression and drug sensitivity data."
            },
            {
              title: "Multi-Omics Analysis Platform",
              description: "Integrate genomic and transcriptomic data to reveal biological characteristics of pediatric tumors."
            }
          ].map((item, index) => (
            <div
              key={index}
              className="bg-white/70 rounded-xl p-6 shadow-md hover:shadow-lg transition transform hover:-translate-y-1"
            >
              <h2 className="text-2xl font-bold text-blue-700 mb-2">{item.title}</h2>
              <p className="text-gray-700 text-sm">{item.description}</p>
            </div>
          ))}
        </div>

        {/* Start Exploring 按钮 */}
        <div className="flex justify-center animate-fadeInUp">
          <button
            onClick={handleStart}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-full shadow-xl transform hover:scale-105 transition"
          >
            Start Exploring →
          </button>
        </div>

      </div>
    </div>
  );
};

export default Cover;

