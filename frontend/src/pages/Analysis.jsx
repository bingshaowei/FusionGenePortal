// Analysis.jsx
import React, { useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import CircosChart from '../components/CircosChart';
import BarChart from '../components/BarChart';

const Analysis = () => {
  const { t } = useLanguage();
  const [file, setFile] = useState(null);
  const [csvFusions, setCsvFusions] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [selectedFusions, setSelectedFusions] = useState([]);
  const [fastaFile, setFastaFile] = useState(null);
  const [snifferResults, setSnifferResults] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState('');

  const handleCsvUpload = async () => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/analyze', { method: 'POST', body: formData });
    const data = await res.json();
    setCsvFusions(data.fusions);
  };

  const handleSearch = async () => {
    const res = await fetch(`/api/fusions?query=${searchQuery}`);
    const data = await res.json();
    setSearchResults(data.results || data);
  };

  const toggleFusion = (fusion) => {
    const exists = selectedFusions.find(f => f.id === fusion.id);
    if (exists) {
      setSelectedFusions(selectedFusions.filter(f => f.id !== fusion.id));
    } else {
      setSelectedFusions([...selectedFusions, fusion]);
    }
  };

  const handleSnifferUpload = async () => {
    const formData = new FormData();
    formData.append('fasta', fastaFile);
    const res = await fetch('/api/sniffer', { method: 'POST', body: formData });
    const data = await res.json();
    setSnifferResults(data.fusions);
  };

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">{t.analysis.title}</h1>

      {/* CSV 上传分析 */}
      <input type="file" accept=".csv" onChange={e => setFile(e.target.files[0])} />
      <button onClick={handleCsvUpload} className="ml-2 px-3 py-1 bg-blue-600 text-white rounded">{t.analysis.button}</button>
      {csvFusions.length > 0 && <CircosChart fusions={csvFusions} />}

      {/* 搜索并选择融合 */}
      <div className="mt-6">
        <h2 className="text-xl font-semibold mb-2">搜索融合基因</h2>
        <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="TPM3, chr1..." className="border px-2 py-1 mr-2" />
        <button onClick={handleSearch} className="px-3 py-1 bg-gray-700 text-white rounded">搜索</button>
        <div className="mt-2">
          {searchResults.map(f => (
            <div key={f.id} className="flex justify-between items-center border-b py-1">
              <span>{f.fusionName}</span>
              <button onClick={() => toggleFusion(f)} className="text-blue-600 underline">
                {selectedFusions.find(sel => sel.id === f.id) ? '取消' : '加入分析'}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Circos 图 / 频次图 */}
      <div className="mt-6">
        {selectedFusions.length > 0 && <>
          <h2 className="text-xl font-semibold mb-2">Circos图 & 基因频次图</h2>
          <CircosChart fusions={selectedFusions} />
          <BarChart fusions={selectedFusions} />
        </>}
      </div>

      {/* Sniffer FASTA 上传分析 */}
      <div className="mt-6">
        <h2 className="text-xl font-semibold mb-2">Sniffer FASTA 分析</h2>
        <input type="file" accept=".fasta,.fa" onChange={e => setFastaFile(e.target.files[0])} />
        <button onClick={handleSnifferUpload} className="ml-2 px-3 py-1 bg-green-600 text-white rounded">运行分析</button>
        {snifferResults.length > 0 && <CircosChart fusions={snifferResults} />}
      </div>
    </div>
  );
};

export default Analysis;