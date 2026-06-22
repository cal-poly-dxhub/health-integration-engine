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
  allowedWorkflowIds?: string[];
  /**
   * Selected team from the dashboard team switcher. Sent to the backend, which
   * authorizes it server-side and narrows the search scope to that team's
   * workflows. When omitted, the backend scopes to all of the caller's teams.
   */
  teamId?: string;
}

const OpenSearchPanel: React.FC<OpenSearchPanelProps> = ({
  indexName: defaultIndex = 'health-messages',
  workflowId = '',
  allowedWorkflowIds,
  teamId,
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
        teamId: teamId || undefined,
        allowedWorkflowIds: allowedWorkflowIds ? allowedWorkflowIds : undefined,
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
    <div className="osp-root">
      <header className="osp-header">
        <div>
          <h2 className="osp-title">Message Search</h2>
          <p className="osp-subtitle">
            Search indexed messages across your deployed workflows.
          </p>
        </div>
      </header>

      {/* ---------- Filters ---------- */}
      <form className="osp-filters" onSubmit={handleSubmit}>
        <div className="osp-filters-header">
          <h3 className="osp-filters-title">
            <FilterIcon />
            Filters
          </h3>
          <button
            type="button"
            className="osp-toggle"
            onClick={() => setFiltersVisible((v) => !v)}
          >
            {filtersVisible ? 'Hide filters' : 'Show filters'}
          </button>
        </div>

        {filtersVisible && (
          <>
            <div className="osp-bigsearch-wrap">
              <span className="osp-bigsearch-icon" aria-hidden="true">
                <SearchIcon />
              </span>
              <input
                type="text"
                value={searchParams.searchText}
                onChange={(e) =>
                  handleInputChange('searchText', e.target.value)
                }
                placeholder="Search across all fields (patient, control ID, etc.)"
                className="osp-bigsearch"
                disabled={loading}
              />
            </div>

            <div className="osp-grid">
              <div className="osp-field">
                <label htmlFor="osp-dp" className="osp-label">
                  Data partner
                </label>
                <input
                  id="osp-dp"
                  type="text"
                  value={searchParams.dataPartnerName}
                  onChange={(e) =>
                    handleInputChange('dataPartnerName', e.target.value)
                  }
                  placeholder="e.g. PartnerA"
                  className="osp-input"
                  disabled={loading}
                />
              </div>
              <div className="osp-field">
                <label htmlFor="osp-mt" className="osp-label">
                  Message type
                </label>
                <input
                  id="osp-mt"
                  type="text"
                  value={searchParams.messageType}
                  onChange={(e) =>
                    handleInputChange('messageType', e.target.value)
                  }
                  placeholder="e.g. SIU^S12"
                  className="osp-input"
                  disabled={loading}
                />
              </div>
              <div className="osp-field">
                <label htmlFor="osp-cid" className="osp-label">
                  Message control ID
                </label>
                <input
                  id="osp-cid"
                  type="text"
                  value={searchParams.messageControlId}
                  onChange={(e) =>
                    handleInputChange('messageControlId', e.target.value)
                  }
                  placeholder="Exact ID"
                  className="osp-input"
                  disabled={loading}
                />
              </div>
              <div className="osp-field">
                <label htmlFor="osp-fo" className="osp-label">
                  Filler order # (OBR.4)
                </label>
                <input
                  id="osp-fo"
                  type="text"
                  value={searchParams.fillerOrderNumber}
                  onChange={(e) =>
                    handleInputChange('fillerOrderNumber', e.target.value)
                  }
                  placeholder="Order number"
                  className="osp-input"
                  disabled={loading}
                />
              </div>
              <div className="osp-field">
                <label htmlFor="osp-dr" className="osp-label">
                  Date range
                </label>
                <select
                  id="osp-dr"
                  value={searchParams.dateRangeDays}
                  onChange={(e) =>
                    handleInputChange(
                      'dateRangeDays',
                      parseInt(e.target.value, 10)
                    )
                  }
                  className="osp-select"
                  disabled={loading}
                >
                  <option value={1}>Last 1 day</option>
                  <option value={2}>Last 2 days</option>
                  <option value={7}>Last 7 days</option>
                  <option value={30}>Last 30 days</option>
                </select>
              </div>
            </div>

            <div className="osp-actions">
              <button
                type="button"
                className="osp-btn"
                onClick={clearSearch}
                disabled={loading}
              >
                Clear
              </button>
              <button
                type="submit"
                className="osp-btn osp-btn--primary"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span
                      className="osp-spinner-sm"
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
        <div className="osp-error" role="alert" aria-live="polite">
          <AlertIcon />
          <span>{error}</span>
        </div>
      )}

      {/* ---------- Results ---------- */}
      <div className="osp-results">
        <div className="osp-results-header">
          <span className="osp-results-count">
            <strong>{totalHits}</strong> result
            {totalHits !== 1 ? 's' : ''}
            {hasSearched ? ' found' : ''}
          </span>
        </div>

        {loading ? (
          <div className="osp-loading">
            <span className="osp-loading-spinner" aria-hidden="true" />
            <span>Searching messages…</span>
          </div>
        ) : results.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="osp-table">
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
                          expanded ? 'osp-row--expanded' : undefined
                        }
                      >
                        <td>
                          <button
                            type="button"
                            className="osp-expand-btn"
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
                              className="osp-link"
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
                        <td className="osp-mono">
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
                              className="osp-s3"
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
                        <tr className="osp-row--expanded-detail">
                          <td colSpan={6}>
                            <div className="osp-expanded-wrap">
                              <h4 className="osp-expanded-title">
                                Full document
                              </h4>
                              <pre className="osp-expanded-pre">
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
          <div className="osp-empty">
            <span className="osp-empty-icon" aria-hidden="true">
              <SearchIcon />
            </span>
            <h3 className="osp-empty-title">
              {hasSearched
                ? 'No messages found'
                : 'Search indexed messages'}
            </h3>
            <p className="osp-empty-sub">
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
