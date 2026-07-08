import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Search, ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

// 提取基因ID（去掉前面的基因名，保留 ENSG...）
const extractGeneId = (fullName) => {
  if (!fullName) return '';
  const parts = fullName.split('^');
  return parts.length > 1 ? parts[1] : parts[0];
};

// 提取纯基因名（去掉 ^ENSG... 部分）
const extractGeneName = (fullName) => {
  if (!fullName) return '';
  return fullName.split('^')[0];
};

const ChromosomeDetail = () => {
  const { chrName } = useParams();
  const navigate = useNavigate();
  
  const [fusions, setFusions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [uniqueGeneCount, setUniqueGeneCount] = useState(0);
  
  // 排序状态
  const [sortField, setSortField] = useState('fq');
  const [sortOrder, setSortOrder] = useState('desc');
  
  const { t } = useLanguage();
  const CD = t.chromosomeDetail;
  
  const itemsPerPage = 15;

  // 获取涉及基因数（异步统计，不阻塞主流程）
  useEffect(() => {
    const fetchGeneCount = async () => {
      try {
        const token = localStorage.getItem('token');
        // 只获取前1000条用于估算基因数，不影响主流程
        const response = await fetch(
          `/api/fusion/chromosome/${chrName}?page=1&per_page=1000`,
          {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          }
        );
        
        if (response.ok) {
          const result = await response.json();
          const items = result.data.items || [];
          const geneSet = new Set();
          items.forEach(fusion => {
            const leftGene = extractGeneName(fusion.left_gene);
            const rightGene = extractGeneName(fusion.right_gene);
            if (leftGene) geneSet.add(leftGene);
            if (rightGene) geneSet.add(rightGene);
          });
          setUniqueGeneCount(geneSet.size);
        }
      } catch (err) {
        console.error('获取基因数失败:', err);
      }
    };
    
    // 延迟执行，不阻塞主数据加载
    const timer = setTimeout(fetchGeneCount, 500);
    return () => clearTimeout(timer);
  }, [chrName]);

  // 获取分页数据
  useEffect(() => {
    const fetchChromosomeFusions = async () => {
      try {
        setLoading(true);
        const token = localStorage.getItem('token');
        const params = new URLSearchParams({
          page: page.toString(),
          per_page: itemsPerPage.toString(),
          sort_by: sortField,
          sort_order: sortOrder
        });
        
        if (search) {
          params.append('search', search);
        }

        const response = await fetch(
          `/api/fusion/chromosome/${chrName}?${params.toString()}`,
          {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          }
        );

        if (!response.ok) {
          throw new Error(CD.fetchError);
        }

        const result = await response.json();
        setFusions(result.data.items || []);
        setTotal(result.data.total || 0);
        setTotalPages(result.data.pages || 0);
        setLoading(false);
      } catch (err) {
        setError(err.message);
        setLoading(false);
      }
    };

    fetchChromosomeFusions();
  }, [chrName, page, search, sortField, sortOrder]);

  const goToPage = (pageNum) => {
    if (pageNum >= 1 && pageNum <= totalPages) {
      setPage(pageNum);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  };

  const handleFusionClick = (fusionName) => {
    navigate(`/fusion/${encodeURIComponent(fusionName)}`);
  };

  // 排序处理
  const handleSort = (field) => {
    if (sortField === field) {
      // 切换排序顺序
      setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
    } else {
      // 切换排序字段，默认降序
      setSortField(field);
      setSortOrder('desc');
    }
    setPage(1); // 重置到第一页
  };

  // 获取排序图标
  const getSortIcon = (field) => {
    if (sortField !== field) {
      return <ArrowUpDown size={14} className="text-gray-400" />;
    }
    return sortOrder === 'desc' 
      ? <ArrowDown size={14} className="text-blue-600" />
      : <ArrowUp size={14} className="text-blue-600" />;
  };

  if (loading && fusions.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-700 mx-auto mb-4"></div>
            <p className="text-gray-600">{CD.loading(chrName)}</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="bg-red-50 border border-red-200 rounded-2xl shadow-lg p-8">
            <h2 className="text-2xl font-bold text-red-800 mb-4">{CD.loadFailTitle}</h2>
            <p className="text-red-600">{error}</p>
            <button
              onClick={() => navigate('/home')}
              className="mt-4 bg-red-500 text-white px-6 py-2 rounded-lg hover:bg-red-600 transition"
            >
              {CD.backToHome}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 p-6">
      <div className="max-w-[98%] mx-auto space-y-6">
        
        {/* 顶部导航 */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => navigate('/home')}
            className="flex items-center gap-2 bg-white px-4 py-2 rounded-lg shadow hover:shadow-md transition"
          >
            <ArrowLeft size={20} />
            <span>{CD.backToHome}</span>
          </button>
          
          <div className="bg-gradient-to-r from-blue-500 to-purple-500 text-white px-6 py-3 rounded-lg shadow-lg">
            <h1 className="text-2xl font-bold">{CD.chrTitle(chrName)}</h1>
          </div>
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white rounded-xl p-6 shadow-lg">
            <h3 className="text-sm text-gray-600 mb-2">{CD.chrNameLabel}</h3>
            <p className="text-3xl font-bold text-blue-700">{chrName}</p>
          </div>
          <div className="bg-white rounded-xl p-6 shadow-lg">
            <h3 className="text-sm text-gray-600 mb-2">{CD.totalFusions}</h3>
            <p className="text-3xl font-bold text-purple-700">{total.toLocaleString()}</p>
          </div>
          <div className="bg-white rounded-xl p-6 shadow-lg">
            <h3 className="text-sm text-gray-600 mb-2">{CD.genesInvolved}</h3>
            <p className="text-3xl font-bold text-indigo-700">{uniqueGeneCount.toLocaleString()}</p>
          </div>
        </div>

        {/* 搜索区域 */}
        <div className="bg-white rounded-2xl shadow-lg p-6">
          <form onSubmit={handleSearch} className="flex gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
              <input
                type="text"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                placeholder={CD.searchPlaceholder}
                className="w-full pl-10 pr-4 py-3 border-2 border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button
              type="submit"
              className="bg-gradient-to-r from-blue-500 to-blue-600 text-white px-8 py-3 rounded-lg shadow-md hover:shadow-lg hover:scale-105 transition font-semibold"
            >
              {CD.searchBtn}
            </button>
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setSearchInput('');
                  setPage(1);
                }}
                className="bg-gray-400 text-white px-6 py-3 rounded-lg shadow-md hover:bg-gray-500 transition font-semibold"
              >
                {CD.clearBtn}
              </button>
            )}
          </form>
        </div>

        {/* 融合基因列表 */}
        <div className="bg-white rounded-2xl shadow-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold text-blue-900">
              {CD.fusionListTitle} {search && CD.searchLabel(search)}
            </h2>
            <p className="text-sm text-gray-600">
              {CD.sortInfo(sortField === 'fq' ? CD.sortFieldFq : CD.sortFieldFfpm, sortOrder === 'desc' ? CD.sortDesc : CD.sortAsc)}
            </p>
          </div>

          {loading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-700 mx-auto"></div>
              <p className="mt-4 text-gray-600">{CD.loadingMore}</p>
            </div>
          ) : fusions.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500 text-lg">{CD.noData}</p>
              <p className="text-gray-400 text-sm mt-2">{CD.noDataHint}</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gradient-to-r from-blue-100 to-purple-100">
                    <tr>
                      <th className="px-3 py-3 text-left font-bold text-gray-800 whitespace-nowrap">{CD.colFusionName}</th>
                      <th className="px-3 py-3 text-left font-bold text-gray-800">{CD.colLeftGene}</th>
                      <th className="px-3 py-3 text-left font-bold text-gray-800">{CD.colLeftBreakpoint}</th>
                      <th className="px-3 py-3 text-left font-bold text-gray-800">{CD.colRightGene}</th>
                      <th className="px-3 py-3 text-left font-bold text-gray-800">{CD.colRightBreakpoint}</th>
                      <th className="px-3 py-3 text-left font-bold text-gray-800">{CD.colChrBand}</th>
                      <th className="px-3 py-3 text-left font-bold text-gray-800">{CD.colAnnots}</th>
                      <th 
                        className="px-3 py-3 text-left font-bold text-gray-800 cursor-pointer hover:bg-blue-200 transition select-none"
                        onClick={() => handleSort('fq')}
                      >
                        <div className="flex items-center gap-1">
                          {CD.colFrequency}
                          {getSortIcon('fq')}
                        </div>
                      </th>
                      <th 
                        className="px-3 py-3 text-left font-bold text-gray-800 cursor-pointer hover:bg-blue-200 transition select-none"
                        onClick={() => handleSort('avg_ffpm')}
                      >
                        <div className="flex items-center gap-1">
                          Avg FFPM
                          {getSortIcon('avg_ffpm')}
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {fusions.map((fusion, index) => {
                      const rowBg = index % 2 === 0 ? 'bg-white' : 'bg-gray-50';
                      return (
                        <tr key={fusion.id || index} className={`${rowBg} hover:bg-blue-50 transition-colors`}>
                          <td className="px-3 py-3 whitespace-nowrap">
                            <button
                              onClick={() => handleFusionClick(fusion.fusion_name)}
                              className="text-orange-600 hover:text-orange-800 hover:underline font-semibold"
                            >
                              {fusion.fusion_name || 'N/A'}
                            </button>
                          </td>
                          <td className="px-3 py-3">
                            <span className="font-semibold text-blue-700">
                              {extractGeneId(fusion.left_gene) || 'N/A'}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-xs">{fusion.left_breakpoint || 'N/A'}</td>
                          <td className="px-3 py-3">
                            <span className="font-semibold text-purple-700">
                              {extractGeneId(fusion.right_gene) || 'N/A'}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-xs">{fusion.right_breakpoint || 'N/A'}</td>
                          <td className="px-3 py-3 text-xs whitespace-nowrap">
                            <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded mr-1">
                              {fusion.chr_band_a || 'N/A'}
                            </span>
                            <span className="text-gray-400 mx-1">→</span>
                            <span className="bg-purple-100 text-purple-800 px-2 py-1 rounded ml-1">
                              {fusion.chr_band_b || 'N/A'}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-xs max-w-[150px] truncate" title={fusion.annots}>
                            {fusion.annots || 'N/A'}
                          </td>
                          <td className="px-3 py-3 font-semibold text-green-700">{fusion.fq || 0}</td>
                          <td className="px-3 py-3">{fusion.avg_ffpm ? fusion.avg_ffpm.toFixed(3) : 'N/A'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* 分页控件 */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-4 border-t mt-4 flex-wrap gap-3">
                  <div className="text-sm text-gray-600">
                    {CD.showingRange((page - 1) * itemsPerPage + 1, Math.min(page * itemsPerPage, total), total)}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button 
                      onClick={() => goToPage(1)} 
                      disabled={page === 1} 
                      className="px-3 py-2 rounded-lg border border-gray-300 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {CD.firstPage}
                    </button>
                    <button 
                      onClick={() => goToPage(page - 1)} 
                      disabled={page === 1} 
                      className="px-3 py-2 rounded-lg border border-gray-300 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <ChevronLeft size={18} />
                    </button>
                    
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      let pageNum;
                      if (totalPages <= 5) pageNum = i + 1;
                      else if (page <= 3) pageNum = i + 1;
                      else if (page >= totalPages - 2) pageNum = totalPages - 4 + i;
                      else pageNum = page - 2 + i;
                      
                      return (
                        <button
                          key={pageNum}
                          onClick={() => goToPage(pageNum)}
                          className={`px-4 py-2 rounded-lg border ${page === pageNum ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 hover:bg-gray-100'}`}
                        >
                          {pageNum}
                        </button>
                      );
                    })}
                    
                    <button 
                      onClick={() => goToPage(page + 1)} 
                      disabled={page === totalPages} 
                      className="px-3 py-2 rounded-lg border border-gray-300 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <ChevronRight size={18} />
                    </button>
                    <button 
                      onClick={() => goToPage(totalPages)} 
                      disabled={page === totalPages} 
                      className="px-3 py-2 rounded-lg border border-gray-300 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {CD.lastPage}
                    </button>
                    
                    {/* 页码跳转 */}
                    <div className="flex items-center gap-2 ml-4">
                      <span className="text-sm text-gray-600">{CD.goToPage}</span>
                      <input
                        type="number"
                        min="1"
                        max={totalPages}
                        className="w-16 px-2 py-2 border border-gray-300 rounded-lg text-center"
                        onKeyPress={(e) => {
                          if (e.key === 'Enter') {
                            const targetPage = parseInt(e.target.value);
                            if (targetPage >= 1 && targetPage <= totalPages) {
                              goToPage(targetPage);
                              e.target.value = '';
                            }
                          }
                        }}
                        placeholder={page}
                      />
                      <span className="text-sm text-gray-600">{CD.pageInfo(totalPages)}</span>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChromosomeDetail;