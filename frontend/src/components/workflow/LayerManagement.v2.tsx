import React, { useCallback, useEffect, useState } from 'react';
import { layerApiService, LayerMetadata } from '../../services/layerApi';
import {
  LAMBDA_RUNTIME_VALUES,
  LAMBDA_ARCHITECTURES,
  MAX_LAYER_ZIP_BYTES,
} from '../../constants/lambdaRuntimes';
import './LayerManagement.v2.css';

const LayerManagement: React.FC = () => {
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

  const handleDelete = async (layerId: string, layerName: string) => {
    if (!window.confirm(`Delete layer "${layerName}"? This cannot be undone.`))
      return;
    try {
      await layerApiService.deleteLayer(layerId);
      setLayers((prev) => prev.filter((l) => l.id !== layerId));
    } catch (err: any) {
      const data = err?.response?.data;
      const deployed = data?.deployedWorkflows as
        | Array<{ id: string; name: string }>
        | undefined;
      if (err?.response?.status === 409 && deployed?.length) {
        const names = deployed.map((w) => `• ${w.name}`).join('\n');
        const ok = window.confirm(
          `Layer "${layerName}" is attached to ${deployed.length} deployed workflow(s):\n\n${names}\n\n` +
            `Force delete will detach it from those deployed Lambda functions and may leave the next stack update referencing a missing ARN. Continue?`
        );
        if (!ok) return;
        try {
          await layerApiService.deleteLayer(layerId, true);
          setLayers((prev) => prev.filter((l) => l.id !== layerId));
          return;
        } catch (forceErr) {
          setError(
            forceErr instanceof Error
              ? forceErr.message
              : 'Failed to force-delete layer'
          );
          return;
        }
      }
      setError(err instanceof Error ? err.message : 'Failed to delete layer');
    }
  };

  if (loading) {
    return (
      <div className="lyr-v2-root">
        <div className="lyr-v2-state">
          <span className="lyr-v2-state-spinner" aria-hidden="true" />
          <p className="lyr-v2-state-sub">Loading layers…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="lyr-v2-root">
      <header className="lyr-v2-header">
        <div>
          <h2 className="lyr-v2-title">Lambda Layers</h2>
          <p className="lyr-v2-subtitle">
            Upload library archives to create reusable layers for your Lambda
            functions.
          </p>
        </div>
        <button
          type="button"
          className="lyr-v2-btn lyr-v2-btn--primary"
          onClick={() => setShowCreateForm(true)}
          disabled={showCreateForm}
        >
          <PlusIcon />
          Create layer
        </button>
      </header>

      {error && (
        <div className="lyr-v2-error-banner" role="alert">
          <AlertIcon />
          <span>{error}</span>
        </div>
      )}

      {showCreateForm && (
        <div className="lyr-v2-form-card">
          <h3 className="lyr-v2-form-title">Create new layer</h3>

          <form onSubmit={handleCreate} className="lyr-v2-form-grid">
            <div className="lyr-v2-row">
              <div className="lyr-v2-field">
                <label htmlFor="lyr-v2-name" className="lyr-v2-label">
                  Layer name *
                </label>
                <input
                  id="lyr-v2-name"
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. pandas-numpy-layer"
                  maxLength={64}
                  className="lyr-v2-input"
                  disabled={creating}
                />
              </div>
              <div className="lyr-v2-field">
                <label htmlFor="lyr-v2-desc" className="lyr-v2-label">
                  Description
                </label>
                <input
                  id="lyr-v2-desc"
                  type="text"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Optional description"
                  maxLength={256}
                  className="lyr-v2-input"
                  disabled={creating}
                />
              </div>
            </div>

            <div className="lyr-v2-field">
              <label className="lyr-v2-label">Compatible runtimes *</label>
              <div className="lyr-v2-checkbox-grid">
                {LAMBDA_RUNTIME_VALUES.map((rt) => {
                  const checked = formRuntimes.includes(rt);
                  return (
                    <label
                      key={rt}
                      className={`lyr-v2-checkbox${
                        checked ? ' lyr-v2-checkbox--checked' : ''
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

            <div className="lyr-v2-field">
              <label className="lyr-v2-label">
                Compatible architectures *
              </label>
              <div className="lyr-v2-checkbox-grid">
                {LAMBDA_ARCHITECTURES.map((arch) => {
                  const checked = formArchitectures.includes(arch);
                  return (
                    <label
                      key={arch}
                      className={`lyr-v2-checkbox${
                        checked ? ' lyr-v2-checkbox--checked' : ''
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

            <div className="lyr-v2-field">
              <label className="lyr-v2-label">Layer archive (.zip) *</label>
              <div className="lyr-v2-file-wrap">
                <label className="lyr-v2-file-label">
                  <UploadIcon />
                  {formFile ? 'Replace file' : 'Choose .zip file'}
                  <input
                    type="file"
                    accept=".zip"
                    onChange={handleFileChange}
                    className="lyr-v2-file-input"
                    disabled={creating}
                  />
                </label>
                {formFile && (
                  <span className="lyr-v2-file-info">
                    {formFile.name} (
                    {(formFile.size / 1024 / 1024).toFixed(2)} MB)
                  </span>
                )}
              </div>
            </div>

            {formError && (
              <div className="lyr-v2-form-error" role="alert">
                {formError}
              </div>
            )}

            <div className="lyr-v2-form-actions">
              <button
                type="button"
                className="lyr-v2-btn"
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
                className="lyr-v2-btn lyr-v2-btn--primary"
                disabled={creating}
              >
                {creating ? (
                  <>
                    <span
                      className="lyr-v2-spinner-sm"
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
        <div className="lyr-v2-state">
          <span className="lyr-v2-state-icon" aria-hidden="true">
            <LayersIcon />
          </span>
          <h3 className="lyr-v2-state-title">No layers yet</h3>
          <p className="lyr-v2-state-sub">
            Create your first Lambda layer to share libraries across your
            workflow functions.
          </p>
          <div className="lyr-v2-state-actions">
            <button
              type="button"
              className="lyr-v2-btn lyr-v2-btn--primary"
              onClick={() => setShowCreateForm(true)}
            >
              <PlusIcon />
              Create layer
            </button>
          </div>
        </div>
      ) : (
        layers.length > 0 && (
          <div className="lyr-v2-card">
            <table className="lyr-v2-table">
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
                      <div className="lyr-v2-name">{layer.name}</div>
                      {layer.description && (
                        <div className="lyr-v2-desc">{layer.description}</div>
                      )}
                    </td>
                    <td>
                      <div className="lyr-v2-tags">
                        {layer.compatibleRuntimes.map((rt) => (
                          <span key={rt} className="lyr-v2-tag">
                            {rt}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="lyr-v2-cell-mono">
                      {layer.compatibleArchitectures.join(', ')}
                    </td>
                    <td className="lyr-v2-cell-mono">{layer.version}</td>
                    <td className="lyr-v2-cell-mono">
                      {new Date(layer.createdAt).toLocaleDateString()}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        className="lyr-v2-btn lyr-v2-btn--icon lyr-v2-btn--danger"
                        onClick={() => handleDelete(layer.id, layer.name)}
                        title={`Delete ${layer.name}`}
                        aria-label={`Delete ${layer.name}`}
                      >
                        <TrashIcon />
                      </button>
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
