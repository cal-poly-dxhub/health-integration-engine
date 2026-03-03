import React, { useState } from 'react';
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
  [key: string]: any;
}

interface OpenSearchPanelProps {
  collectionEndpoint?: string;
  indexName?: string;
}

const OpenSearchPanel: React.FC<OpenSearchPanelProps> = ({ 
  collectionEndpoint: defaultEndpoint = '',
  indexName: defaultIndex = 'health-messages-test'
}) => {
  const [endpoint, setEndpoint] = useState(defaultEndpoint);
  const [indexName, setIndexName] = useState(defaultIndex);
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
  const [showConfig, setShowConfig] = useState(!defaultEndpoint);

  const handleSearch = async () => {
    if (!endpoint) {
      setError('Please configure the OpenSearch endpoint first');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await apiService.post<{ total: number; results: SearchResult[] }>('/opensearch/search', {
        collectionEndpoint: endpoint,
        indexName,
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
        <h3>🔍 Message Search</h3>
        <button 
          className="config-toggle"
          onClick={() => setShowConfig(!showConfig)}
        >
          {showConfig ? 'Hide Config' : 'Show Config'}
        </button>
      </div>

      {showConfig && (
        <div className="opensearch-config">
          <div className="config-row">
            <label>Collection Endpoint</label>
            <input
              type="text"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="https://xxx.us-west-2.aoss.amazonaws.com"
            />
          </div>
          <div className="config-row">
            <label>Index Name</label>
            <input
              type="text"
              value={indexName}
              onChange={(e) => setIndexName(e.target.value)}
              placeholder="health-messages-test"
            />
          </div>
        </div>
      )}

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
                  <th>Control ID</th>
                  <th>Type</th>
                  <th>Partner</th>
                  <th>Order #</th>
                  <th>Ingested</th>
                  <th>S3 Location</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result, idx) => (
                  <tr key={result.messageControlId || idx}>
                    <td className="mono">{result.messageControlId || '-'}</td>
                    <td>{result.messageType || '-'}</td>
                    <td>{result.dataPartnerName || '-'}</td>
                    <td className="mono">{result.fillerOrderNumber || '-'}</td>
                    <td>{result.ingestedAt ? new Date(result.ingestedAt).toLocaleString() : '-'}</td>
                    <td className="s3-location">
                      {result.s3Bucket && result.s3Key ? (
                        <span title={`s3://${result.s3Bucket}/${result.s3Key}`}>
                          {result.s3Key.split('/').pop()}
                        </span>
                      ) : '-'}
                    </td>
                  </tr>
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
