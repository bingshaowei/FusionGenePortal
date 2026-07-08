// src/App.jsx - 首页/搜索公开访问，SNIFFER需要登录
import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { LanguageProvider } from './contexts/LanguageContext';
import Navbar from './components/Navbar';
import Cover from './pages/Cover';
import Home from './pages/Home';
import Search from './pages/Search';
import Login from './pages/Login';
import Sniffer from './pages/Sniffer';
import FusionDetail from './pages/FusionDetail';
import ChromosomeDetail from './pages/ChromosomeDetail';
import TranscriptomeAnalysis from './pages/TranscriptomeAnalysis';
import ClinicalAnalysis from './pages/ClinicalAnalysis';
import FusionDeletedDetail from './pages/FusionDeletedDetail';
import CellLineFusionDetail from './pages/CellLineFusionDetail';
import DrugSensitivity from './pages/DrugSensitivity';
import DrugGeneSearch from './pages/DrugGeneSearch';

const AppContent = () => {
  const location = useLocation();
  const isCoverPage = location.pathname === '/cover';

  return (
    <>
      {!isCoverPage && <Navbar />}
      
      <div className={isCoverPage ? '' : 'px-4 py-6 max-w-7xl mx-auto'}>
        <Routes>
          {/* ========== 公开路由（无需登录）========== */}
          <Route path="/" element={<Navigate to="/cover" replace />} />
          <Route path="/cover" element={<Cover />} />
          <Route path="/login" element={<Login />} />
          
          {/* 首页 - 公开 */}
          <Route path="/home" element={<Home />} />
          
          {/* 搜索页面 - 公开 */}
          <Route path="/search" element={<Search />} />
          
          {/* 融合基因详情页 - 公开 */}
          <Route path="/fusion/:fusionName" element={<FusionDetail />} />
          
          {/* 低可信度融合基因详情页 - 公开 */}
          <Route path="/fusion-deleted/:fusionName" element={<FusionDeletedDetail />} />
          
          {/* Cell Line 融合基因详情页 - 公开（无 PASS 数据时展示；有则自动跳转 /fusion/） */}
          <Route path="/cellfusion-detail/:fusionName" element={<CellLineFusionDetail />} />
          
          {/* 染色体详情页 - 公开 */}
          <Route path="/chromosome/:chrName" element={<ChromosomeDetail />} />
          
          {/* 转录组分析页 - 公开 */}
          <Route path="/transcriptome/:fusionName" element={<TranscriptomeAnalysis />} />
          
          {/* 临床数据分析页 - 公开 */}
          <Route path="/clinical/:fusionName" element={<ClinicalAnalysis />} />
          
          {/* 药物敏感性分析页 - 公开 */}
          <Route path="/drug-sensitivity/:fusionName" element={<DrugSensitivity />} />

          {/* Drug-Gene 搜索入口页 - 公开 */}
          <Route path="/drug-gene" element={<DrugGeneSearch />} />
          
          {/* ========== SNIFFER - 内部检查登录状态 ========== */}
          <Route path="/sniffer" element={<Sniffer />} />
          
          {/* 404 跳转封面页 */}
          <Route path="*" element={<Navigate to="/cover" replace />} />
        </Routes>
      </div>
    </>
  );
};

const App = () => (
  <BrowserRouter>
    <LanguageProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </LanguageProvider>
  </BrowserRouter>
);

export default App;
