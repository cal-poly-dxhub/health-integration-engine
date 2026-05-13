import { useNavigate } from 'react-router-dom';
import OpenSearchPanel from './workflow/OpenSearchPanel';
import './GlobalSearchPage.css';

export default function GlobalSearchPage() {
  const navigate = useNavigate();

  return (
    <div className="message-search-page">
      <div className="message-search-header">
        <div className="header-content">
          <h2>Search Messages</h2>
          <p>Search indexed messages across all workflows</p>
        </div>
        <div className="header-actions">
          <button className="message-search-back-btn" onClick={() => navigate('/dashboard')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12,19 5,12 12,5" />
            </svg>
            Back to Dashboard
          </button>
        </div>
      </div>
      <main className="message-search-main">
        <OpenSearchPanel />
      </main>
    </div>
  );
}

