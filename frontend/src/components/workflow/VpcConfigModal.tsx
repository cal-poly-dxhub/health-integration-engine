import React, { useState, useEffect } from 'react';
import apiService from '../../services/api';
import { WorkflowVpcConfig } from '../../types/workflow';

interface VpcConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (vpcConfig: WorkflowVpcConfig) => void;
  initialConfig?: WorkflowVpcConfig;
}

const VpcConfigModal: React.FC<VpcConfigModalProps> = ({ isOpen, onClose, onSave, initialConfig }) => {
  const [mode, setMode] = useState<'none' | 'existing' | 'new'>(initialConfig?.mode || 'none');
  const [vpcId, setVpcId] = useState(initialConfig?.existing?.vpcId || '');
  const [subnetIds, setSubnetIds] = useState<string[]>(initialConfig?.existing?.subnetIds || []);
  const [securityGroupIds, setSecurityGroupIds] = useState<string[]>(initialConfig?.existing?.securityGroupIds || []);
  const [cidrBlock, setCidrBlock] = useState(initialConfig?.new?.cidrBlock || '10.0.0.0/16');
  const [availableVpcs, setAvailableVpcs] = useState<any[]>([]);
  const [loadingVpcs, setLoadingVpcs] = useState(false);
  const [vpcFetchFailed, setVpcFetchFailed] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setMode(initialConfig?.mode || 'none');
      setVpcId(initialConfig?.existing?.vpcId || '');
      setSubnetIds(initialConfig?.existing?.subnetIds || []);
      setSecurityGroupIds(initialConfig?.existing?.securityGroupIds || []);
      setCidrBlock(initialConfig?.new?.cidrBlock || '10.0.0.0/16');
      fetchVpcs();
    }
  }, [isOpen, initialConfig]);

  const fetchVpcs = async () => {
    setLoadingVpcs(true);
    setVpcFetchFailed(false);
    try {
      const response: any = await apiService.get('/vpc/list');
      let vpcs = response?.vpcs || response?.data?.vpcs || [];
      if (typeof response?.body === 'string') {
        try { vpcs = JSON.parse(response.body).vpcs || []; } catch { /* ignore */ }
      }
      setAvailableVpcs(vpcs);
      if (vpcs.length === 0) setVpcFetchFailed(true);
    } catch {
      setVpcFetchFailed(true);
      setAvailableVpcs([]);
    } finally {
      setLoadingVpcs(false);
    }
  };

  if (!isOpen) return null;

  const handleSave = () => {
    const config: WorkflowVpcConfig = { mode };
    if (mode === 'existing') {
      config.existing = { vpcId, subnetIds, securityGroupIds };
    } else if (mode === 'new') {
      config.new = { cidrBlock: cidrBlock.trim() || undefined };
    }
    onSave(config);
  };

  const isValid = mode === 'none' || mode === 'new' || (
    mode === 'existing' && vpcId.trim() && subnetIds.length > 0 && securityGroupIds.length > 0
  );

  const selectedVpc = availableVpcs.find((v: any) => v.vpcId === vpcId);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '520px' }}>
        <div className="modal-header">
          <h2>Workflow VPC Configuration</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{ padding: '20px' }}>
          <p style={{ fontSize: '13px', color: '#666', marginBottom: '16px' }}>
            All Lambda functions and OpenSearch indexers in this workflow will share this VPC.
          </p>

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
              {loadingVpcs ? (
                <p style={{ fontSize: '13px', color: '#666' }}>Loading VPCs...</p>
              ) : vpcFetchFailed || availableVpcs.length === 0 ? (
                <>
                  {vpcFetchFailed && (
                    <p style={{ fontSize: '12px', color: '#b45309', marginBottom: '4px' }}>Could not load VPCs from AWS. Enter details manually.</p>
                  )}
                  <div>
                    <label style={{ fontSize: '13px', fontWeight: 500 }}>VPC ID</label>
                    <input type="text" value={vpcId} onChange={e => setVpcId(e.target.value)} placeholder="vpc-0abc123def456"
                      style={{ width: '100%', padding: '6px 8px', marginTop: '4px', borderRadius: '4px', border: '1px solid #ccc' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: '13px', fontWeight: 500 }}>Subnet IDs (comma-separated)</label>
                    <input type="text" value={subnetIds.join(', ')} onChange={e => setSubnetIds(e.target.value.split(',').map(s => s.trim()).filter(Boolean))} placeholder="subnet-abc123, subnet-def456"
                      style={{ width: '100%', padding: '6px 8px', marginTop: '4px', borderRadius: '4px', border: '1px solid #ccc' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: '13px', fontWeight: 500 }}>Security Group IDs (comma-separated)</label>
                    <input type="text" value={securityGroupIds.join(', ')} onChange={e => setSecurityGroupIds(e.target.value.split(',').map(s => s.trim()).filter(Boolean))} placeholder="sg-abc123"
                      style={{ width: '100%', padding: '6px 8px', marginTop: '4px', borderRadius: '4px', border: '1px solid #ccc' }} />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label style={{ fontSize: '13px', fontWeight: 500 }}>VPC</label>
                    <select value={vpcId} onChange={e => { setVpcId(e.target.value); setSubnetIds([]); setSecurityGroupIds([]); }}
                      style={{ width: '100%', padding: '6px 8px', marginTop: '4px', borderRadius: '4px', border: '1px solid #ccc' }}>
                      <option value="">Select a VPC...</option>
                      {availableVpcs.map((vpc: any) => (
                        <option key={vpc.vpcId} value={vpc.vpcId}>
                          {vpc.name ? `${vpc.name} (${vpc.vpcId})` : vpc.vpcId}{vpc.isDefault ? ' — default' : ''} — {vpc.cidrBlock}
                        </option>
                      ))}
                    </select>
                  </div>
                  {vpcId && selectedVpc && (
                    <>
                      <div>
                        <label style={{ fontSize: '13px', fontWeight: 500 }}>Subnets</label>
                        <div style={{ maxHeight: '140px', overflowY: 'auto', marginTop: '4px', border: '1px solid #ccc', borderRadius: '4px', padding: '4px' }}>
                          {(selectedVpc.subnets || []).map((s: any) => (
                            <label key={s.subnetId} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 4px', fontSize: '13px', cursor: 'pointer', fontWeight: 400 }}>
                              <input type="checkbox" checked={subnetIds.includes(s.subnetId)}
                                onChange={e => setSubnetIds(e.target.checked ? [...subnetIds, s.subnetId] : subnetIds.filter(id => id !== s.subnetId))}
                                style={{ margin: 0, width: 'auto' }} />
                              {s.name ? `${s.name} (${s.subnetId})` : s.subnetId} — {s.availabilityZone} — {s.cidrBlock}
                            </label>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label style={{ fontSize: '13px', fontWeight: 500 }}>Security Groups</label>
                        <div style={{ maxHeight: '140px', overflowY: 'auto', marginTop: '4px', border: '1px solid #ccc', borderRadius: '4px', padding: '4px' }}>
                          {(selectedVpc.securityGroups || []).map((sg: any) => (
                            <label key={sg.groupId} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 4px', fontSize: '13px', cursor: 'pointer', fontWeight: 400 }}>
                              <input type="checkbox" checked={securityGroupIds.includes(sg.groupId)}
                                onChange={e => setSecurityGroupIds(e.target.checked ? [...securityGroupIds, sg.groupId] : securityGroupIds.filter(id => id !== sg.groupId))}
                                style={{ margin: 0, width: 'auto' }} />
                              {sg.name} ({sg.groupId}){sg.description ? ` — ${sg.description}` : ''}
                            </label>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {mode === 'new' && (
            <div style={{ padding: '12px', background: '#f8f9fa', borderRadius: '6px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500 }}>CIDR Block (optional)</label>
              <input type="text" value={cidrBlock} onChange={e => setCidrBlock(e.target.value)} placeholder="10.0.0.0/16"
                style={{ width: '100%', padding: '6px 8px', marginTop: '4px', borderRadius: '4px', border: '1px solid #ccc' }} />
              <p style={{ fontSize: '12px', color: '#666', marginTop: '6px' }}>
                Creates a shared VPC with public/private subnets, NAT gateway, and a security group. The VPC is part of the CloudFormation stack and persists across redeployments.
              </p>
            </div>
          )}
        </div>
        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '12px 20px' }}>
          <button className="toolbar-btn" onClick={onClose}>Cancel</button>
          <button className="toolbar-btn deploy-btn" onClick={handleSave} disabled={!isValid}>
            Save VPC Config
          </button>
        </div>
      </div>
    </div>
  );
};

export default VpcConfigModal;
