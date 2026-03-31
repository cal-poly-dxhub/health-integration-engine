import React, { useState } from 'react';

export interface VpcConfig {
  mode: 'none' | 'existing' | 'new';
  existing?: {
    vpcId: string;
    subnetIds: string[];
    securityGroupIds: string[];
  };
  new?: {
    cidrBlock?: string;
  };
}

interface VpcConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDeploy: (vpcConfig: VpcConfig) => void;
  isDeploying: boolean;
}

const VpcConfigModal: React.FC<VpcConfigModalProps> = ({ isOpen, onClose, onDeploy, isDeploying }) => {
  const [mode, setMode] = useState<'none' | 'existing' | 'new'>('none');
  const [vpcId, setVpcId] = useState('');
  const [subnetIds, setSubnetIds] = useState('');
  const [securityGroupIds, setSecurityGroupIds] = useState('');
  const [cidrBlock, setCidrBlock] = useState('10.0.0.0/16');

  if (!isOpen) return null;

  const handleDeploy = () => {
    const config: VpcConfig = { mode };
    if (mode === 'existing') {
      config.existing = {
        vpcId: vpcId.trim(),
        subnetIds: subnetIds.split(',').map(s => s.trim()).filter(Boolean),
        securityGroupIds: securityGroupIds.split(',').map(s => s.trim()).filter(Boolean),
      };
    } else if (mode === 'new') {
      config.new = { cidrBlock: cidrBlock.trim() || undefined };
    }
    onDeploy(config);
  };

  const isValid = mode === 'none' || mode === 'new' || (
    mode === 'existing' && vpcId.trim() && subnetIds.trim() && securityGroupIds.trim()
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '520px' }}>
        <div className="modal-header">
          <h2>Deploy to AWS</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{ padding: '20px' }}>
          <label style={{ fontWeight: 600, marginBottom: '12px', display: 'block' }}>
            VPC Configuration for Lambda Functions
          </label>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
            {(['none', 'existing', 'new'] as const).map(opt => (
              <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input type="radio" name="vpcMode" value={opt} checked={mode === opt} onChange={() => setMode(opt)} />
                {{
                  none: 'No VPC — Lambda functions run without VPC',
                  existing: 'Use existing VPC',
                  new: 'Create new VPC for this workflow',
                }[opt]}
              </label>
            ))}
          </div>

          {mode === 'existing' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px', background: '#f8f9fa', borderRadius: '6px' }}>
              <div>
                <label style={{ fontSize: '13px', fontWeight: 500 }}>VPC ID</label>
                <input
                  type="text"
                  value={vpcId}
                  onChange={e => setVpcId(e.target.value)}
                  placeholder="vpc-0abc123def456"
                  style={{ width: '100%', padding: '6px 8px', marginTop: '4px', borderRadius: '4px', border: '1px solid #ccc' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '13px', fontWeight: 500 }}>Subnet IDs (comma-separated)</label>
                <input
                  type="text"
                  value={subnetIds}
                  onChange={e => setSubnetIds(e.target.value)}
                  placeholder="subnet-abc123, subnet-def456"
                  style={{ width: '100%', padding: '6px 8px', marginTop: '4px', borderRadius: '4px', border: '1px solid #ccc' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '13px', fontWeight: 500 }}>Security Group IDs (comma-separated)</label>
                <input
                  type="text"
                  value={securityGroupIds}
                  onChange={e => setSecurityGroupIds(e.target.value)}
                  placeholder="sg-abc123"
                  style={{ width: '100%', padding: '6px 8px', marginTop: '4px', borderRadius: '4px', border: '1px solid #ccc' }}
                />
              </div>
            </div>
          )}

          {mode === 'new' && (
            <div style={{ padding: '12px', background: '#f8f9fa', borderRadius: '6px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500 }}>CIDR Block (optional)</label>
              <input
                type="text"
                value={cidrBlock}
                onChange={e => setCidrBlock(e.target.value)}
                placeholder="10.0.0.0/16"
                style={{ width: '100%', padding: '6px 8px', marginTop: '4px', borderRadius: '4px', border: '1px solid #ccc' }}
              />
              <p style={{ fontSize: '12px', color: '#666', marginTop: '6px' }}>
                Creates a VPC with public/private subnets, NAT gateway, and a security group. Resources are deleted when the workflow is undeployed.
              </p>
            </div>
          )}
        </div>
        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '12px 20px' }}>
          <button className="toolbar-btn" onClick={onClose} disabled={isDeploying}>Cancel</button>
          <button
            className="toolbar-btn deploy-btn"
            onClick={handleDeploy}
            disabled={!isValid || isDeploying}
          >
            {isDeploying ? 'Starting Deployment...' : 'Deploy to AWS'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default VpcConfigModal;
