import React, { useCallback, useEffect, useState } from 'react';
import { layerApiService, LayerMetadata } from '../../services/layerApi';
import {
  LAMBDA_RUNTIME_VALUES,
  LAMBDA_ARCHITECTURES,
  MAX_LAYER_ZIP_BYTES,
} from '../../constants/lambdaRuntimes';
import { useMe } from '../../contexts/MeContext';
import './LayerManagement.css';

const LayerManagement: React.FC = () => {
  const { me, selectedTeamId, canWriteSelected, teamNamesById, teamsById, allTeamsForAdmin } = useMe();

  // Teams the caller can create layers in — admins: all teams; others: their
  // writer teams. Mirrors the workflow create-eligibility logic.
  const eligibleCreateTeams = (() => {
    if (!me) return [] as { teamId: string; name: string }[];
    if (me.isAdmin) return allTeamsForAdmin;
    return me.teams.filter(t => t.role === 'writer').map(t => ({ teamId: t.teamId, name: t.name }));
  })();

  // Create is gated exactly like workflows: disabled when a read-only team is
  // selected, or when the user has no writer teams anywhere.
  const canCreate = eligibleCreateTeams.length > 0 && !(selectedTeamId && !canWriteSelected);
  const createDisabledReason =
    selectedTeamId && !canWriteSelected
      ? `You have read-only access to ${teamNamesById[selectedTeamId] || selectedTeamId}. Switch to a team where you have writer access to create layers.`
      : eligibleCreateTeams.length === 0
        ? 'You need writer access on at least one team to create layers.'
        : undefined;

  const [layers, setLayers] = useState<LayerMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formTeamId, setFormTeamId] = useState('');
  const [formRuntimes, setFormRuntimes] = useState<string[]>([]);
  const [formArchitectures, setFormArchitectures] = useState<string[]>([
    'x86_64',
  ]);
  const [formFile, setFormFile] = useState<File | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [pendingDelete, setPendingDelete] = useState<{
    layerId: string;
    layerName: string;
    force: boolean;
    conflictingWorkflows?: Array<{ id: string; name: string }>;
  } | null>(null);

  const loadLayers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await layerApiService.listLayers(selectedTeamId || undefined);
      setLayers(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load layers');
    } finally {
      setLoading(false);
    }
  }, [selectedTeamId]);

  useEffect(() => {
    loadLayers();
  }, [loadLayers]);

  // Resolve the default target team for a new layer, then open the form.
  const openCreateForm = () => {
    const defaultTeam =
      selectedTeamId && canWriteSelected
        ? selectedTeamId
        : eligibleCreateTeams.length === 1
          ? eligibleCreateTeams[0].teamId
          : '';
    setFormTeamId(defaultTeam);
    setShowCreateForm(true);
  };

  // The target team is locked only when you're viewing a specific writable
  // team (that's the create context). When no team is selected ("All teams"),
  // always show the selector so the user explicitly picks a team.
  const teamIsLocked = Boolean(selectedTeamId && canWriteSelected);

  // Whether the caller can delete a given layer (writer on its team, or admin).
  const canWriteLayer = (layer: LayerMetadata): boolean => {
    if (!me) return false;
    if (me.isAdmin) return true;
    if (!layer.teamId) return false;
    return teamsById[layer.teamId]?.role === 'writer';
  };

  // Show a team column when not scoped to a single selected team.
  const showTeamColumn = !selectedTeamId;

  const resetForm = () => {
    setFormName('');
    setFormDescription('');
    setFormRuntimes([]);
    setFormArchitectures(['x86_64']);
    setFormFile(null);
    setFormError(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    if (file && !file.name.endsWith('.zip')) {
      setFormError('Only .zip files are supported');
      setFormFile(null);
      return;
    }
    if (file && file.size > MAX_LAYER_ZIP_BYTES) {
      setFormError(
        `File is ${(file.size / 1024 / 1024).toFixed(
          1
        )} MiB; AWS limit is 50 MiB zipped`
      );
      setFormFile(null);
      return;
    }
    setFormError(null);
    setFormFile(file);
  };

  const toggleRuntime = (runtime: string) => {
    setFormRuntimes((prev) =>
      prev.includes(runtime)
        ? prev.filter((r) => r !== runtime)
        : [...prev, runtime]
    );
  };

  const toggleArchitecture = (arch: string) => {
    setFormArchitectures((prev) =>
      prev.includes(arch) ? prev.filter((a) => a !== arch) : [...prev, arch]
    );
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!formName.trim()) {
      setFormError('Layer name is required');
      return;
    }
    if (formRuntimes.length === 0) {
      setFormError('Select at least one runtime');
      return;
    }
    if (formArchitectures.length === 0) {
      setFormError('Select at least one architecture');
      return;
    }
    if (!formFile) {
      setFormError('Upload a zip file');
      return;
    }
    if (!formTeamId) {
      setFormError('Select a team for this layer');
      return;
    }

    try {
      setCreating(true);
      const trimmedName = formName.trim();

      const {
        uploadUrl,
        s3Key,
        layerId,
        contentType: signedContentType,
      } = await layerApiService.getUploadUrl(trimmedName, formTeamId);
      await layerApiService.uploadFile(uploadUrl, formFile, signedContentType);

      await layerApiService.createLayer({
        layerId,
        name: trimmedName,
        description: formDescription.trim(),
        compatibleRuntimes: formRuntimes,
        compatibleArchitectures: formArchitectures,
        s3Key,
        teamId: formTeamId,
      });

      setShowCreateForm(false);
      resetForm();
      await loadLayers();
    } catch (err: any) {
      // Prefer the backend's message (e.g. duplicate-name conflict).
      const backendMsg = err?.response?.data?.error;
      setFormError(
        backendMsg || (err instanceof Error ? err.message : 'Failed to create layer')
      );
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = (layerId: string, layerName: string) => {
    setPendingDelete({ layerId, layerName, force: false });
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const { layerId, layerName, force } = pendingDelete;
    setPendingDelete(null);
    try {
      await layerApiService.deleteLayer(layerId, force);
      setLayers((prev) => prev.filter((l) => l.id !== layerId));
    } catch (err: any) {
      const data = err?.response?.data;
      const deployed = data?.deployedWorkflows as
        | Array<{ id: string; name: string }>
        | undefined;
      if (err?.response?.status === 409 && deployed?.length) {
        setPendingDelete({ layerId, layerName, force: true, conflictingWorkflows: deployed });
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to delete layer');
    }
  };

  if (loading) {
    return (
      <div className="lyr-root">
        <div className="lyr-state">
          <span className="lyr-state-spinner" aria-hidden="true" />
          <p className="lyr-state-sub">Loading layers…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="lyr-root">
      {pendingDelete && (
        <div role="dialog" aria-modal="true" aria-label="Confirm deletion" className="lyr-confirm-overlay">
          <div className="lyr-confirm">
            {pendingDelete.conflictingWorkflows ? (
              <>
                <p className="lyr-confirm-title">Force delete layer "{pendingDelete.layerName}"?</p>
                <p className="lyr-confirm-body">
                  Attached to {pendingDelete.conflictingWorkflows.length} deployed workflow(s):{' '}
                  {pendingDelete.conflictingWorkflows.map((w) => w.name).join(', ')}.
                  This will detach it and may break the next stack update.
                </p>
              </>
            ) : (
              <p className="lyr-confirm-title">Delete layer "{pendingDelete.layerName}"? This cannot be undone.</p>
            )}
            <div className="lyr-confirm-actions">
              <button type="button" className="lyr-btn lyr-btn--danger" onClick={confirmDelete}>Delete</button>
              <button type="button" className="lyr-btn" onClick={() => setPendingDelete(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      <header className="lyr-header">
        <div>
          <h2 className="lyr-title">Lambda Layers</h2>
          <p className="lyr-subtitle">
            Upload library archives to create reusable layers for your Lambda
            functions.
          </p>
        </div>
        <span
          title={!canCreate ? createDisabledReason : undefined}
          style={{ display: 'inline-flex' }}
        >
          <button
            type="button"
            className="lyr-btn lyr-btn--primary"
            onClick={openCreateForm}
            disabled={showCreateForm || !canCreate}
          >
            <PlusIcon />
            Create layer
          </button>
        </span>
      </header>

      {error && (
        <div className="lyr-error-banner" role="alert">
          <AlertIcon />
          <span>{error}</span>
        </div>
      )}

      {showCreateForm && canCreate && (
        <div className="lyr-form-card">
          <h3 className="lyr-form-title">Create new layer</h3>

          <form onSubmit={handleCreate} className="lyr-form-grid">
            <div className="lyr-field">
              <label htmlFor="lyr-team" className="lyr-label">
                Team *
              </label>
              {teamIsLocked ? (
                <input
                  id="lyr-team"
                  type="text"
                  value={teamNamesById[formTeamId] || formTeamId}
                  className="lyr-input"
                  disabled
                  readOnly
                />
              ) : (
                <select
                  id="lyr-team"
                  value={formTeamId}
                  onChange={(e) => setFormTeamId(e.target.value)}
                  className="lyr-input"
                  disabled={creating}
                >
                  <option value="" disabled>
                    Select a team…
                  </option>
                  {eligibleCreateTeams.map((t) => (
                    <option key={t.teamId} value={t.teamId}>
                      {t.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="lyr-row">
              <div className="lyr-field">
                <label htmlFor="lyr-name" className="lyr-label">
                  Layer name *
                </label>
                <input
                  id="lyr-name"
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. pandas-numpy-layer"
                  maxLength={64}
                  className="lyr-input"
                  disabled={creating}
                />
              </div>
              <div className="lyr-field">
                <label htmlFor="lyr-desc" className="lyr-label">
                  Description
                </label>
                <input
                  id="lyr-desc"
                  type="text"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Optional description"
                  maxLength={256}
                  className="lyr-input"
                  disabled={creating}
                />
              </div>
            </div>

            <div className="lyr-field">
              <label className="lyr-label">Compatible runtimes *</label>
              <div className="lyr-checkbox-grid">
                {LAMBDA_RUNTIME_VALUES.map((rt) => {
                  const checked = formRuntimes.includes(rt);
                  return (
                    <label
                      key={rt}
                      className={`lyr-checkbox${
                        checked ? ' lyr-checkbox--checked' : ''
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleRuntime(rt)}
                        disabled={creating}
                      />
                      {rt}
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="lyr-field">
              <label className="lyr-label">
                Compatible architectures *
              </label>
              <div className="lyr-checkbox-grid">
                {LAMBDA_ARCHITECTURES.map((arch) => {
                  const checked = formArchitectures.includes(arch);
                  return (
                    <label
                      key={arch}
                      className={`lyr-checkbox${
                        checked ? ' lyr-checkbox--checked' : ''
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleArchitecture(arch)}
                        disabled={creating}
                      />
                      {arch}
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="lyr-field">
              <label className="lyr-label">Layer archive (.zip) *</label>
              <div className="lyr-file-wrap">
                <label className="lyr-file-label">
                  <UploadIcon />
                  {formFile ? 'Replace file' : 'Choose .zip file'}
                  <input
                    type="file"
                    accept=".zip"
                    onChange={handleFileChange}
                    className="lyr-file-input"
                    disabled={creating}
                  />
                </label>
                {formFile && (
                  <span className="lyr-file-info">
                    {formFile.name} (
                    {(formFile.size / 1024 / 1024).toFixed(2)} MB)
                  </span>
                )}
              </div>
            </div>

            {formError && (
              <div className="lyr-form-error" role="alert">
                {formError}
              </div>
            )}

            <div className="lyr-form-actions">
              <button
                type="button"
                className="lyr-btn"
                onClick={() => {
                  setShowCreateForm(false);
                  resetForm();
                }}
                disabled={creating}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="lyr-btn lyr-btn--primary"
                disabled={creating}
              >
                {creating ? (
                  <>
                    <span
                      className="lyr-spinner-sm"
                      aria-hidden="true"
                    />
                    Creating…
                  </>
                ) : (
                  'Create layer'
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {layers.length === 0 && !showCreateForm ? (
        <div className="lyr-state">
          <span className="lyr-state-icon" aria-hidden="true">
            <LayersIcon />
          </span>
          <h3 className="lyr-state-title">No layers yet</h3>
          <p className="lyr-state-sub">
            Create your first Lambda layer to share libraries across your
            workflow functions.
          </p>
          <div className="lyr-state-actions">
            <span
              title={!canCreate ? createDisabledReason : undefined}
              style={{ display: 'inline-flex' }}
            >
              <button
                type="button"
                className="lyr-btn lyr-btn--primary"
                onClick={openCreateForm}
                disabled={!canCreate}
              >
                <PlusIcon />
                Create layer
              </button>
            </span>
          </div>
        </div>
      ) : (
        layers.length > 0 && (
          <div className="lyr-card">
            <table className="lyr-table">
              <thead>
                <tr>
                  <th style={{ width: '30%' }}>Name</th>
                  {showTeamColumn && <th>Team</th>}
                  <th>Runtimes</th>
                  <th>Architectures</th>
                  <th>Version</th>
                  <th>Created</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {layers.map((layer) => (
                  <tr key={layer.id}>
                    <td>
                      <div className="lyr-name">{layer.name}</div>
                      {layer.description && (
                        <div className="lyr-desc">{layer.description}</div>
                      )}
                    </td>
                    {showTeamColumn && (
                      <td className="lyr-cell-mono">
                        {layer.teamId ? (teamNamesById[layer.teamId] || layer.teamId) : '—'}
                      </td>
                    )}
                    <td>
                      <div className="lyr-tags">
                        {layer.compatibleRuntimes.map((rt) => (
                          <span key={rt} className="lyr-tag">
                            {rt}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="lyr-cell-mono">
                      {layer.compatibleArchitectures.join(', ')}
                    </td>
                    <td className="lyr-cell-mono">{layer.version}</td>
                    <td className="lyr-cell-mono">
                      {new Date(layer.createdAt).toLocaleDateString()}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {canWriteLayer(layer) && (
                        <button
                          type="button"
                          className="lyr-btn lyr-btn--icon lyr-btn--danger"
                          onClick={() => handleDelete(layer.id, layer.name)}
                          title={`Delete ${layer.name}`}
                          aria-label={`Delete ${layer.name}`}
                        >
                          <TrashIcon />
                        </button>
                      )}
                    </td>
                  </tr>                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
};

export default LayerManagement;

/* ---------- Inline SVG icons ---------- */

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="m19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
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

function LayersIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
}
