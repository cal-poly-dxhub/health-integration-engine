import React, { useState, useEffect } from 'react';
import { S3NodeConfig } from '../../../types/nodes';
import '../NodeConfigModal.css';

interface S3ConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: S3NodeConfig) => void;
  initialConfig?: S3NodeConfig;
  nodeName: string;
}

const S3ConfigModal: React.FC<S3ConfigModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialConfig,
  nodeName,
}) => {
  const [config, setConfig] = useState<S3NodeConfig>({
    type: 's3' as const,
    bucketName: '',
    objectKey: '',
    operation: 'read',
    region: 'us-west-2',
    triggerOnUpload: true,
    folderPrefix: '',
    ...initialConfig,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (initialConfig) {
      setConfig({ ...initialConfig, triggerOnUpload: initialConfig.triggerOnUpload ?? true });
    }
  }, [initialConfig]);

  const validateConfig = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!config.bucketName.trim()) {
      newErrors.bucketName = 'Bucket name is required';
    } else if (!/^[a-z0-9.-]+$/.test(config.bucketName)) {
      newErrors.bucketName = 'Invalid bucket name format';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = () => {
    if (validateConfig()) {
      onSave(config);
      onClose();
    }
  };

  const handleInputChange = (field: keyof S3NodeConfig, value: string | boolean) => {
    setConfig(prev => ({ ...prev, [field]: value }));
    if (errors[field as string]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content config-modal">
        <div className="modal-header">
          <h2>Configure S3 Node</h2>
          <h3>{nodeName}</h3>
          <button className="modal-close-btn" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <div className="config-section">
            <h4>S3 Configuration</h4>
            
            <div className="form-group">
              <label htmlFor="operation">Operation *</label>
              <select
                id="operation"
                value={config.operation}
                onChange={(e) => handleInputChange('operation', e.target.value)}
                className="form-control"
              >
                <option value="read">Read Object</option>
                <option value="write">Write Object</option>
                <option value="delete">Delete Object</option>
                <option value="list">List Objects</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="bucketName">Bucket Name *</label>
              <input
                type="text"
                id="bucketName"
                value={config.bucketName}
                onChange={(e) => handleInputChange('bucketName', e.target.value)}
                className={`form-control ${errors.bucketName ? 'error' : ''}`}
                placeholder="my-s3-bucket"
              />
              {errors.bucketName && <span className="error-text">{errors.bucketName}</span>}
              <small className="help-text">
                Bucket names must be lowercase, contain only letters, numbers, dots, and hyphens
              </small>
            </div>

            <div className="form-group">
              <label htmlFor="folderPrefix">Folder Path (Optional)</label>
              <input
                type="text"
                id="folderPrefix"
                value={config.folderPrefix || ''}
                onChange={(e) => handleInputChange('folderPrefix', e.target.value)}
                className="form-control"
                placeholder="uploads/documents/"
              />
              <small className="help-text">
                Optional folder prefix to watch. Leave empty to watch entire bucket. Include trailing slash.
              </small>
            </div>

            <div className="form-group">
              <label htmlFor="region">AWS Region</label>
              <select
                id="region"
                value={config.region}
                onChange={(e) => handleInputChange('region', e.target.value)}
                className="form-control"
              >
                <option value="us-east-1">US East (N. Virginia)</option>
                <option value="us-east-2">US East (Ohio)</option>
                <option value="us-west-1">US West (N. California)</option>
                <option value="us-west-2">US West (Oregon)</option>
                <option value="eu-west-1">Europe (Ireland)</option>
                <option value="eu-central-1">Europe (Frankfurt)</option>
                <option value="ap-southeast-1">Asia Pacific (Singapore)</option>
                <option value="ap-northeast-1">Asia Pacific (Tokyo)</option>
              </select>
            </div>
          </div>

          <div className="config-section trigger-info">
            <h4>🔄 Auto-Trigger Enabled</h4>
            <p>
              This workflow will automatically execute whenever a new file is uploaded to the specified bucket
              {config.folderPrefix ? ` in the "${config.folderPrefix}" folder` : ''}.
            </p>
            <p className="info-note">
              <strong>Note:</strong> EventBridge notifications will be enabled on the S3 bucket during deployment.
            </p>
          </div>

          <div className="config-preview">
            <h4>Configuration Preview</h4>
            <div className="preview-content">
              <p><strong>Operation:</strong> {config.operation}</p>
              <p><strong>Bucket:</strong> {config.bucketName || 'Not specified'}</p>
              <p><strong>Folder:</strong> {config.folderPrefix || '(entire bucket)'}</p>
              <p><strong>Region:</strong> {config.region}</p>
              <p><strong>Trigger:</strong> Auto-execute on file upload</p>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSave}>
            Save Configuration
          </button>
        </div>
      </div>
    </div>
  );
};

export default S3ConfigModal;