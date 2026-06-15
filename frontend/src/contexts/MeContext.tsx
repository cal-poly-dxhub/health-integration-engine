import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { teamApiService, MeResponse, MyTeam } from '../services/teamApi';
import { useAuth } from './AuthContext';

interface MeContextType {
  me: MeResponse | null;
  loading: boolean;
  error: string | null;
  selectedTeamId: string | null;
  selectTeam: (teamId: string | null) => void;
  refresh: () => Promise<void>;
  /** True when the authenticated user has no teams and isn't admin. */
  pending: boolean;
  /** Helper: writer or admin on the currently selected team (or any team if none selected). */
  canWriteSelected: boolean;
  /** Memberships keyed by teamId for O(1) lookup. */
  teamsById: Record<string, MyTeam>;
  /** All known team names by teamId (own teams + admin-loaded full list). */
  teamNamesById: Record<string, string>;
  /** True once team-name data is resolved (for admins, after the full team
   *  list loads). Lets the UI avoid flashing raw team IDs before names exist. */
  teamNamesReady: boolean;
  /** All teams the caller can target for "create workflow in" — own writer
   *  teams for non-admins, every team in the system for admins. */
  allTeamsForAdmin: { teamId: string; name: string }[];
}

const MeContext = createContext<MeContextType | undefined>(undefined);

const SELECTED_TEAM_KEY = 'selected_team_id';

export const MeProvider = ({ children }: { children: ReactNode }) => {
  const { isAuthenticated } = useAuth();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(SELECTED_TEAM_KEY);
    } catch {
      return null;
    }
  });
  // Admins aren't in any team's Memberships row, so /me/teams returns []. We
  // need the full list to resolve team names and populate the team picker.
  const [allTeamsForAdmin, setAllTeamsForAdmin] = useState<{ teamId: string; name: string }[]>([]);
  // Tracks whether the admin full-team-list fetch has settled, so we can tell
  // "still loading names" apart from "genuinely no teams".
  const [adminTeamsLoaded, setAdminTeamsLoaded] = useState(false);

  const refresh = useCallback(async () => {
    if (!isAuthenticated) {
      setMe(null);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const result = await teamApiService.getMe();
      setMe(result);

      // If selected team is no longer in the user's list, reset.
      if (selectedTeamId && !result.teams.some(t => t.teamId === selectedTeamId)) {
        setSelectedTeamId(null);
        try { localStorage.removeItem(SELECTED_TEAM_KEY); } catch {}
      }
      // Default-select if exactly one team and nothing chosen.
      if (!selectedTeamId && result.teams.length === 1) {
        setSelectedTeamId(result.teams[0].teamId);
        try { localStorage.setItem(SELECTED_TEAM_KEY, result.teams[0].teamId); } catch {}
      }
    } catch (e) {
      console.error('Failed to load me:', e);
      setError(e instanceof Error ? e.message : 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, selectedTeamId]);

  useEffect(() => {
    if (isAuthenticated) {
      refresh();
    } else {
      setMe(null);
      setAllTeamsForAdmin([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  // Admin-only: fetch the full team list so we can resolve team names for
  // workflows belonging to teams the admin isn't a member of.
  useEffect(() => {
    if (!me?.isAdmin) {
      setAllTeamsForAdmin([]);
      setAdminTeamsLoaded(false);
      return;
    }
    let cancelled = false;
    setAdminTeamsLoaded(false);
    teamApiService
      .listTeams()
      .then((teams) => {
        if (!cancelled) {
          setAllTeamsForAdmin(teams.map((t) => ({ teamId: t.teamId, name: t.name })));
        }
      })
      .catch((e) => console.warn('Failed to load full team list:', e))
      .finally(() => {
        // Mark settled on both success and failure so the UI never hangs on
        // the team-name loading state — a failed lookup falls back to the ID.
        if (!cancelled) setAdminTeamsLoaded(true);
      });
    return () => { cancelled = true; };
  }, [me?.isAdmin]);

  const selectTeam = useCallback((teamId: string | null) => {
    setSelectedTeamId(teamId);
    try {
      if (teamId) localStorage.setItem(SELECTED_TEAM_KEY, teamId);
      else localStorage.removeItem(SELECTED_TEAM_KEY);
    } catch {}
  }, []);

  const teamsById: Record<string, MyTeam> = {};
  (me?.teams || []).forEach(t => { teamsById[t.teamId] = t; });

  // Merged name lookup — own memberships first, then any admin-fetched teams.
  const teamNamesById: Record<string, string> = {};
  (me?.teams || []).forEach((t) => { teamNamesById[t.teamId] = t.name; });
  allTeamsForAdmin.forEach((t) => { teamNamesById[t.teamId] = t.name; });

  const pending = me ? me.pending : false;

  // Team names are "ready" once we have the data needed to resolve them:
  // non-admins get names straight from me.teams; admins additionally need the
  // full team list (their own memberships are empty).
  const teamNamesReady = (() => {
    if (!me) return false;
    if (me.isAdmin) return adminTeamsLoaded;
    return true;
  })();

  const canWriteSelected = (() => {
    if (!me) return false;
    if (me.isAdmin) return true;
    if (selectedTeamId) {
      return teamsById[selectedTeamId]?.role === 'writer';
    }
    return me.teams.some(t => t.role === 'writer');
  })();

  return (
    <MeContext.Provider value={{
      me, loading, error, selectedTeamId, selectTeam, refresh,
      pending, canWriteSelected, teamsById, teamNamesById, teamNamesReady, allTeamsForAdmin,
    }}>
      {children}
    </MeContext.Provider>
  );
};

export const useMe = (): MeContextType => {
  const ctx = useContext(MeContext);
  if (!ctx) throw new Error('useMe must be used within MeProvider');
  return ctx;
};
