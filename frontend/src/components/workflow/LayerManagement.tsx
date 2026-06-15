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
  const { me } = useMe();
  // Layer creation is a write operation; readers can only view the layer list.
  const canManageLayers = !me || me.isAdmin || me.teams.some(t => t.role === 'writer');
  const [layers, setLayers] = useState<LayerMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
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
      const result = await layerApiService.listLayers();
      setLayers(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load layers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLayers();
  }, [loadLayers]);

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

    try {
      setCreating(true);
      const trimmedName = formName.trim();

      const {
        uploadUrl,
        s3Key,
        layerId,
        contentType: signedContentType,
      } = await layerApiService.getUploadUrl(trimmedName);
      await layerApiService.uploadFile(uploadUrl, formFile, signedContentType);

      await layerApiService.createLayer({
        layerId,
        name: trimmedName,
        description: formDescription.trim(),
        compatibleRuntimes: formRuntimes,
        compatibleArchitectures: formArchitectures,
        s3Key,
      });

      setShowCreateForm(false);
      resetForm();
      await loadLayers();
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Failed to create layer'
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
        <button
          type="button"
          className="lyr-btn lyr-btn--primary"
          onClick={() => setShowCreateForm(true)}
          disabled={showCreateForm || !canManageLayers}
          title={!canManageLayers ? 'You need writer access on at least one team to create layers.' : undefined}
        >
          <PlusIcon />
          Create layer
        </button>
      </header>

      {error && (
        <div className="lyr-error-banner" role="alert">
          <AlertIcon />
          <span>{error}</span>
        </div>
      )}

      {showCreateForm && canManageLayers && (
        <div className="lyr-form-card">
          <h3 className="lyr-form-title">Create new layer</h3>

          <form onSubmit={handleCreate} className="lyr-form-grid">
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
            {canManageLayers && (
              <button
                type="button"
                className="lyr-btn lyr-btn--primary"
                onClick={() => setShowCreateForm(true)}
              >
                <PlusIcon />
                Create layer
              </button>
            )}
          </div>
        </div>
      ) : (
        layers.length > 0 && (
          <div className="lyr-card">
            <table className="lyr-table">
              <thead>
                <tr>
                  <th style={{ width: '30%' }}>Name</th>
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
                      {canManageLayers && (
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
                  </tr>
                ))}
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
