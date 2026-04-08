import React, { useState, useRef, useCallback, useEffect } from 'react';
import { DndProvider, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { WorkflowNode, Connection } from '../../types/workflow';
import { useWorkflow } from '../../hooks/useWorkflows';
import { DeploymentService } from '../../services/deploymentReal';
import { autoLayoutWorkflow } from '../../utils/workflowLayout';
import NodeComponent from './NodeComponent';
import NodeSidebar from './NodeSidebar';
import NodeConfigModal from './NodeConfigModal';
import DeploymentStatusModal from './DeploymentStatusModal';
import ConnectionsRenderer from './ConnectionsRenderer';
import './WorkflowCanvas.css';

interface WorkflowEditorWrapperProps {
  workflowId: string | null;
  onBackToDashboard: () => void;
  onSignOut: () => void;
}

// Wrapper component that provides the workflow editor functionality without React Router
const WorkflowEditorWrapper: React.FC<WorkflowEditorWrapperProps> = ({
  workflowId,
  onBackToDashboard,
  onSignOut
}) => {
  const { workflow, loading, error, saveWorkflow } = useWorkflow(workflowId);
  
  const [workflowName, setWorkflowName] = useState('Untitled Workflow');
  const [nodes, setNodes] = useState<WorkflowNode[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [isConnecting, setIsConnecting] = useState<{
    sourceNodeId: string;
    sourceHandle: string;
    mousePosition?: { x: number; y: number };
  } | null>(null);
  const [canvasOffset] = useState({ x: 0, y: 0 });
  const [zoom] = useState(1);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const isSavingRefRef = useRef(false);
  const [deploymentModalOpen, setDeploymentModalOpen] = useState(false);
  const [currentDeploymentId, setCurrentDeploymentId] = useState<string | null>(null);
  const [_lastDeploymentStatus, setLastDeploymentStatus] = useState<any>(null);

  const canvasRef = useRef<HTMLDivElement>(null);

  // Load workflow data when workflow is loaded
  useEffect(() => {
    if (workflow) {
      setWorkflowName(workflow.name);
      setNodes(workflow.nodes || []);
      setConnections(workflow.connections || []);
      setHasUnsavedChanges(false);
    }
  }, [workflow]);

  // Auto-save functionality
  useEffect(() => {
    if (hasUnsavedChanges && !isSavingRefRef.current && workflowId) {
      const saveTimer = setTimeout(async () => {
        await handleSave();
      }, 2000); // Auto-save after 2 seconds of inactivity

      return () => clearTimeout(saveTimer);
    }
  }, [hasUnsavedChanges, workflowId]);

  const handleSave = useCallback(async () => {
    if (!workflowId || isSavingRefRef.current) return;

    try {
      setIsSaving(true);
      isSavingRefRef.current = true;

      await saveWorkflow({
        name: workflowName,
        nodes,
        connections,
      });

      setHasUnsavedChanges(false);
    } catch (error) {
      console.error('Failed to save workflow:', error);
    } finally {
      setIsSaving(false);
      isSavingRefRef.current = false;
    }
  }, [workflowId, workflowName, nodes, connections, saveWorkflow]);

  const handleDeploy = useCallback(async () => {
    if (!workflowId || isDeploying) return;

    try {
      setIsDeploying(true);
      
      // Save first if there are unsaved changes
      if (hasUnsavedChanges) {
        await handleSave();
      }

      const deploymentService = new DeploymentService();
      const deploymentId = await deploymentService.deployWorkflow(workflowId, {
        name: workflowName,
        nodes,
        connections,
      });

      setCurrentDeploymentId(deploymentId);
      setDeploymentModalOpen(true);
    } catch (error) {
      console.error('Failed to deploy workflow:', error);
      alert('Failed to deploy workflow. Please try again.');
    } finally {
      setIsDeploying(false);
    }
  }, [workflowId, workflowName, nodes, connections, hasUnsavedChanges, handleSave, isDeploying]);

  const addNode = useCallback((nodeType: string, position: { x: number; y: number }) => {
    const newNode: WorkflowNode = {
      id: `node-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: nodeType as any,
      name: `${nodeType.charAt(0).toUpperCase() + nodeType.slice(1)} Node`,
      position,
      config: {},
      isConfigured: false,
    };

    setNodes(prev => [...prev, newNode]);
    setHasUnsavedChanges(true);
  }, []);

  const updateNode = useCallback((nodeId: string, updates: Partial<WorkflowNode>) => {
    setNodes(prev => prev.map(node => 
      node.id === nodeId ? { ...node, ...updates } : node
    ));
    setHasUnsavedChanges(true);
  }, []);

  const deleteNode = useCallback((nodeId: string) => {
    setNodes(prev => prev.filter(node => node.id !== nodeId));
    setConnections(prev => prev.filter(conn => 
      conn.sourceNodeId !== nodeId && conn.targetNodeId !== nodeId
    ));
    setHasUnsavedChanges(true);
  }, []);

  const addConnection = useCallback((connection: Connection) => {
    setConnections(prev => [...prev, connection]);
    setHasUnsavedChanges(true);
  }, []);

  const deleteConnection = useCallback((connectionId: string) => {
    setConnections(prev => prev.filter(conn => conn.id !== connectionId));
    setHasUnsavedChanges(true);
  }, []);

  const handleAutoLayout = useCallback(() => {
    const layoutedNodes = autoLayoutWorkflow(nodes, connections);
    setNodes(layoutedNodes);
    setHasUnsavedChanges(true);
  }, [nodes, connections]);

  // Canvas component that uses useDrop inside DndProvider
  const WorkflowCanvas = () => {
    const [, drop] = useDrop({
      accept: 'node',
      drop: (item: { type: string }, monitor) => {
        if (!canvasRef.current) return;

        const canvasRect = canvasRef.current.getBoundingClientRect();
        const clientOffset = monitor.getClientOffset();
        
        if (clientOffset) {
          const position = {
            x: (clientOffset.x - canvasRect.left - canvasOffset.x) / zoom,
            y: (clientOffset.y - canvasRect.top - canvasOffset.y) / zoom,
          };
          
          addNode(item.type, position);
        }
      },
    });

    return (
      <div 
        ref={(node) => {
          canvasRef.current = node;
          drop(node);
        }}
        className="workflow-canvas"
      >
        <ConnectionsRenderer
          connections={connections}
          nodes={nodes}
          onDeleteConnection={deleteConnection}
          isConnecting={isConnecting}
        />
        
        {nodes.map((node) => (
          <NodeComponent
            key={node.id}
            node={node}
            isSelected={selectedNode === node.id}
            onSelect={setSelectedNode}
            onUpdate={updateNode}
            onDelete={deleteNode}
            onStartConnection={setIsConnecting}
            onEndConnection={(targetNodeId, targetHandle) => {
              if (isConnecting) {
                const connection: Connection = {
                  id: `conn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                  sourceNodeId: isConnecting.sourceNodeId,
                  sourceHandle: isConnecting.sourceHandle,
                  targetNodeId,
                  targetHandle,
                };
                addConnection(connection);
                setIsConnecting(null);
              }
            }}
          />
        ))}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="workflow-editor-loading">
        <div className="loading-spinner"></div>
        <p>Loading workflow...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="workflow-editor-error">
        <h3>Error Loading Workflow</h3>
        <p>{error}</p>
        <button onClick={onBackToDashboard} className="back-btn">
          Back to Dashboard
        </button>
      </div>
    );
  }

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="workflow-editor">
        {/* Header */}
        <div className="workflow-header">
          <div className="header-left">
            <button onClick={onBackToDashboard} className="back-btn">
              ← Back to Dashboard
            </button>
            <div className="workflow-title">
              <input
                type="text"
                value={workflowName}
                onChange={(e) => {
                  setWorkflowName(e.target.value);
                  setHasUnsavedChanges(true);
                }}
                className="workflow-name-input"
                placeholder="Workflow name"
              />
              {hasUnsavedChanges && <span className="unsaved-indicator">•</span>}
            </div>
          </div>
          
          <div className="header-right">
            <button
              onClick={handleSave}
              disabled={isSaving || !hasUnsavedChanges}
              className="save-btn"
            >
              {isSaving ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={handleAutoLayout}
              className="layout-btn"
            >
              Auto Layout
            </button>
            <button
              onClick={handleDeploy}
              disabled={isDeploying}
              className="deploy-btn"
            >
              {isDeploying ? 'Deploying...' : 'Deploy'}
            </button>
            <button onClick={onSignOut} className="sign-out-btn">
              Sign Out
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div className="workflow-content">
          {/* Sidebar */}
          <NodeSidebar />

          {/* Canvas */}
          <WorkflowCanvas />
        </div>

        {/* Modals */}
        {configModalOpen && selectedNode && (
          <NodeConfigModal
            node={nodes.find(n => n.id === selectedNode)!}
            isOpen={configModalOpen}
            onClose={() => setConfigModalOpen(false)}
            onSave={(config) => {
              updateNode(selectedNode, { config, isConfigured: true });
              setConfigModalOpen(false);
            }}
          />
        )}

        {deploymentModalOpen && currentDeploymentId && (
          <DeploymentStatusModal
            deploymentId={currentDeploymentId}
            isOpen={deploymentModalOpen}
            onClose={() => {
              setDeploymentModalOpen(false);
              setCurrentDeploymentId(null);
            }}
            onStatusUpdate={setLastDeploymentStatus}
          />
        )}
      </div>
    </DndProvider>
  );
};

export default WorkflowEditorWrapper;