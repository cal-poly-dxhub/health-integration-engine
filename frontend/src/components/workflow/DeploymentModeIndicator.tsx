import React from 'react';
import { DeploymentService } from '../../services/deploymentReal';
import './DeploymentModeIndicator.css';

const DeploymentModeIndicator: React.FC = () => {
  const currentMode = DeploymentService.getDeploymentMode();
  
  const handleToggleMode = () => {
    if (currentMode === 'mock') {
      DeploymentService.enableRealDeployment();
    } else {
      DeploymentService.enableMockDeployment();
    }
    // Force page refresh to apply changes
    window.location.reload();
  };

  return (
    <div className={`deployment-mode-indicator ${currentMode}`}>
      <div className="mode-info">
        <span className="mode-icon">
          {currentMode === 'real' ? '🚀' : '🎭'}
        </span>
        <span className="mode-text">
          {currentMode === 'real' ? 'Real AWS Deployment' : 'Mock Deployment'}
        </span>
      </div>
      
      <button 
        onClick={handleToggleMode}
        className="mode-toggle-btn"
        title={`Switch to ${currentMode === 'real' ? 'mock' : 'real'} deployment`}
      >
        Switch to {currentMode === 'real' ? 'Mock' : 'Real'}
      </button>
      
      {currentMode === 'mock' && (
        <div className="mode-warning">
          <span className="warning-icon">⚠️</span>
          <span>Demo mode - no AWS resources will be created</span>
        </div>
      )}
      
      {currentMode === 'real' && (
        <div className="mode-success">
          <span className="success-icon">✅</span>
          <span>Live mode - will create actual AWS resources</span>
        </div>
      )}
    </div>
  );
};

export default DeploymentModeIndicator;