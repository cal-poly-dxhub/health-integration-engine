import React, { useState, useEffect } from 'react';
import { WorkflowNode } from '../../types/workflow';
import './NodeConfigModal.css';

interface NodeConfigModalProps {
  node: WorkflowNode;
  isOpen: boolean;
  onClose: () => void;
  onSave: (nodeId: string, config: any) => void;
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
  const [codeEditorHeight, setCodeEditorHeight] = useState(200);
  const [isFullScreenEditor, setIsFullScreenEditor] = useState(false);

  useEffect(() => {
    if (isOpen && node) {
      // Initialize config based on node type
      switch (node.type) {
        case 's3':
          setConfig({
            bucketName: (node.config as any)?.bucketName || '',
            operation: (node.config as any)?.operation || 'read',
            folderPrefix: (node.config as any)?.folderPrefix || '',
            triggerOnUpload: (node.config as any)?.triggerOnUpload ?? true,
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
            runtime: (node.config as any)?.runtime || 'nodejs18.x',
            code: (node.config as any)?.code || '// Your Lambda function code here\nexports.handler = async (event) => {\n    // TODO: implement\n    return {\n        statusCode: 200,\n        body: JSON.stringify("Hello from Lambda!")\n    };\n};',
            timeout: (node.config as any)?.timeout || 30,
            memory: (node.config as any)?.memory || 128,
          });
          break;
        default:
          setConfig({});
      }
      setErrors({});
    }
  }, [isOpen, node]);

  const validateConfig = () => {
    const newErrors: Record<string, string> = {};

    switch (node.type) {
      case 's3':
        if (!config.bucketName) newErrors.bucketName = 'Bucket name is required';
        break;
      case 'database':
        if (!config.host) newErrors.host = 'Host is required';
        if (!config.database) newErrors.database = 'Database name is required';
        if (!config.query) newErrors.query = 'SQL query is required';
        if (!config.username) newErrors.username = 'Username is required';
        break;
      case 'lambda':
        if (!config.functionName) newErrors.functionName = 'Function name is required';
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

  const handleInputChange = (field: string, value: string | number) => {
    setConfig((prev: any) => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  if (!isOpen) return null;

  const renderS3Config = () => (
    <div className="config-form">
      <div className="form-group">
        <label htmlFor="bucketName">S3 Bucket Name *</label>
        <input
          id="bucketName"
          type="text"
          value={config.bucketName || ''}
          onChange={(e) => handleInputChange('bucketName', e.target.value)}
          placeholder="my-s3-bucket"
          className={errors.bucketName ? 'error' : ''}
        />
        {errors.bucketName && <span className="error-text">{errors.bucketName}</span>}
        <small className="help-text">Bucket names must be lowercase, contain only letters, numbers, dots, and hyphens</small>
      </div>

      <div className="form-group">
        <label htmlFor="operation">Operation</label>
        <select
          id="operation"
          value={config.operation || 'read'}
          onChange={(e) => handleInputChange('operation', e.target.value)}
        >
          <option value="read">Read Object</option>
          <option value="write">Write Object</option>
          <option value="delete">Delete Object</option>
          <option value="list">List Objects</option>
        </select>
      </div>

      <div className="form-group">
        <label htmlFor="folderPrefix">Folder Path (Optional)</label>
        <input
          id="folderPrefix"
          type="text"
          value={config.folderPrefix || ''}
          onChange={(e) => handleInputChange('folderPrefix', e.target.value)}
          placeholder="uploads/documents/"
        />
        <small className="help-text">Optional folder prefix to watch. Leave empty to watch entire bucket. Include trailing slash.</small>
      </div>

      <div className="trigger-info">
        <h4>🔄 Auto-Trigger Enabled</h4>
        <p>
          This workflow will automatically execute whenever a new file is uploaded to the specified bucket
          {config.folderPrefix ? ` in the "${config.folderPrefix}" folder` : ''}.
        </p>
        <p className="info-note">
          <strong>Note:</strong> EventBridge notifications will be enabled on the S3 bucket during deployment.
        </p>
      </div>
    </div>
  );

  const renderDatabaseConfig = () => (
    <div className="config-form">
      <div className="form-group">
        <label htmlFor="connectionType">Database Type</label>
        <select
          id="connectionType"
          value={config.connectionType || 'mysql'}
          onChange={(e) => handleInputChange('connectionType', e.target.value)}
        >
          <option value="mysql">MySQL</option>
          <option value="postgresql">PostgreSQL</option>
          <option value="dynamodb">DynamoDB</option>
          <option value="mongodb">MongoDB</option>
        </select>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label htmlFor="host">Host *</label>
          <input
            id="host"
            type="text"
            value={config.host || ''}
            onChange={(e) => handleInputChange('host', e.target.value)}
            placeholder="localhost"
            className={errors.host ? 'error' : ''}
          />
          {errors.host && <span className="error-text">{errors.host}</span>}
        </div>
        <div className="form-group">
          <label htmlFor="port">Port</label>
          <input
            id="port"
            type="number"
            value={config.port || ''}
            onChange={(e) => handleInputChange('port', e.target.value)}
            placeholder="3306"
          />
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="database">Database Name *</label>
        <input
          id="database"
          type="text"
          value={config.database || ''}
          onChange={(e) => handleInputChange('database', e.target.value)}
          placeholder="my_database"
          className={errors.database ? 'error' : ''}
        />
        {errors.database && <span className="error-text">{errors.database}</span>}
      </div>

      <div className="form-row">
        <div className="form-group">
          <label htmlFor="username">Username *</label>
          <input
            id="username"
            type="text"
            value={config.username || ''}
            onChange={(e) => handleInputChange('username', e.target.value)}
            className={errors.username ? 'error' : ''}
          />
          {errors.username && <span className="error-text">{errors.username}</span>}
        </div>
        <div className="form-group">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={config.password || ''}
            onChange={(e) => handleInputChange('password', e.target.value)}
          />
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="query">SQL Query *</label>
        <textarea
          id="query"
          value={config.query || ''}
          onChange={(e) => handleInputChange('query', e.target.value)}
          placeholder="SELECT * FROM users WHERE id = ?"
          rows={4}
          className={errors.query ? 'error' : ''}
        />
        {errors.query && <span className="error-text">{errors.query}</span>}
      </div>
    </div>
  );

  const renderLambdaConfig = () => (
    <div className="config-form">
      <div className="form-group">
        <label htmlFor="functionName">Function Name *</label>
        <input
          id="functionName"
          type="text"
          value={config.functionName || ''}
          onChange={(e) => handleInputChange('functionName', e.target.value)}
          placeholder="my-lambda-function"
          className={errors.functionName ? 'error' : ''}
        />
        {errors.functionName && <span className="error-text">{errors.functionName}</span>}
      </div>

      <div className="form-group">
        <label htmlFor="runtime">Runtime</label>
        <select
          id="runtime"
          value={config.runtime || 'python3.12'}
          onChange={(e) => handleInputChange('runtime', e.target.value)}
        >
          <option value="nodejs18.x">Node.js 18.x</option>
          <option value="nodejs16.x">Node.js 16.x</option>
          <option value="python3.13">Python 3.13</option>
          <option value="python3.12">Python 3.12</option>
          <option value="python3.11">Python 3.11</option>
          <option value="python3.10">Python 3.10</option>
          <option value="python3.9">Python 3.9</option>
          <option value="python3.8">Python 3.8</option>
          <option value="java11">Java 11</option>
          <option value="dotnet6">C# (.NET 6)</option>
        </select>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label htmlFor="timeout">Timeout (seconds)</label>
          <input
            id="timeout"
            type="number"
            min="1"
            max="900"
            value={config.timeout || 30}
            onChange={(e) => handleInputChange('timeout', parseInt(e.target.value))}
          />
        </div>
        <div className="form-group">
          <label htmlFor="memory">Memory (MB)</label>
          <select
            id="memory"
            value={config.memory || 128}
            onChange={(e) => handleInputChange('memory', parseInt(e.target.value))}
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

      <div className="form-group">
        <div className="code-editor-header">
          <label htmlFor="code">Function Code *</label>
          <div className="code-editor-controls">
            <button
              type="button"
              className="btn-icon"
              onClick={() => setIsCodeExpanded(!isCodeExpanded)}
              title={isCodeExpanded ? "Collapse code editor" : "Expand code editor"}
            >
              {isCodeExpanded ? "📉" : "📈"}
            </button>
            <button
              type="button"
              className="btn-icon"
              onClick={() => setCodeEditorHeight(Math.max(100, codeEditorHeight - 50))}
              title="Decrease height"
            >
              ➖
            </button>
            <button
              type="button"
              className="btn-icon"
              onClick={() => setCodeEditorHeight(Math.min(600, codeEditorHeight + 50))}
              title="Increase height"
            >
              ➕
            </button>
            <button
              type="button"
              className="btn-icon"
              onClick={() => setIsFullScreenEditor(true)}
              title="Open full-screen editor"
            >
              🔍
            </button>
          </div>
        </div>
        
        {!isCodeExpanded && config.code && (
          <div className="code-preview">
            <small className="code-preview-text">
              {config.code.split('\n').length} lines, {config.code.length} characters
            </small>
            <div className="code-snippet">
              {config.code.split('\n').slice(0, 3).join('\n')}
              {config.code.split('\n').length > 3 && '\n...'}
            </div>
          </div>
        )}
        
        {isCodeExpanded && (
          <div className="code-preview expanded">
            <small className="code-preview-text">
              {config.code ? `${config.code.split('\n').length} lines, ${config.code.length} characters` : 'No code entered'}
            </small>
          </div>
        )}
        
        <div className={`code-editor-container ${isCodeExpanded ? 'expanded' : 'collapsed'}`}>
          <textarea
            id="code"
            value={config.code || ''}
            onChange={(e) => handleInputChange('code', e.target.value)}
            onKeyDown={(e) => {
              // Handle Tab key for proper indentation
              if (e.key === 'Tab') {
                e.preventDefault();
                const textarea = e.target as HTMLTextAreaElement;
                const start = textarea.selectionStart;
                const end = textarea.selectionEnd;
                const value = textarea.value;
                
                if (e.shiftKey) {
                  // Shift+Tab: Remove indentation
                  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
                  const lineText = value.substring(lineStart, start);
                  if (lineText.startsWith('    ')) {
                    const newValue = value.substring(0, lineStart) + 
                                   lineText.substring(4) + 
                                   value.substring(start);
                    handleInputChange('code', newValue);
                    setTimeout(() => {
                      textarea.selectionStart = textarea.selectionEnd = start - 4;
                    }, 0);
                  }
                } else {
                  // Tab: Add indentation (4 spaces for Python)
                  const newValue = value.substring(0, start) + '    ' + value.substring(end);
                  handleInputChange('code', newValue);
                  setTimeout(() => {
                    textarea.selectionStart = textarea.selectionEnd = start + 4;
                  }, 0);
                }
              }
              // Handle Enter key for auto-indentation
              else if (e.key === 'Enter') {
                const textarea = e.target as HTMLTextAreaElement;
                const start = textarea.selectionStart;
                const value = textarea.value;
                const lineStart = value.lastIndexOf('\n', start - 1) + 1;
                const currentLine = value.substring(lineStart, start);
                const indent = currentLine.match(/^(\s*)/)?.[1] || '';
                
                // Add extra indentation after colons (Python)
                const extraIndent = currentLine.trim().endsWith(':') ? '    ' : '';
                
                setTimeout(() => {
                  const newStart = textarea.selectionStart;
                  const newValue = textarea.value.substring(0, newStart) + 
                                 indent + extraIndent + 
                                 textarea.value.substring(newStart);
                  handleInputChange('code', newValue);
                  setTimeout(() => {
                    textarea.selectionStart = textarea.selectionEnd = newStart + indent.length + extraIndent.length;
                  }, 0);
                }, 0);
              }
            }}
            style={{ height: isCodeExpanded ? `${codeEditorHeight}px` : '120px' }}
            className={`code-editor ${errors.code ? 'error' : ''}`}
            placeholder="Enter your Lambda function code here..."
            spellCheck={false}
          />
        </div>
        {errors.code && <span className="error-text">{errors.code}</span>}
      </div>
    </div>
  );

  const getModalTitle = () => {
    switch (node.type) {
      case 's3': return 'Configure S3 Operation';
      case 'database': return 'Configure Database Query';
      case 'lambda': return 'Configure Lambda Function';
      default: return 'Configure Node';
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal-content node-config-modal ${node.type === 'lambda' ? 'lambda-modal' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{getModalTitle()}</h2>
          <button className="modal-close-btn" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-body">
          {node.type === 's3' && renderS3Config()}
          {node.type === 'database' && renderDatabaseConfig()}
          {node.type === 'lambda' && renderLambdaConfig()}
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

      {/* Full-Screen Code Editor */}
      {isFullScreenEditor && (
        <div className="fullscreen-editor-overlay" onClick={() => setIsFullScreenEditor(false)}>
          <div className="fullscreen-editor-container" onClick={(e) => e.stopPropagation()}>
            <div className="fullscreen-editor-header">
              <h3>Lambda Function Code Editor</h3>
              <div className="fullscreen-editor-controls">
                <span className="code-stats">
                  {config.code ? `${config.code.split('\n').length} lines, ${config.code.length} characters` : 'No code'}
                </span>
                <button
                  className="btn btn-secondary"
                  onClick={() => setIsFullScreenEditor(false)}
                >
                  Close Editor
                </button>
              </div>
            </div>
            <textarea
              value={config.code || ''}
              onChange={(e) => handleInputChange('code', e.target.value)}
              className="fullscreen-code-editor"
              placeholder="Enter your Lambda function code here..."
              autoFocus
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default NodeConfigModal;