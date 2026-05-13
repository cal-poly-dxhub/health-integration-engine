import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import apiService from '../../services/api';
import './OpenSearchPanel.v2.css';

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
  workflowId = '',
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
  const [hasSearched, setHasSearched] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [filtersVisible, setFiltersVisible] = useState(true);

  const toggleRow = (idx: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handleSearch = async () => {
    setLoading(true);
    setError(null);
    setHasSearched(true);

    try {
      const data = await apiService.post<{
        total: number;
        results: SearchResult[];
      }>('/opensearch/search', {
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
    setSearchParams((prev) => ({ ...prev, [field]: value }));
  };

  const clearSearch = () => {
    setSearchParams({
      searchText: '',
      dataPartnerName: '',
      messageType: '',
      messageControlId: '',
      fillerOrderNumber: '',
      dateRangeDays: 7,
    });
    setResults([]);
    setTotalHits(0);
    setError(null);
    setHasSearched(false);
    setExpandedRows(new Set());
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSearch();
  };

  return (
    <div className="osp-v2-root">
      <header className="osp-v2-header">
        <div>
          <h2 className="osp-v2-title">Message Search</h2>
          <p className="osp-v2-subtitle">
            Search indexed messages across all workflows.
          </p>
        </div>
      </header>

      {/* ---------- Filters ---------- */}
      <form className="osp-v2-filters" onSubmit={handleSubmit}>
        <div className="osp-v2-filters-header">
          <h3 className="osp-v2-filters-title">
            <FilterIcon />
            Filters
          </h3>
          <button
            type="button"
            className="osp-v2-toggle"
            onClick={() => setFiltersVisible((v) => !v)}
          >
            {filtersVisible ? 'Hide filters' : 'Show filters'}
          </button>
        </div>

        {filtersVisible && (
          <>
            <div className="osp-v2-bigsearch-wrap">
              <span className="osp-v2-bigsearch-icon" aria-hidden="true">
                <SearchIcon />
              </span>
              <input
                type="text"
                value={searchParams.searchText}
                onChange={(e) =>
                  handleInputChange('searchText', e.target.value)
                }
                placeholder="Search across all fields (patient, control ID, etc.)"
                className="osp-v2-bigsearch"
                disabled={loading}
              />
            </div>

            <div className="osp-v2-grid">
              <div className="osp-v2-field">
                <label htmlFor="osp-v2-dp" className="osp-v2-label">
                  Data partner
                </label>
                <input
                  id="osp-v2-dp"
                  type="text"
                  value={searchParams.dataPartnerName}
                  onChange={(e) =>
                    handleInputChange('dataPartnerName', e.target.value)
                  }
                  placeholder="e.g. PartnerA"
                  className="osp-v2-input"
                  disabled={loading}
                />
              </div>
              <div className="osp-v2-field">
                <label htmlFor="osp-v2-mt" className="osp-v2-label">
                  Message type
                </label>
                <input
                  id="osp-v2-mt"
                  type="text"
                  value={searchParams.messageType}
                  onChange={(e) =>
                    handleInputChange('messageType', e.target.value)
                  }
                  placeholder="e.g. SIU^S12"
                  className="osp-v2-input"
                  disabled={loading}
                />
              </div>
              <div className="osp-v2-field">
                <label htmlFor="osp-v2-cid" className="osp-v2-label">
                  Message control ID
                </label>
                <input
                  id="osp-v2-cid"
                  type="text"
                  value={searchParams.messageControlId}
                  onChange={(e) =>
                    handleInputChange('messageControlId', e.target.value)
                  }
                  placeholder="Exact ID"
                  className="osp-v2-input"
                  disabled={loading}
                />
              </div>
              <div className="osp-v2-field">
                <label htmlFor="osp-v2-fo" className="osp-v2-label">
                  Filler order # (OBR.4)
                </label>
                <input
                  id="osp-v2-fo"
                  type="text"
                  value={searchParams.fillerOrderNumber}
                  onChange={(e) =>
                    handleInputChange('fillerOrderNumber', e.target.value)
                  }
                  placeholder="Order number"
                  className="osp-v2-input"
                  disabled={loading}
                />
              </div>
              <div className="osp-v2-field">
                <label htmlFor="osp-v2-dr" className="osp-v2-label">
                  Date range
                </label>
                <select
                  id="osp-v2-dr"
                  value={searchParams.dateRangeDays}
                  onChange={(e) =>
                    handleInputChange(
                      'dateRangeDays',
                      parseInt(e.target.value, 10)
                    )
                  }
                  className="osp-v2-select"
                  disabled={loading}
                >
                  <option value={1}>Last 1 day</option>
                  <option value={2}>Last 2 days</option>
                  <option value={7}>Last 7 days</option>
                  <option value={30}>Last 30 days</option>
                </select>
              </div>
            </div>

            <div className="osp-v2-actions">
              <button
                type="button"
                className="osp-v2-btn"
                onClick={clearSearch}
                disabled={loading}
              >
                Clear
              </button>
              <button
                type="submit"
                className="osp-v2-btn osp-v2-btn--primary"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span
                      className="osp-v2-spinner-sm"
                      aria-hidden="true"
                    />
                    Searching…
                  </>
                ) : (
                  <>
                    <SearchIcon />
                    Search
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </form>

      {error && (
        <div className="osp-v2-error" role="alert" aria-live="polite">
          <AlertIcon />
          <span>{error}</span>
        </div>
      )}

      {/* ---------- Results ---------- */}
      <div className="osp-v2-results">
        <div className="osp-v2-results-header">
          <span className="osp-v2-results-count">
            <strong>{totalHits}</strong> result
            {totalHits !== 1 ? 's' : ''}
            {hasSearched ? ' found' : ''}
          </span>
        </div>

        {loading ? (
          <div className="osp-v2-loading">
            <span className="osp-v2-loading-spinner" aria-hidden="true" />
            <span>Searching messages…</span>
          </div>
        ) : results.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="osp-v2-table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}></th>
                  <th>Execution</th>
                  <th>Control ID</th>
                  <th>Type</th>
                  <th>Source (input)</th>
                  <th>Ingested</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result, idx) => {
                  const expanded = expandedRows.has(idx);
                  return (
                    <React.Fragment key={result.messageControlId || idx}>
                      <tr
                        className={
                          expanded ? 'osp-v2-row--expanded' : undefined
                        }
                      >
                        <td>
                          <button
                            type="button"
                            className="osp-v2-expand-btn"
                            onClick={() => toggleRow(idx)}
                            aria-expanded={expanded}
                            aria-label={
                              expanded
                                ? 'Collapse full message'
                                : 'Expand full message'
                            }
                          >
                            {expanded ? '▾' : '▸'}
                          </button>
                        </td>
                        <td>
                          {result.executionId ? (
                            <Link
                              to={`/workflow/${
                                result.workflowId || workflowId
                              }?execution=${result.executionId}`}
                              className="osp-v2-link"
                              title={result.executionId}
                            >
                              {result.executionId
                                .split(':')
                                .pop()
                                ?.slice(0, 12)}
                              …
                            </Link>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="osp-v2-mono">
                          {result.Control_ID ||
                            result.messageControlId ||
                            '—'}
                        </td>
                        <td>
                          {result.Message_Type || result.messageType || '—'}
                        </td>
                        <td>
                          {result.s3Bucket && result.s3Key ? (
                            <span
                              className="osp-v2-s3"
                              title={`${result.s3Bucket}/${result.s3Key}`}
                            >
                              {result.s3Bucket}/{result.s3Key}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          {result.ingestedAt
                            ? new Date(result.ingestedAt).toLocaleString()
                            : '—'}
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="osp-v2-row--expanded-detail">
                          <td colSpan={6}>
                            <div className="osp-v2-expanded-wrap">
                              <h4 className="osp-v2-expanded-title">
                                Full document
                              </h4>
                              <pre className="osp-v2-expanded-pre">
                                {JSON.stringify(result, null, 2)}
                              </pre>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="osp-v2-empty">
            <span className="osp-v2-empty-icon" aria-hidden="true">
              <SearchIcon />
            </span>
            <h3 className="osp-v2-empty-title">
              {hasSearched
                ? 'No messages found'
                : 'Search indexed messages'}
            </h3>
            <p className="osp-v2-empty-sub">
              {hasSearched
                ? 'Try widening your date range or removing some filters.'
                : 'Enter your search criteria above and click Search to query OpenSearch.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default OpenSearchPanel;

/* ---------- Inline SVG icons ---------- */

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  );
}
