import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import apiService from '../../services/api';
import './OpenSearchPanel.css';

interface SearchResult {
  messageControlId?: string;
  messageType?: string;
  dataPartnerName?: string;
  patientBirthDate?: string;
  fillerOrderNumber?: string;
  ingestedAt?: string;
  s3Bucket?: string;
  s3Key?: string;
  outputS3Bucket?: string;
  outputS3Key?: string;
  executionId?: string;
  workflowId?: string;
  [key: string]: any;
}

interface OpenSearchPanelProps {
  indexName?: string;
  workflowId?: string;
}

const OpenSearchPanel: React.FC<OpenSearchPanelProps> = ({ 
  indexName: defaultIndex = 'health-messages',
  workflowId = ''
}) => {
  const [indexName] = useState(defaultIndex);
  const [searchParams, setSearchParams] = useState({
    searchText: '',
    dataPartnerName: '',
    messageType: '',
    messageControlId: '',
    fillerOrderNumber: '',
    dateRangeDays: 7,
  });
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalHits, setTotalHits] = useState(0);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [filtersVisible, setFiltersVisible] = useState(true);

  const toggleRow = (idx: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  const handleSearch = async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await apiService.post<{ total: number; results: SearchResult[] }>('/opensearch/search', {
        indexName,
        workflowId,
        query: {
          searchText: searchParams.searchText || undefined,
          dataPartnerName: searchParams.dataPartnerName || undefined,
          messageType: searchParams.messageType || undefined,
          messageControlId: searchParams.messageControlId || undefined,
          fillerOrderNumber: searchParams.fillerOrderNumber || undefined,
        },
        searchConfig: {
          dateRangeField: 'ingestedAt',
          dateRangeDays: searchParams.dateRangeDays,
        },
      });

      setResults(data.results || []);
      setTotalHits(data.total || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (field: string, value: string | number) => {
    setSearchParams(prev => ({ ...prev, [field]: value }));
  };

  const clearSearch = () => {
    setSearchParams({
      searchText: '',
      dataPartnerName: '',
      messageType: '',
      messageControlId: '',
      fillerOrderNumber: '',
      dateRangeDays: 2,
    });
    setResults([]);
    setTotalHits(0);
    setError(null);
  };

  return (
    <div className="opensearch-panel">
      <div className="opensearch-header">
        <h3>Message Search</h3>
        <button className="filters-toggle" onClick={() => setFiltersVisible(v => !v)}>
          {filtersVisible ? 'Hide filters' : 'Show filters'}
        </button>
      </div>

      {filtersVisible && (
      <div className="search-filters">
        <div className="filter-row">
          <div className="filter-group full-width">
            <label>Search (Patient, Control ID, etc.)</label>
            <input
              type="text"
              value={searchParams.searchText}
              onChange={(e) => handleInputChange('searchText', e.target.value)}
              placeholder="Search across all fields..."
            />
          </div>
        </div>

        <div className="filter-row">
          <div className="filter-group">
            <label>Data Partner</label>
            <input
              type="text"
              value={searchParams.dataPartnerName}
              onChange={(e) => handleInputChange('dataPartnerName', e.target.value)}
              placeholder="e.g., PartnerA"
            />
          </div>
          <div className="filter-group">
            <label>Message Type</label>
            <input
              type="text"
              value={searchParams.messageType}
              onChange={(e) => handleInputChange('messageType', e.target.value)}
              placeholder="e.g., SIU^S12"
            />
          </div>
        </div>

        <div className="filter-row">
          <div className="filter-group">
            <label>Message Control ID</label>
            <input
              type="text"
              value={searchParams.messageControlId}
              onChange={(e) => handleInputChange('messageControlId', e.target.value)}
              placeholder="Exact ID"
            />
          </div>
          <div className="filter-group">
            <label>Filler Order # (OBR.4)</label>
            <input
              type="text"
              value={searchParams.fillerOrderNumber}
              onChange={(e) => handleInputChange('fillerOrderNumber', e.target.value)}
              placeholder="Order number"
            />
          </div>
        </div>

        <div className="filter-row">
          <div className="filter-group">
            <label>Date Range (days)</label>
            <select
              value={searchParams.dateRangeDays}
              onChange={(e) => handleInputChange('dateRangeDays', parseInt(e.target.value))}
            >
              <option value={1}>Last 1 day</option>
              <option value={2}>Last 2 days</option>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
            </select>
          </div>
          <div className="filter-actions">
            <button className="btn-search" onClick={handleSearch} disabled={loading}>
              {loading ? 'Searching...' : 'Search'}
            </button>
            <button className="btn-clear" onClick={clearSearch}>
              Clear
            </button>
          </div>
        </div>
      </div>
      )}

      {error && (
        <div className="search-error">
          ⚠️ {error}
        </div>
      )}

      <div className="search-results">
        <div className="results-header">
          <span>{totalHits} result{totalHits !== 1 ? 's' : ''} found</span>
        </div>

        {results.length > 0 ? (
          <div className="results-table-container">
            <table className="results-table">
              <thead>
                <tr>
                  <th style={{ width: '40px' }}></th>
                  <th>Execution</th>
                  <th>Control ID</th>
                  <th>Type</th>
                  <th>Source (Input)</th>
                  <th>Ingested</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result, idx) => (
                  <React.Fragment key={result.messageControlId || idx}>
                    <tr className={expandedRows.has(idx) ? 'row-expanded' : ''}>
                      <td>
                        <button
                          className="expand-toggle"
                          onClick={() => toggleRow(idx)}
                          aria-expanded={expandedRows.has(idx)}
                          aria-label={expandedRows.has(idx) ? 'Collapse full message' : 'Expand full message'}
                        >
                          {expandedRows.has(idx) ? '▾' : '▸'}
                        </button>
                      </td>
                      <td>
                        {result.executionId ? (
                          <Link 
                            to={`/workflow/${result.workflowId || workflowId}?execution=${result.executionId}`}
                            className="execution-link"
                            title={result.executionId}
                          >
                            {result.executionId.split(':').pop()?.slice(0, 12)}...
                          </Link>
                        ) : '-'}
                      </td>
                      <td className="mono">{result.Control_ID || result.messageControlId || '-'}</td>
                      <td>{result.Message_Type || result.messageType || '-'}</td>
                      <td className="s3-location" title={result.s3Bucket && result.s3Key ? `${result.s3Bucket}/${result.s3Key}` : ''}>
                        {result.s3Bucket && result.s3Key ? `${result.s3Bucket}/${result.s3Key}` : '-'}
                      </td>
                      <td>{result.ingestedAt ? new Date(result.ingestedAt).toLocaleString() : '-'}</td>
                    </tr>
                    {expandedRows.has(idx) && (
                      <tr className="expanded-row">
                        <td colSpan={6}>
                          <div className="full-message-container">
                            <div className="full-message-header">Full Document</div>
                            <pre className="full-message-content">{JSON.stringify(result, null, 2)}</pre>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : !loading && (
          <div className="no-results">
            {totalHits === 0 && searchParams.dataPartnerName === '' && searchParams.messageControlId === '' 
              ? 'Enter search criteria and click Search'
              : 'No messages found matching your criteria'}
          </div>
        )}
      </div>
    </div>
  );
};

export default OpenSearchPanel;
