import React, { useEffect, useState } from 'react';
import { WorkflowNode } from '../../types/workflow';
import apiService from '../../services/api';
import { layerApiService, LayerMetadata } from '../../services/layerApi';
import {
  LAMBDA_RUNTIMES,
  LAMBDA_ARCHITECTURES,
  DEFAULT_LAMBDA_RUNTIME,
  DEFAULT_LAMBDA_ARCHITECTURE,
  MAX_LAMBDA_LAYERS,
} from '../../constants/lambdaRuntimes';
import './NodeConfigModal.v2.css';

interface NodeConfigModalProps {
  node: WorkflowNode;
  isOpen: boolean;
  onClose: () => void;
  onSave: (nodeId: string, config: any) => void;
}

interface IAMRole {
  arn: string;
  name: string;
  description: string;
}

const NodeConfigModal: React.FC<NodeConfigModalProps> = ({
  node,
  isOpen,
  onClose,
  onSave,
}) => {
  const [config, setConfig] = useState<any>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isCodeExpanded, setIsCodeExpanded] = useState(false);
  const [codeEditorHeight, setCodeEditorHeight] = useState(220);
  const [isFullScreenEditor, setIsFullScreenEditor] = useState(false);
  const [iamRoles, setIamRoles] = useState<IAMRole[]>([]);
  const [loadingRoles, setLoadingRoles] = useState(false);
  const [availableLayers, setAvailableLayers] = useState<LayerMetadata[]>([]);
  const [loadingLayers, setLoadingLayers] = useState(false);

  // Fetch IAM roles + layers when modal opens for lambda nodes
  useEffect(() => {
    if (isOpen && node.type === 'lambda') {
      fetchIAMRoles(node.type);
      fetchLayers();
    }
  }, [isOpen, node.type]);

  const fetchIAMRoles = async (serviceType: string) => {
    setLoadingRoles(true);
    try {
      const response = await apiService.get(
        `/iam/roles?serviceType=${serviceType}`
      );
      const roles = response.data?.roles || response.roles || [];
      setIamRoles(roles);
    } catch (err) {
      console.error('Failed to fetch IAM roles:', err);
      setIamRoles([]);
    } finally {
      setLoadingRoles(false);
    }
  };

  const fetchLayers = async () => {
    setLoadingLayers(true);
    try {
      const layers = await layerApiService.listLayers();
      setAvailableLayers(layers);
    } catch (err) {
      console.error('Failed to fetch layers:', err);
      setAvailableLayers([]);
    } finally {
      setLoadingLayers(false);
    }
  };

  // Initialize per-node config when opening
  useEffect(() => {
    if (!isOpen || !node) return;

    switch (node.type) {
      case 's3':
        setConfig({
          bucketName: (node.config as any)?.bucketName || '',
          operation: (node.config as any)?.operation || 'read',
          folderPrefix: (node.config as any)?.folderPrefix || '',
          triggerOnUpload:
            (node.config as any)?.triggerOnUpload ?? true,
        });
        break;
      case 'database':
        setConfig({
          connectionType: (node.config as any)?.connectionType || 'mysql',
          host: (node.config as any)?.host || '',
          port: (node.config as any)?.port || '3306',
          database: (node.config as any)?.database || '',
          query: (node.config as any)?.query || '',
          username: (node.config as any)?.username || '',
          password: (node.config as any)?.password || '',
        });
        break;
      case 'lambda':
        setConfig({
          functionName: (node.config as any)?.functionName || '',
          runtime: (node.config as any)?.runtime || DEFAULT_LAMBDA_RUNTIME,
          architecture:
            (node.config as any)?.architecture || DEFAULT_LAMBDA_ARCHITECTURE,
          code:
            (node.config as any)?.code ||
            '// Your Lambda function code here\nexports.handler = async (event) => {\n    // TODO: implement\n    return {\n        statusCode: 200,\n        body: JSON.stringify("Hello from Lambda!")\n    };\n};',
          timeout: (node.config as any)?.timeout || 30,
          memory: (node.config as any)?.memory || 128,
          iamRole:
            (node.config as any)?.iamRole?.useExisting &&
            (node.config as any)?.iamRole?.existingRoleArn
              ? (node.config as any).iamRole
              : { useExisting: false, existingRoleArn: '' },
          layers: (node.config as any)?.layers || [],
        });
        break;
      default:
        setConfig({});
    }
    setErrors({});
  }, [isOpen, node]);

  const validateConfig = () => {
    const newErrors: Record<string, string> = {};

    switch (node.type) {
      case 's3':
        if (!config.bucketName)
          newErrors.bucketName = 'Bucket name is required';
        break;
      case 'database':
        if (!config.host) newErrors.host = 'Host is required';
        if (!config.database) newErrors.database = 'Database name is required';
        if (!config.query) newErrors.query = 'SQL query is required';
        if (!config.username) newErrors.username = 'Username is required';
        break;
      case 'lambda':
        if (!config.functionName)
          newErrors.functionName = 'Function name is required';
        if (!config.code) newErrors.code = 'Function code is required';
        break;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = () => {
    if (validateConfig()) {
      onSave(node.id, config);
      onClose();
    }
  };

  const handleInputChange = (field: string, value: any) => {
    setConfig((prev: any) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: '' }));
    }
  };

  if (!isOpen) return null;

  /* ---------- IAM role selector (shared) ---------- */
  const renderIAMRoleSelector = (
    _serviceType: string,
    trustPolicyService: string
  ) => (
    <>
      <div className="ncm-v2-divider">
        <label className="ncm-v2-checkbox">
          <input
            type="checkbox"
            checked={config.iamRole?.useExisting || false}
            onChange={(e) => {
              handleInputChange('iamRole', {
                useExisting: e.target.checked,
                existingRoleArn: config.iamRole?.existingRoleArn || '',
              });
            }}
          />
          Use existing IAM role
        </label>
      </div>

      {config.iamRole?.useExisting && (
        <div className="ncm-v2-field">
          <label htmlFor="ncm-v2-iam" className="ncm-v2-label">
            IAM role
            {loadingRoles && (
              <span className="ncm-v2-help" style={{ marginLeft: 8 }}>
                (Loading…)
              </span>
            )}
          </label>
          <select
            id="ncm-v2-iam"
            value={config.iamRole?.existingRoleArn || ''}
            onChange={(e) =>
              handleInputChange('iamRole', {
                useExisting: true,
                existingRoleArn: e.target.value,
              })
            }
            className={`ncm-v2-select${
              errors.existingRoleArn ? ' error' : ''
            }`}
            disabled={loadingRoles}
          >
            <option value="">Select an IAM role…</option>
            {iamRoles.length === 0 &&
              !loadingRoles &&
              config.iamRole?.existingRoleArn && (
                <option value={config.iamRole.existingRoleArn}>
                  {config.iamRole.existingRoleArn}
                </option>
              )}
            {iamRoles.length === 0 &&
              !loadingRoles &&
              !config.iamRole?.existingRoleArn && (
                <option value="" disabled>
                  No roles found with {trustPolicyService} trust policy
                </option>
              )}
            {iamRoles.map((role) => (
              <option key={role.arn} value={role.arn}>
                {role.name}
                {role.description ? ` — ${role.description}` : ''}
              </option>
            ))}
          </select>
          {errors.existingRoleArn && (
            <span className="ncm-v2-error-text">
              {errors.existingRoleArn}
            </span>
          )}
          <span className="ncm-v2-help">
            Role must trust {trustPolicyService}. Found {iamRoles.length}{' '}
            role(s).
          </span>
        </div>
      )}
    </>
  );

  /* ---------- S3 form ---------- */
  const renderS3Config = () => (
    <div className="ncm-v2-form">
      <div className="ncm-v2-field">
        <label htmlFor="ncm-v2-bucket" className="ncm-v2-label">
          S3 bucket name <span className="ncm-v2-required">*</span>
        </label>
        <input
          id="ncm-v2-bucket"
          type="text"
          value={config.bucketName || ''}
          onChange={(e) => handleInputChange('bucketName', e.target.value)}
          placeholder="my-s3-bucket"
          className={`ncm-v2-input${errors.bucketName ? ' error' : ''}`}
        />
        {errors.bucketName && (
          <span className="ncm-v2-error-text">{errors.bucketName}</span>
        )}
        <span className="ncm-v2-help">
          Lowercase only. Letters, numbers, dots, and hyphens are allowed.
        </span>
      </div>

      <div className="ncm-v2-field">
        <label htmlFor="ncm-v2-op" className="ncm-v2-label">
          Operation
        </label>
        <select
          id="ncm-v2-op"
          value={config.operation || 'read'}
          onChange={(e) => handleInputChange('operation', e.target.value)}
          className="ncm-v2-select"
        >
          <option value="read">Read object</option>
          <option value="write">Write object</option>
          <option value="delete">Delete object</option>
          <option value="list">List objects</option>
        </select>
      </div>

      <div className="ncm-v2-field">
        <label htmlFor="ncm-v2-prefix" className="ncm-v2-label">
          Folder path (optional)
        </label>
        <input
          id="ncm-v2-prefix"
          type="text"
          value={config.folderPrefix || ''}
          onChange={(e) => handleInputChange('folderPrefix', e.target.value)}
          placeholder="uploads/documents/"
          className="ncm-v2-input"
        />
        <span className="ncm-v2-help">
          Optional folder prefix to watch. Include the trailing slash. Leave
          empty to watch the entire bucket.
        </span>
      </div>

      <div className="ncm-v2-callout">
        <h4 className="ncm-v2-callout-title">Auto-trigger enabled</h4>
        <p>
          This workflow will run whenever a new file is uploaded to the
          specified bucket
          {config.folderPrefix
            ? ` in the "${config.folderPrefix}" folder`
            : ''}
          .
        </p>
        <p className="ncm-v2-callout-note">
          EventBridge notifications will be enabled on the bucket during
          deployment.
        </p>
      </div>
    </div>
  );

  /* ---------- Database form ---------- */
  const renderDatabaseConfig = () => (
    <div className="ncm-v2-form">
      <div className="ncm-v2-field">
        <label htmlFor="ncm-v2-db-type" className="ncm-v2-label">
          Database type
        </label>
        <select
          id="ncm-v2-db-type"
          value={config.connectionType || 'mysql'}
          onChange={(e) =>
            handleInputChange('connectionType', e.target.value)
          }
          className="ncm-v2-select"
        >
          <option value="mysql">MySQL</option>
          <option value="postgresql">PostgreSQL</option>
          <option value="dynamodb">DynamoDB</option>
          <option value="mongodb">MongoDB</option>
        </select>
      </div>

      <div className="ncm-v2-row">
        <div className="ncm-v2-field">
          <label htmlFor="ncm-v2-host" className="ncm-v2-label">
            Host <span className="ncm-v2-required">*</span>
          </label>
          <input
            id="ncm-v2-host"
            type="text"
            value={config.host || ''}
            onChange={(e) => handleInputChange('host', e.target.value)}
            placeholder="localhost"
            className={`ncm-v2-input${errors.host ? ' error' : ''}`}
          />
          {errors.host && (
            <span className="ncm-v2-error-text">{errors.host}</span>
          )}
        </div>
        <div className="ncm-v2-field">
          <label htmlFor="ncm-v2-port" className="ncm-v2-label">
            Port
          </label>
          <input
            id="ncm-v2-port"
            type="number"
            value={config.port || ''}
            onChange={(e) => handleInputChange('port', e.target.value)}
            placeholder="3306"
            className="ncm-v2-input"
          />
        </div>
      </div>

      <div className="ncm-v2-field">
        <label htmlFor="ncm-v2-db-name" className="ncm-v2-label">
          Database name <span className="ncm-v2-required">*</span>
        </label>
        <input
          id="ncm-v2-db-name"
          type="text"
          value={config.database || ''}
          onChange={(e) => handleInputChange('database', e.target.value)}
          placeholder="my_database"
          className={`ncm-v2-input${errors.database ? ' error' : ''}`}
        />
        {errors.database && (
          <span className="ncm-v2-error-text">{errors.database}</span>
        )}
      </div>

      <div className="ncm-v2-row">
        <div className="ncm-v2-field">
          <label htmlFor="ncm-v2-user" className="ncm-v2-label">
            Username <span className="ncm-v2-required">*</span>
          </label>
          <input
            id="ncm-v2-user"
            type="text"
            value={config.username || ''}
            onChange={(e) => handleInputChange('username', e.target.value)}
            className={`ncm-v2-input${errors.username ? ' error' : ''}`}
          />
          {errors.username && (
            <span className="ncm-v2-error-text">{errors.username}</span>
          )}
        </div>
        <div className="ncm-v2-field">
          <label htmlFor="ncm-v2-pass" className="ncm-v2-label">
            Password
          </label>
          <input
            id="ncm-v2-pass"
            type="password"
            value={config.password || ''}
            onChange={(e) => handleInputChange('password', e.target.value)}
            className="ncm-v2-input"
          />
        </div>
      </div>

      <div className="ncm-v2-field">
        <label htmlFor="ncm-v2-query" className="ncm-v2-label">
          SQL query <span className="ncm-v2-required">*</span>
        </label>
        <textarea
          id="ncm-v2-query"
          value={config.query || ''}
          onChange={(e) => handleInputChange('query', e.target.value)}
          placeholder="SELECT * FROM users WHERE id = ?"
          rows={5}
          className={`ncm-v2-textarea${errors.query ? ' error' : ''}`}
        />
        {errors.query && (
          <span className="ncm-v2-error-text">{errors.query}</span>
        )}
      </div>
    </div>
  );

  /* ---------- Lambda form ---------- */
  const renderLambdaConfig = () => {
    const selectedRuntime = config.runtime || '';
    const selectedArchitecture =
      config.architecture || DEFAULT_LAMBDA_ARCHITECTURE;
    const compatibleLayers = availableLayers.filter(
      (layer) =>
        layer.compatibleRuntimes.includes(selectedRuntime) &&
        (layer.compatibleArchitectures || []).includes(selectedArchitecture)
    );
    const selectedLayers: string[] = config.layers || [];
    const atCap = selectedLayers.length >= MAX_LAMBDA_LAYERS;

    return (
      <div className="ncm-v2-form">
        <div className="ncm-v2-field">
          <label htmlFor="ncm-v2-fn" className="ncm-v2-label">
            Function name <span className="ncm-v2-required">*</span>
          </label>
          <input
            id="ncm-v2-fn"
            type="text"
            value={config.functionName || ''}
            onChange={(e) =>
              handleInputChange('functionName', e.target.value)
            }
            placeholder="my-lambda-function"
            className={`ncm-v2-input${errors.functionName ? ' error' : ''}`}
          />
          {errors.functionName && (
            <span className="ncm-v2-error-text">{errors.functionName}</span>
          )}
        </div>

        <div className="ncm-v2-row">
          <div className="ncm-v2-field">
            <label htmlFor="ncm-v2-runtime" className="ncm-v2-label">
              Runtime
            </label>
            <select
              id="ncm-v2-runtime"
              value={config.runtime || DEFAULT_LAMBDA_RUNTIME}
              onChange={(e) => handleInputChange('runtime', e.target.value)}
              className="ncm-v2-select"
            >
              {LAMBDA_RUNTIMES.map((rt) => (
                <option key={rt.value} value={rt.value}>
                  {rt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="ncm-v2-field">
            <label htmlFor="ncm-v2-arch" className="ncm-v2-label">
              Architecture
            </label>
            <select
              id="ncm-v2-arch"
              value={config.architecture || DEFAULT_LAMBDA_ARCHITECTURE}
              onChange={(e) =>
                handleInputChange('architecture', e.target.value)
              }
              className="ncm-v2-select"
            >
              {LAMBDA_ARCHITECTURES.map((arch) => (
                <option key={arch} value={arch}>
                  {arch}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="ncm-v2-row">
          <div className="ncm-v2-field">
            <label htmlFor="ncm-v2-timeout" className="ncm-v2-label">
              Timeout (seconds)
            </label>
            <input
              id="ncm-v2-timeout"
              type="number"
              min="1"
              max="900"
              value={config.timeout || 30}
              onChange={(e) =>
                handleInputChange('timeout', parseInt(e.target.value))
              }
              className="ncm-v2-input"
            />
          </div>
          <div className="ncm-v2-field">
            <label htmlFor="ncm-v2-mem" className="ncm-v2-label">
              Memory (MB)
            </label>
            <select
              id="ncm-v2-mem"
              value={config.memory || 128}
              onChange={(e) =>
                handleInputChange('memory', parseInt(e.target.value))
              }
              className="ncm-v2-select"
            >
              <option value={128}>128 MB</option>
              <option value={256}>256 MB</option>
              <option value={512}>512 MB</option>
              <option value={1024}>1024 MB</option>
              <option value={2048}>2048 MB</option>
              <option value={3008}>3008 MB</option>
            </select>
          </div>
        </div>

        {/* Code editor */}
        <div className="ncm-v2-field">
          <div className="ncm-v2-code-head">
            <label htmlFor="ncm-v2-code" className="ncm-v2-label">
              Function code <span className="ncm-v2-required">*</span>
            </label>
            <div className="ncm-v2-code-controls">
              <button
                type="button"
                className="ncm-v2-icon-btn"
                onClick={() => setIsCodeExpanded(!isCodeExpanded)}
                title={
                  isCodeExpanded
                    ? 'Collapse code editor'
                    : 'Expand code editor'
                }
              >
                {isCodeExpanded ? '▾' : '▸'}
              </button>
              <button
                type="button"
                className="ncm-v2-icon-btn"
                onClick={() =>
                  setCodeEditorHeight(Math.max(120, codeEditorHeight - 50))
                }
                title="Decrease height"
              >
                −
              </button>
              <button
                type="button"
                className="ncm-v2-icon-btn"
                onClick={() =>
                  setCodeEditorHeight(Math.min(640, codeEditorHeight + 50))
                }
                title="Increase height"
              >
                +
              </button>
              <button
                type="button"
                className="ncm-v2-icon-btn"
                onClick={() => setIsFullScreenEditor(true)}
                title="Open full-screen editor"
              >
                ⤢
              </button>
            </div>
          </div>

          <div className="ncm-v2-code-stats">
            {config.code
              ? `${config.code.split('\n').length} lines · ${
                  config.code.length
                } characters`
              : 'No code entered'}
          </div>

          {!isCodeExpanded && config.code && (
            <div className="ncm-v2-code-snippet">
              {config.code.split('\n').slice(0, 3).join('\n')}
              {config.code.split('\n').length > 3 && '\n…'}
            </div>
          )}

          <textarea
            id="ncm-v2-code"
            value={config.code || ''}
            onChange={(e) => handleInputChange('code', e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Tab') {
                e.preventDefault();
                const textarea = e.target as HTMLTextAreaElement;
                const start = textarea.selectionStart;
                const end = textarea.selectionEnd;
                const value = textarea.value;

                if (e.shiftKey) {
                  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
                  const lineText = value.substring(lineStart, start);
                  if (lineText.startsWith('    ')) {
                    const newValue =
                      value.substring(0, lineStart) +
                      lineText.substring(4) +
                      value.substring(start);
                    handleInputChange('code', newValue);
                    setTimeout(() => {
                      textarea.selectionStart = textarea.selectionEnd =
                        start - 4;
                    }, 0);
                  }
                } else {
                  const newValue =
                    value.substring(0, start) +
                    '    ' +
                    value.substring(end);
                  handleInputChange('code', newValue);
                  setTimeout(() => {
                    textarea.selectionStart = textarea.selectionEnd =
                      start + 4;
                  }, 0);
                }
              } else if (e.key === 'Enter') {
                const textarea = e.target as HTMLTextAreaElement;
                const start = textarea.selectionStart;
                const value = textarea.value;
                const lineStart = value.lastIndexOf('\n', start - 1) + 1;
                const currentLine = value.substring(lineStart, start);
                const indent = currentLine.match(/^(\s*)/)?.[1] || '';
                const extraIndent = currentLine.trim().endsWith(':')
                  ? '    '
                  : '';
                setTimeout(() => {
                  const newStart = textarea.selectionStart;
                  const newValue =
                    textarea.value.substring(0, newStart) +
                    indent +
                    extraIndent +
                    textarea.value.substring(newStart);
                  handleInputChange('code', newValue);
                  setTimeout(() => {
                    textarea.selectionStart = textarea.selectionEnd =
                      newStart + indent.length + extraIndent.length;
                  }, 0);
                }, 0);
              }
            }}
            style={{
              height: isCodeExpanded ? `${codeEditorHeight}px` : '160px',
            }}
            className={`ncm-v2-code${errors.code ? ' error' : ''}`}
            placeholder="Enter your Lambda function code here…"
            spellCheck={false}
          />
          {errors.code && (
            <span className="ncm-v2-error-text">{errors.code}</span>
          )}
        </div>

        {/* Layers */}
        <div className="ncm-v2-divider">
          <h4 className="ncm-v2-section-title">
            Lambda layers
            {loadingLayers && <span> (Loading…)</span>}
          </h4>
          {!selectedRuntime ? (
            <span className="ncm-v2-help">
              Select a runtime first to see compatible layers.
            </span>
          ) : compatibleLayers.length === 0 && !loadingLayers ? (
            <span className="ncm-v2-help">
              No layers available for {selectedRuntime} /{' '}
              {selectedArchitecture}. Create one from the Layers tab.
            </span>
          ) : (
            <div className="ncm-v2-layer-list">
              {compatibleLayers.map((layer) => {
                const checked = selectedLayers.includes(
                  layer.layerVersionArn
                );
                const disabled = !checked && atCap;
                return (
                  <label
                    key={layer.id}
                    className={`ncm-v2-layer-row${
                      checked ? ' ncm-v2-layer-row--checked' : ''
                    }${disabled ? ' ncm-v2-layer-row--disabled' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={(e) => {
                        const newLayers = e.target.checked
                          ? [...selectedLayers, layer.layerVersionArn]
                          : selectedLayers.filter(
                              (arn: string) => arn !== layer.layerVersionArn
                            );
                        handleInputChange('layers', newLayers);
                      }}
                    />
                    <span>
                      {layer.name} <small>(v{layer.version})</small>
                    </span>
                  </label>
                );
              })}
              <span
                className={`ncm-v2-layer-cap${
                  atCap ? ' ncm-v2-layer-cap--full' : ''
                }`}
              >
                {selectedLayers.length}/{MAX_LAMBDA_LAYERS} layers selected
                (AWS limit: {MAX_LAMBDA_LAYERS})
              </span>
            </div>
          )}
        </div>

        {renderIAMRoleSelector('lambda', 'lambda.amazonaws.com')}
      </div>
    );
  };

  const getModalTitle = () => {
    switch (node.type) {
      case 's3':
        return 'Configure S3 operation';
      case 'database':
        return 'Configure database query';
      case 'lambda':
        return 'Configure Lambda function';
      default:
        return 'Configure node';
    }
  };

  return (
    <div className="ncm-v2-overlay" onClick={onClose}>
      <div
        className={`ncm-v2-modal${
          node.type === 'lambda' ? ' ncm-v2-modal--lambda' : ''
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ncm-v2-head">
          <h2 className="ncm-v2-title">
            <span
              className="ncm-v2-title-icon"
              style={{ background: getNodeColor(node.type) }}
              aria-hidden="true"
            >
              {getNodeIcon(node.type)}
            </span>
            {getModalTitle()}
          </h2>
          <button
            type="button"
            className="ncm-v2-close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="ncm-v2-body">
          {node.type === 's3' && renderS3Config()}
          {node.type === 'database' && renderDatabaseConfig()}
          {node.type === 'lambda' && renderLambdaConfig()}
        </div>

        <div className="ncm-v2-foot">
          <button type="button" className="ncm-v2-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="ncm-v2-btn ncm-v2-btn--primary"
            onClick={handleSave}
          >
            Save configuration
          </button>
        </div>
      </div>

      {isFullScreenEditor && (
        <div
          className="ncm-v2-fs-overlay"
          onClick={() => setIsFullScreenEditor(false)}
        >
          <div
            className="ncm-v2-fs-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ncm-v2-fs-head">
              <h3 className="ncm-v2-fs-title">Lambda function code editor</h3>
              <div className="ncm-v2-fs-controls">
                <span className="ncm-v2-fs-stats">
                  {config.code
                    ? `${config.code.split('\n').length} lines · ${
                        config.code.length
                      } characters`
                    : 'No code'}
                </span>
                <button
                  type="button"
                  className="ncm-v2-btn"
                  onClick={() => setIsFullScreenEditor(false)}
                >
                  Close editor
                </button>
              </div>
            </div>
            <textarea
              value={config.code || ''}
              onChange={(e) => handleInputChange('code', e.target.value)}
              className="ncm-v2-fs-code"
              placeholder="Enter your Lambda function code here…"
              autoFocus
              spellCheck={false}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default NodeConfigModal;

/* ---------- Helpers ---------- */

function getNodeColor(type: WorkflowNode['type']): string {
  switch (type) {
    case 's3':
      return '#f59e0b';
    case 'database':
      return '#8b5cf6';
    case 'lambda':
      return '#3b82f6';
    case 'opensearch':
      return '#ec4899';
    default:
      return '#6b7280';
  }
}

function getNodeIcon(type: WorkflowNode['type']): React.ReactNode {
  switch (type) {
    case 's3':
      return <BucketIcon />;
    case 'database':
      return <DatabaseIcon />;
    case 'lambda':
      return <BoltIcon />;
    case 'opensearch':
      return <SearchIcon />;
    default:
      return <BoxIcon />;
  }
}

function BucketIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h16l-1.5 12.6a2 2 0 0 1-2 1.4H7.5a2 2 0 0 1-2-1.4Z" />
      <path d="M4 6V4h16v2" />
    </svg>
  );
}

function DatabaseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v14a9 3 0 0 0 18 0V5" />
      <path d="M3 12a9 3 0 0 0 18 0" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <path d="M13 2 4 14h7l-2 8 9-12h-7Z" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function BoxIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3" />
    </svg>
  );
}
