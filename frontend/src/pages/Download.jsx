// Download.jsx
import React, { useEffect, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { saveAs } from 'file-saver';

const Download = () => {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState([]);
  const [selectAll, setSelectAll] = useState(false);

  useEffect(() => {
    if (selectAll) {
      setSelected(results.map(row => row.id));
    } else {
      setSelected([]);
    }
  }, [selectAll]);

  const handleSearch = async () => {
    const res = await fetch(`/api/fusions?query=${query}`);
    const data = await res.json();
    setResults(data.results || data);
    setSelected([]);
    setSelectAll(false);
  };

  const toggleRow = (id) => {
    setSelected(prev => prev.includes(id)
      ? prev.filter(x => x !== id)
      : [...prev, id]
    );
  };

  const exportSelected = () => {
    const selectedRows = results.filter(row => selected.includes(row.id));
    const headers = Object.keys(selectedRows[0] || {});
    const csv = [headers.join(',')].concat(
      selectedRows.map(row => headers.map(h => row[h]).join(','))
    ).join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    saveAs(blob, 'selected_fusions.csv');
  };

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">{t.download.title}</h1>

      {/* 全部数据 / 示例下载 */}
      <div className="mb-6 space-x-4">
        <a href="/api/download?all=true" className="px-4 py-2 bg-gray-800 text-white rounded">{t.download.allData}</a>
        <a href="/api/download?sample=true" className="px-4 py-2 bg-gray-800 text-white rounded">{t.download.sample}</a>
      </div>

      {/* 搜索 + 多选导出 */}
      <div className="mb-4">
        <input 
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t.search.placeholder}
          className="border px-3 py-1 mr-2"
        />
        <button onClick={handleSearch} className="bg-blue-600 text-white px-4 py-1 rounded">{t.search.searchButton}</button>
      </div>

      {results.length > 0 && (
        <div className="mb-4">
          <label className="inline-flex items-center mb-2">
            <input type="checkbox" checked={selectAll} onChange={e => setSelectAll(e.target.checked)} className="mr-2" /> 全选
          </label>
          <table className="w-full table-auto border">
            <thead>
              <tr className="bg-gray-100">
                <th></th>
                <th>{t.search.fusion}</th>
                <th>{t.search.leftChr}</th>
                <th>{t.search.rightChr}</th>
                <th>{t.search.junction}</th>
                <th>{t.search.spanning}</th>
              </tr>
            </thead>
            <tbody>
              {results.map(row => (
                <tr key={row.id} className="border-t">
                  <td>
                    <input 
                      type="checkbox"
                      checked={selected.includes(row.id)}
                      onChange={() => toggleRow(row.id)}
                    />
                  </td>
                  <td>{row.fusionName}</td>
                  <td>{row.leftChr}</td>
                  <td>{row.rightChr}</td>
                  <td>{row.junctionReadCount}</td>
                  <td>{row.spanningFragCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {selected.length > 0 && (
            <button
              onClick={exportSelected}
              className="mt-4 bg-green-600 text-white px-4 py-2 rounded"
            >导出选中为 CSV</button>
          )}
        </div>
      )}
    </div>
  );
};

export default Download;
