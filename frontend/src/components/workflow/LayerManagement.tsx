import React, { useState, useEffect, useCallback } from 'react';
import { layerApiService, LayerMetadata } from '../../services/layerApi';
import './LayerManagement.css';

const RUNTIMES = [
  'nodejs18.x', 'nodejs20.x',
  'python3.9', 'python3.10', 'python3.11', 'python3.12', 'python3.13',
  'java11', 'java17',
  'dotnet6', 'dotnet8',
];

const ARCHITECTURES = ['x86_64', 'arm64'];

const LayerManagement: React.FC = () => {
  const [layers, setLayers] = useState<LayerMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formRuntimes, setFormRuntimes] = useState<string[]>([]);
  const [formArchitectures, setFormArchitectures] = useState<string[]>(['x86_64']);
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    if (file && !file.name.endsWith('.zip')) {
      setFormError('Only .zip files are supported');
      setFormFile(null);
      return;
    }
    setFormError(null);
    setFormFile(file);
  };

  const handleRuntimeToggle = (runtime: string) => {
    setFormRuntimes(prev =>
      prev.includes(runtime) ? prev.filter(r => r !== runtime) : [...prev, runtime]
    );
  };

  const handleArchitectureToggle = (arch: string) => {
    setFormArchitectures(prev =>
      prev.includes(arch) ? prev.filter(a => a !== arch) : [...prev, arch]
    );
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!formName.trim()) { setFormError('Layer name is required'); return; }
    if (formRuntimes.length === 0) { setFormError('Select at least one runtime'); return; }
    if (formArchitectures.length === 0) { setFormError('Select at least one architecture'); return; }
    if (!formFile) { setFormError('Upload a zip file'); return; }

    try {
      setCreating(true);
      const trimmedName = formName.trim();
      const contentType = formFile.type || 'application/zip';

      const { uploadUrl, s3Key, layerId } = await layerApiService.getUploadUrl(trimmedName, contentType);
      await layerApiService.uploadFile(uploadUrl, formFile, contentType);

      await layerApiService.createLayer({
        layerId,
        name: trimmedName,
        description: formDescription.trim(),
        compatibleRuntimes: formRuntimes,
        compatibleArchitectures: formArchitectures,
        s3Key,
      });

      // Reset form and reload
      setShowCreateForm(false);
      setFormName('');
      setFormDescription('');
      setFormRuntimes([]);
      setFormArchitectures(['x86_64']);
      setFormFile(null);
      await loadLayers();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create layer');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (layerId: string, layerName: string) => {
    if (!window.confirm(`Delete layer "${layerName}"? This cannot be undone.`)) return;
    try {
      await layerApiService.deleteLayer(layerId);
      setLayers(prev => prev.filter(l => l.id !== layerId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete layer');
    }
  };

  if (loading) {
    return (
      <div className="layer-management">
        <div className="layer-loading"><div className="loading-spinner"></div><p>Loading layers...</p></div>
      </div>
    );
  }

  return (
    <div className="layer-management">
      <div className="layer-header">
        <div>
          <h2>Lambda Layers</h2>
          <p>Upload library archives to create reusable layers for your Lambda functions</p>
        </div>
        <button className="create-layer-btn" onClick={() => setShowCreateForm(true)} disabled={showCreateForm}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Create Layer
        </button>
      </div>

      {error && <div className="layer-error">{error}</div>}

      {showCreateForm && (
        <div className="layer-create-form">
          <h3>Create New Layer</h3>
          <form onSubmit={handleCreate}>
            <div className="form-group">
              <label htmlFor="layer-name">Layer Name *</label>
              <input
                id="layer-name"
                type="text"
                value={formName}
                onChange={e => setFormName(e.target.value)}
                placeholder="e.g. pandas-numpy-layer"
                maxLength={64}
              />
            </div>

            <div className="form-group">
              <label htmlFor="layer-description">Description</label>
              <input
                id="layer-description"
                type="text"
                value={formDescription}
                onChange={e => setFormDescription(e.target.value)}
                placeholder="Optional description"
                maxLength={256}
              />
            </div>

            <div className="layer-field">
              <label>Compatible Runtimes *</label>
              <div className="checkbox-grid">
                {RUNTIMES.map(rt => (
                  <label key={rt} className="layer-checkbox-label">
                    <input
                      type="checkbox"
                      checked={formRuntimes.includes(rt)}
                      onChange={() => handleRuntimeToggle(rt)}
                    />
                    {rt}
                  </label>
                ))}
              </div>
            </div>

            <div className="layer-field">
              <label>Compatible Architectures *</label>
              <div className="checkbox-grid">
                {ARCHITECTURES.map(arch => (
                  <label key={arch} className="layer-checkbox-label">
                    <input
                      type="checkbox"
                      checked={formArchitectures.includes(arch)}
                      onChange={() => handleArchitectureToggle(arch)}
                    />
                    {arch}
                  </label>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="layer-file">Layer Archive (.zip) *</label>
              <input id="layer-file" type="file" accept=".zip" onChange={handleFileChange} />
              {formFile && <small className="file-info">{formFile.name} ({(formFile.size / 1024 / 1024).toFixed(2)} MB)</small>}
            </div>

            {formError && <div className="form-error">{formError}</div>}

            <div className="form-actions">
              <button type="button" className="btn-secondary" onClick={() => setShowCreateForm(false)} disabled={creating}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={creating}>
                {creating ? 'Creating...' : 'Create Layer'}
              </button>
            </div>
          </form>
        </div>
      )}

      {layers.length === 0 && !showCreateForm ? (
        <div className="layer-empty">
          <h3>No layers yet</h3>
          <p>Create your first Lambda Layer to share libraries across your workflow functions.</p>
        </div>
      ) : (
        <div className="layer-table-container">
          <table className="layer-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Runtimes</th>
                <th>Architectures</th>
                <th>Version</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {layers.map(layer => (
                <tr key={layer.id}>
                  <td>
                    <div className="layer-name">{layer.name}</div>
                    {layer.description && <div className="layer-desc">{layer.description}</div>}
                  </td>
                  <td>
                    <div className="runtime-tags">
                      {layer.compatibleRuntimes.map(rt => (
                        <span key={rt} className="runtime-tag">{rt}</span>
                      ))}
                    </div>
                  </td>
                  <td>{layer.compatibleArchitectures.join(', ')}</td>
                  <td>{layer.version}</td>
                  <td>{new Date(layer.createdAt).toLocaleDateString()}</td>
                  <td>
                    <button className="delete-layer-btn" onClick={() => handleDelete(layer.id, layer.name)} title="Delete layer">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3,6 5,6 21,6" />
                        <path d="m19,6v14a2,2 0 0,1 -2,2H7a2,2 0 0,1 -2,-2V6m3,0V4a2,2 0 0,1 2,-2h4a2,2 0 0,1 2,2v2" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default LayerManagement;
