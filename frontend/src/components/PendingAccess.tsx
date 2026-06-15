import { useAuth } from '../contexts/AuthContext';
import { useMe } from '../contexts/MeContext';

interface PendingAccessProps {
  onSignOut: () => void;
}

/**
 * Shown to authenticated users who don't yet belong to any team and aren't
 * admins. The account is created in Cognito but cannot do anything until
 * an admin assigns them to a team.
 */
export default function PendingAccess({ onSignOut }: PendingAccessProps) {
  const { user } = useAuth();
  const { refresh, loading } = useMe();

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      padding: 24,
      background: '#f5f6f8',
    }}>
      <div style={{
        maxWidth: 480,
        width: '100%',
        background: '#fff',
        padding: 32,
        borderRadius: 12,
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.08)',
        textAlign: 'center',
      }}>
        <div style={{
          width: 56,
          height: 56,
          borderRadius: '50%',
          background: '#fef3c7',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 16,
        }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#92400e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </div>

        <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>
          Account pending
        </h1>

        <p style={{ color: '#6b7280', marginBottom: 8 }}>
          Welcome{user?.givenName ? `, ${user.givenName}` : ''}. Your account
          ({user?.email}) was created successfully.
        </p>

        <p style={{ color: '#6b7280', marginBottom: 24 }}>
          An administrator needs to add you to a team before you can access
          workflows. Please reach out to your team admin if this is taking
          longer than expected.
        </p>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button
            type="button"
            onClick={() => refresh()}
            disabled={loading}
            style={{
              padding: '10px 20px',
              background: '#2563eb',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 500,
              cursor: loading ? 'wait' : 'pointer',
            }}
          >
            {loading ? 'Checking…' : 'Check again'}
          </button>

          <button
            type="button"
            onClick={onSignOut}
            style={{
              padding: '10px 20px',
              background: '#fff',
              color: '#374151',
              border: '1px solid #d1d5db',
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
