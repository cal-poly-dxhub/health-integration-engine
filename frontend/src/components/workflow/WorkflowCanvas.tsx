import React, { useState, useRef, useCallback, useEffect } from 'react';
// import { flushSync } from 'react-dom';
import { DndProvider, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { useParams, useNavigate } from 'react-router-dom';
import { WorkflowNode, Connection } from '../../types/workflow';
import { useWorkflow } from '../../hooks/useWorkflows';
import { DeploymentService, DeploymentStatus } from '../../services/deploymentReal';
import { autoLayoutWorkflow } from '../../utils/workflowLayout';
import NodeComponent from './NodeComponent';
import NodeSidebar from './NodeSidebar';
import NodeConfigModal from './NodeConfigModal';
import DeploymentStatusModal from './DeploymentStatusModal';
import { VpcConfig } from './VpcConfigModal';
import ConnectionsRenderer from './ConnectionsRenderer';
import './WorkflowCanvas.css';

// Separate the canvas content into its own component to properly use DndProvider
const WorkflowCanvasContent: React.FC = () => {
  const { workflowId } = useParams<{ workflowId?: string }>();
  const navigate = useNavigate();
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
  // Removed unused isSavingRef state
  const isSavingRefRef = useRef(false);
  const [deploymentModalOpen, setDeploymentModalOpen] = useState(false);
  const [currentDeploymentId, setCurrentDeploymentId] = useState<string | null>(null);
  const [lastDeploymentStatus, setLastDeploymentStatus] = useState<DeploymentStatus | null>(null);
  const [opensearchEnabled, setOpensearchEnabled] = useState(false);
  const [opensearchIndexName, setOpensearchIndexName] = useState('health-messages');

  const buildOpensearchNode = useCallback((): WorkflowNode => ({
    id: 'opensearch-auto',
    type: 'opensearch',
    name: 'OpenSearch Indexing',
    position: { x: 0, y: 0 },
    config: { type: 'opensearch' as const, operation: 'index' as const, indexName: opensearchIndexName, collectionEndpoint: '' },
    isConfigured: true,
  }), [opensearchIndexName]);

  const canvasRef = useRef<HTMLDivElement>(null);

  // Load workflow data when workflow is loaded
  useEffect(() => {
    if (workflow) {
      setWorkflowName(workflow.name);
      
      // Fix isConfigured flag for nodes that have config but aren't marked as configured
      const fixedNodes = (workflow.nodes || []).map(node => {
        const wasConfigured = node.isConfigured;
        const isStartEnd = node.type === 'start' || node.type === 'end';
        const hasConfig = node.config && Object.keys(node.config).length > 0;
        const shouldBeConfigured = wasConfigured || isStartEnd || hasConfig;
        
        // Debug logging
        console.log(`🔍 Node ${node.id} (${node.type}):`, {
          wasConfigured,
          isStartEnd,
          hasConfig,
          configKeys: node.config ? Object.keys(node.config) : [],
          shouldBeConfigured
        });
        
        return {
          ...node,
          // Set isConfigured to true if:
          // 1. It's already configured, OR
          // 2. It's a start/end node (always configured), OR  
          // 3. It has a config object (was configured but flag wasn't saved properly)
          isConfigured: Boolean(shouldBeConfigured)
        };
      });
      
      console.log('🔍 Fixed nodes:', fixedNodes.map(n => ({ id: n.id, type: n.type, isConfigured: n.isConfigured })));
      // Filter out opensearch nodes from canvas — they're controlled by the checkbox now
      const osNode = fixedNodes.find(n => n.type === 'opensearch');
      if (osNode) {
        setOpensearchEnabled(true);
        setOpensearchIndexName((osNode.config as any)?.indexName || 'health-messages');
      }
      setNodes(fixedNodes.filter(n => n.type !== 'opensearch'));
      setConnections(workflow.connections || []);
      setHasUnsavedChanges(false);
      
      // Mark initial load as complete after a brief delay to allow state updates
      setTimeout(() => {
        setIsInitialLoad(false);
        console.log('🔍 Initial load complete, now tracking changes');
      }, 100);
      
      // Load last deployment status if workflow has been deployed
      if (workflow.isDeployed && workflow.lastDeploymentId) {
        loadLastDeploymentStatus(workflow.lastDeploymentId);
      }
    }
  }, [workflow]);

  // Mark as having unsaved changes when nodes or connections change
  // But don't mark as unsaved during initial load or when fixing loaded data
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  
  useEffect(() => {
    if (workflow && !isInitialLoad && !isSavingRefRef.current && (nodes.length > 0 || connections.length > 0)) {
      setHasUnsavedChanges(true);
      console.log('🔍 Marking as unsaved changes due to nodes/connections change', {
        isInitialLoad,
        isSavingRef: isSavingRefRef.current,
        nodeCount: nodes.length,
        connectionCount: connections.length
      });
    }
  }, [nodes, connections, workflow, isInitialLoad]);



  // Drop handler for adding new nodes from sidebar and moving existing nodes
  const [{ isOver }, drop] = useDrop({
    accept: ['node-type', 'workflow-node'],
    drop: (item: any, monitor) => {
      const offset = monitor.getClientOffset();
      if (offset && canvasRef.current) {
        const canvasRect = canvasRef.current.getBoundingClientRect();
        const x = offset.x - canvasRect.left + canvasRef.current.scrollLeft;
        const y = offset.y - canvasRect.top + canvasRef.current.scrollTop;
        
        if (item.type === 'workflow-node') {
          // Moving existing node
          onMove(item.id, x - 100, y - 40); // Center the node on cursor
        } else {
          // Adding new node from sidebar
          addNode(item.type as WorkflowNode['type'], Math.max(50, x), Math.max(50, y));
        }
      }
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
    }),
  });

  const onMove = useCallback((nodeId: string, x: number, y: number) => {
    updateNodePosition(nodeId, Math.max(0, x), Math.max(0, y));
  }, []);

  const addNode = useCallback((type: WorkflowNode['type'], x: number, y: number) => {
    const newNode: WorkflowNode = {
      id: `${type}-${Date.now()}`,
      type,
      name: getDefaultNodeName(type),
      position: { x, y },
      isConfigured: type === 'start' || type === 'end',
    };
    
    setNodes(prev => [...prev, newNode]);
  }, []);

  const getDefaultNodeName = (type: WorkflowNode['type']): string => {
    switch (type) {
      case 'start': return 'Start';
      case 'end': return 'End';
      case 's3': return 'S3 Operation';
      case 'database': return 'Database Query';
      case 'lambda': return 'Lambda Function';
      default: return 'Node';
    }
  };

  const updateNodePosition = useCallback((nodeId: string, x: number, y: number) => {
    setNodes(prev => prev.map(node => 
      node.id === nodeId ? { ...node, position: { x: Math.max(0, x), y: Math.max(0, y) } } : node
    ));
  }, []);

  const deleteNode = useCallback((nodeId: string) => {
    setNodes(prev => prev.filter(node => node.id !== nodeId));
    setConnections(prev => prev.filter(conn => 
      conn.sourceNodeId !== nodeId && conn.targetNodeId !== nodeId
    ));
    if (selectedNode === nodeId) {
      setSelectedNode(null);
    }
  }, [selectedNode]);

  const handleNodeSelect = useCallback((nodeId: string) => {
    setSelectedNode(nodeId);
    // Open config modal for configurable nodes
    const node = nodes.find(n => n.id === nodeId);
    if (node && ['s3', 'database', 'lambda', 'opensearch'].includes(node.type)) {
      setConfigModalOpen(true);
    }
  }, [nodes]);

  const handleConfigSave = useCallback((nodeId: string, config: any) => {
    setNodes(prev => prev.map(node => 
      node.id === nodeId 
        ? { ...node, config, isConfigured: true }
        : node
    ));
    setConfigModalOpen(false);
  }, []);

  const startConnection = useCallback((sourceNodeId: string, sourceHandle: string) => {
    console.log('🔗 Starting connection from:', sourceNodeId, sourceHandle);
    setIsConnecting({ sourceNodeId, sourceHandle, mousePosition: { x: 0, y: 0 } });
  }, []);

  const updateConnectionMouse = useCallback((e: React.MouseEvent) => {
    if (isConnecting && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const mousePosition = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
      setIsConnecting(prev => prev ? { ...prev, mousePosition } : null);
    }
  }, [isConnecting]);

  const completeConnection = useCallback((targetNodeId: string, targetHandle: string) => {
    console.log('🔗 Completing connection to:', targetNodeId, targetHandle);
    console.log('🔗 Current connecting state:', isConnecting);
    console.log('🔗 Current connections before update:', connections);
    
    if (isConnecting && isConnecting.sourceNodeId !== targetNodeId) {
      const newConnection: Connection = {
        id: `conn-${Date.now()}`,
        sourceNodeId: isConnecting.sourceNodeId,
        targetNodeId,
        sourceHandle: isConnecting.sourceHandle,
        targetHandle,
      };
      
      console.log('🔗 Creating new connection:', newConnection);
      
      // SIMPLE DIRECT UPDATE - no functional update for now
      const updatedConnections = [...connections, newConnection];
      console.log('🔗 About to set connections to:', updatedConnections);
      setConnections(updatedConnections);
      
      // Verify the state was set
      setTimeout(() => {
        console.log('🔗 Connections state after timeout:', connections);
      }, 100);
      
      console.log('✅ Connection created successfully!');
    } else {
      console.log('❌ Cannot complete connection - invalid state or same node');
      console.log('   - isConnecting:', isConnecting);
      console.log('   - sourceNodeId !== targetNodeId:', isConnecting?.sourceNodeId !== targetNodeId);
    }
    
    setIsConnecting(null);
  }, [isConnecting, connections]);

  const deleteConnection = useCallback((connectionId: string) => {
    setConnections(prev => prev.filter(conn => conn.id !== connectionId));
  }, []);

  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      setSelectedNode(null);
      setIsConnecting(null);
    }
  }, []);

  const handleWorkflowNameChange = useCallback((name: string) => {
    setWorkflowName(name);
    setHasUnsavedChanges(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (isSaving || !workflow) return;
    
    try {
      setIsSaving(true);
      // setIsSavingRef(true); // Removed unused function
      isSavingRefRef.current = true;
      
      const saveNodes = opensearchEnabled ? [...nodes, buildOpensearchNode()] : nodes;

      await saveWorkflow({
        name: workflowName,
        nodes: saveNodes,
        connections,
      });
      
      setHasUnsavedChanges(false);
      console.log('✅ Workflow saved successfully - hasUnsavedChanges set to false');
    } catch (error) {
      console.error('Failed to save workflow:', error);
      alert('Failed to save workflow. Please try again.');
    } finally {
      setIsSaving(false);
      // Use a longer delay to ensure state updates are complete
      setTimeout(() => {
        // setIsSavingRef(false); // Removed unused function
        isSavingRefRef.current = false;
        console.log('🔍 isSavingRef set to false - change detection resumed');
      }, 1000); // Increased to 1 second
    }
  }, [workflowName, nodes, connections, isSaving, workflow, saveWorkflow]);

  const handleDeployWithVpc = useCallback(async (vpcConfig: VpcConfig) => {
    if (isDeploying || !workflow) return;

    try {
      setIsDeploying(true);

      const currentWorkflow = {
        ...workflow,
        name: workflowName,
        nodes: opensearchEnabled ? [...nodes, buildOpensearchNode()] : nodes,
        connections,
      };

      // Start deployment
      const deploymentResponse = await DeploymentService.deployWorkflow({
        workflowId: workflow.id,
        workflowData: currentWorkflow,
        environment: 'development',
        configuration: {
          enableLogging: true,
          enableXRay: false,
          tags: {
            DeployedFrom: 'WorkflowBuilder',
            Environment: 'development',
          },
          vpcConfig,
        },
      });

      setCurrentDeploymentId(deploymentResponse.deploymentId);
      setDeploymentModalOpen(true);
      
    } catch (error) {
      console.error('Failed to deploy workflow:', error);
      alert('Failed to start deployment. Please try again.');
    } finally {
      setIsDeploying(false);
    }
  }, [workflowName, nodes, connections, isDeploying, workflow]);

  const handleDeploy = useCallback(async () => {
    if (isDeploying || !workflow) return;
    
    // First save the workflow if there are unsaved changes
    if (hasUnsavedChanges) {
      try {
        setIsSaving(true);
        const deploySaveNodes = opensearchEnabled ? [...nodes, buildOpensearchNode()] : nodes;
        await saveWorkflow({
          name: workflowName,
          nodes: deploySaveNodes,
          connections,
        });
        setHasUnsavedChanges(false);
      } finally {
        setIsSaving(false);
      }
    }

    // Validate workflow for deployment
    const currentWorkflow = {
      ...workflow,
      name: workflowName,
      nodes,
      connections,
    };

    const validation = DeploymentService.validateWorkflowForDeployment(currentWorkflow);
    if (!validation.isValid) {
      alert(`Workflow validation failed:\n\n${validation.errors.join('\n')}`);
      return;
    }

    // Deploy immediately with no VPC
    handleDeployWithVpc({ mode: 'none' });
  }, [workflowName, nodes, connections, isDeploying, workflow, saveWorkflow, hasUnsavedChanges, handleDeployWithVpc]);

  const loadLastDeploymentStatus = useCallback(async (deploymentId: string) => {
    try {
      const status = await DeploymentService.getDeploymentStatus(deploymentId);
      if (status) {
        setLastDeploymentStatus(status);
      }
    } catch (error) {
      console.error('Failed to load deployment status:', error);
    }
  }, []);

  const handleDeploymentComplete = useCallback(async (status: DeploymentStatus) => {
    setLastDeploymentStatus(status);
    
    if (status.status === 'completed' && workflow) {
      // Update workflow with deployment info
      await saveWorkflow({
        isDeployed: true,
        deploymentStatus: 'deployed',
        lastDeploymentId: status.deploymentId,
        stepFunctionArn: status.stepFunctionArn,
      });
      
      // Clear unsaved changes since deployment was successful
      setHasUnsavedChanges(false);
      
      // Show success message and navigate back to workflow list after a brief delay
      setTimeout(() => {
        setDeploymentModalOpen(false);
        setCurrentDeploymentId(null);
        navigate('/');
      }, 2000); // Give user 2 seconds to see the success message
    }
  }, [workflow, saveWorkflow, navigate]);

  const handleAutoLayout = useCallback(() => {
    if (nodes.length < 2) return;

    try {
      // Add visual feedback during layout
      const canvasElement = canvasRef.current;
      if (canvasElement) {
        canvasElement.classList.add('auto-layouting');
        setTimeout(() => {
          canvasElement.classList.remove('auto-layouting');
        }, 600);
      }

      // Calculate optimal layout while preserving all node data
      const layoutedNodes = autoLayoutWorkflow(nodes, connections, {
        startX: 100,
        startY: 150,
        horizontalSpacing: 150,
        verticalSpacing: 120,
      });

      // Update node positions with smooth animation
      setNodes(layoutedNodes);
      setHasUnsavedChanges(true);

      console.log('✨ Auto-layout applied successfully!', {
        totalNodes: layoutedNodes.length,
        connections: connections.length,
      });
    } catch (error) {
      console.error('Failed to apply auto-layout:', error);
      alert('Failed to auto-arrange nodes. Please try again.');
    }
  }, [nodes, connections]);

  const handleBack = () => {
    if (hasUnsavedChanges) {
      const shouldLeave = confirm('You have unsaved changes. Are you sure you want to leave?');
      if (!shouldLeave) return;
    }
    navigate('/dashboard');
  };

  // Enhanced workflow validation for deployment
  const validateWorkflowForDeployment = () => {
    // Must have at least one node
    if (nodes.length === 0) return { isValid: false, reason: 'No nodes in workflow' };
    
    // All nodes must be configured
    if (!nodes.every(node => node.isConfigured)) {
      return { isValid: false, reason: 'All nodes must be configured' };
    }
    
    // Must have at least one start node
    const startNodes = nodes.filter(node => node.type === 'start');
    if (startNodes.length === 0) {
      return { isValid: false, reason: 'Workflow must have a start node' };
    }
    
    // Must have at least one end node
    const endNodes = nodes.filter(node => node.type === 'end');
    if (endNodes.length === 0) {
      return { isValid: false, reason: 'Workflow must have an end node' };
    }
    
    // If there are multiple nodes, there must be connections
    if (nodes.length > 1 && connections.length === 0) {
      return { isValid: false, reason: 'Nodes must be connected' };
    }
    
    // Validate that all non-start nodes have incoming connections
    // Removed unused nodeIds variable
    const nodesWithIncoming = new Set(connections.map(c => c.targetNodeId));
    const startNodeIds = new Set(startNodes.map(n => n.id));
    
    for (const node of nodes) {
      if (!startNodeIds.has(node.id) && !nodesWithIncoming.has(node.id)) {
        return { isValid: false, reason: `Node "${node.name}" has no incoming connections` };
      }
    }
    
    // Validate that all non-end nodes have outgoing connections
    const nodesWithOutgoing = new Set(connections.map(c => c.sourceNodeId));
    const endNodeIds = new Set(endNodes.map(n => n.id));
    
    for (const node of nodes) {
      if (!endNodeIds.has(node.id) && !nodesWithOutgoing.has(node.id)) {
        return { isValid: false, reason: `Node "${node.name}" has no outgoing connections` };
      }
    }
    
    return { isValid: true, reason: 'Workflow is valid for deployment' };
  };

  const workflowValidation = validateWorkflowForDeployment();
  const canDeploy = workflowValidation.isValid;
  const deployButtonDisabled = !canDeploy || isDeploying || hasUnsavedChanges;
  
  // Debug logging for deploy button state and connection state
  console.log('🔍 Deploy button state:', {
    nodeCount: nodes.length,
    allNodesConfigured: nodes.every(node => node.isConfigured),
    nodeConfigStatus: nodes.map(n => ({ id: n.id, type: n.type, isConfigured: n.isConfigured })),
    workflowValidation,
    canDeploy,
    isDeploying,
    hasUnsavedChanges,
    deployButtonDisabled,
    connectionCount: connections.length
  });

  if (loading) {
    return (
      <div className="workflow-editor">
        <div className="loading-state">
          <div className="loading-spinner"></div>
          <p>Loading workflow...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="workflow-editor">
        <div className="error-state">
          <h3>Error Loading Workflow</h3>
          <p>{error}</p>
          <button onClick={() => navigate('/dashboard')} className="back-btn">
            ← Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="workflow-editor">
      <div className="workflow-toolbar">
        <div className="toolbar-left">
          <button onClick={handleBack} className="back-btn">
            ← Back to Dashboard
          </button>
          <div className="workflow-info">
            <input
              type="text"
              value={workflowName}
              onChange={(e) => handleWorkflowNameChange(e.target.value)}
              className="workflow-name-input"
              placeholder="Workflow name"
            />
            {workflowId && <span className="workflow-id">ID: {workflowId}</span>}
            {hasUnsavedChanges && <span className="unsaved-indicator">• Unsaved changes</span>}
          </div>
        </div>
        <div className="toolbar-right">
          <button 
            onClick={handleAutoLayout}
            className="toolbar-btn auto-layout-btn"
            disabled={nodes.length < 2}
            title="Auto-arrange nodes in a clean layout"
          >
            🎯 Auto Layout
          </button>
          <button 
            onClick={handleSave}
            className={`toolbar-btn save-btn ${hasUnsavedChanges ? 'has-changes' : ''}`}
            disabled={isSaving}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
          <div className="opensearch-toggle">
            <label className="opensearch-checkbox" title="Enable OpenSearch indexing for this workflow">
              <input
                type="checkbox"
                checked={opensearchEnabled}
                onChange={(e) => setOpensearchEnabled(e.target.checked)}
              />
              🔍 OpenSearch
            </label>
            {opensearchEnabled && (
              <input
                type="text"
                className="opensearch-index-input"
                value={opensearchIndexName}
                onChange={(e) => setOpensearchIndexName(e.target.value)}
                placeholder="Index name"
                title="OpenSearch index name"
              />
            )}
          </div>
          <button 
            onClick={handleDeploy}
            className="toolbar-btn deploy-btn"
            disabled={deployButtonDisabled}
            title={
              hasUnsavedChanges 
                ? 'Save your changes before deploying' 
                : !workflowValidation.isValid
                ? workflowValidation.reason
                : 'Deploy to AWS Step Functions'
            }
          >
            {isDeploying ? 'Starting Deployment...' : 'Deploy to AWS'}
          </button>
          
          {/* Deployment Status Indicator */}
          {lastDeploymentStatus && (
            <button 
              onClick={() => {
                setCurrentDeploymentId(lastDeploymentStatus.deploymentId);
                setDeploymentModalOpen(true);
              }}
              className={`toolbar-btn deployment-status-btn ${lastDeploymentStatus.status}`}
              title={`Last deployment: ${lastDeploymentStatus.status.toUpperCase()}`}
            >
              <span className="status-icon">
                {lastDeploymentStatus.status === 'completed' ? '✅' : 
                 lastDeploymentStatus.status === 'failed' ? '❌' : 
                 (lastDeploymentStatus.status as any) === 'delete_failed' ? '🚫' : 
                 lastDeploymentStatus.status === 'in_progress' ? '⏳' : '⏸️'}
              </span>
              <span className="status-text">
                {lastDeploymentStatus.status === 'completed' ? 'Deployed' : 
                 lastDeploymentStatus.status === 'failed' ? 'Failed' : 
                 (lastDeploymentStatus.status as any) === 'delete_failed' ? 'Delete Failed' : 
                 lastDeploymentStatus.status === 'in_progress' ? 'Deploying' : 'Pending'}
              </span>
            </button>
          )}
        </div>
      </div>

      <div className="workflow-editor-content">
        <NodeSidebar />
        
        <div 
          ref={(node) => {
            (canvasRef as any).current = node;
            drop(node);
          }}
          className={`workflow-canvas ${isOver ? 'drag-over' : ''} ${isConnecting ? 'connecting' : ''}`}
          onClick={handleCanvasClick}
          onMouseMove={updateConnectionMouse}
        >
          <div className="canvas-container">
            {/* Render connections using dedicated component */}
            <ConnectionsRenderer
              key={`connections-${connections.length}-${nodes.length}`}
              connections={connections}
              nodes={nodes}
              onDeleteConnection={deleteConnection}
              isConnecting={isConnecting}
            />

            {/* Render nodes */}
            {nodes.map(node => (
              <NodeComponent
                key={node.id}
                node={node}
                isSelected={selectedNode === node.id}
                isConnecting={isConnecting?.sourceNodeId === node.id}
                onSelect={() => handleNodeSelect(node.id)}
                onMove={updateNodePosition}
                onDelete={() => deleteNode(node.id)}
                onStartConnection={startConnection}
                onCompleteConnection={completeConnection}
              />
            ))}

            {/* Drop zone indicator */}
            {isOver && (
              <div className="drop-indicator">
                Drop here to add node
              </div>
            )}

            {/* Empty state */}
            {nodes.length === 0 && !isOver && (
              <div className="empty-canvas">
                <div className="empty-canvas-content">
                  <h3>Start Building Your Workflow</h3>
                  <p>Drag components from the sidebar to create your AWS Step Functions workflow</p>
                  <div className="empty-canvas-tips">
                    <div className="tip">
                      <span className="tip-icon">1️⃣</span>
                      <span>Start with a "Start" node</span>
                    </div>
                    <div className="tip">
                      <span className="tip-icon">2️⃣</span>
                      <span>Add processing nodes (S3, Database, Lambda)</span>
                    </div>
                    <div className="tip">
                      <span className="tip-icon">3️⃣</span>
                      <span>Connect nodes: Click output handle (right) → input handle (left)</span>
                    </div>
                    <div className="tip">
                      <span className="tip-icon">4️⃣</span>
                      <span>Configure each node, then deploy!</span>
                    </div>
                  </div>
                </div>
              </div>
            )}




          </div>
        </div>

        {/* Node configuration panel - moved to right side */}
        {selectedNode && (
        <div 
          className="node-config-panel"
          data-node-type={nodes.find(n => n.id === selectedNode)?.type || ''}
        >
          <div className="panel-header">
            <h3>
              <span className="node-type-icon">
                {(() => {
                  const nodeType = nodes.find(n => n.id === selectedNode)?.type;
                  switch (nodeType) {
                    case 'start': return '▶️';
                    case 's3': return '🪣';
                    case 'database': return '🗄️';
                    case 'lambda': return '⚡';
                    case 'end': return '⏹️';
                    default: return '📦';
                  }
                })()}
              </span>
              Node Details
            </h3>
            <button 
              className="panel-minimize-btn"
              onClick={() => {
                const panel = document.querySelector('.node-config-panel');
                panel?.classList.toggle('minimized');
              }}
              title="Minimize panel"
            >
              ➖
            </button>
          </div>
          <div className="config-node-info">
            <p><strong>Node ID:</strong> {selectedNode}</p>
            <p><strong>Type:</strong> {nodes.find(n => n.id === selectedNode)?.type}</p>
            <p><strong>Name:</strong> {nodes.find(n => n.id === selectedNode)?.name}</p>
            <p><strong>Status:</strong> {nodes.find(n => n.id === selectedNode)?.isConfigured ? 'Configured' : 'Needs Configuration'}</p>
          </div>
          
          {['s3', 'database', 'lambda'].includes(nodes.find(n => n.id === selectedNode)?.type || '') && (
            <button 
              onClick={() => setConfigModalOpen(true)}
              className="config-demo-btn"
            >
              Configure Node
            </button>
          )}
          
          {nodes.find(n => n.id === selectedNode)?.config && (
            <div className="config-summary">
              <div className="config-summary-header">
                <h4>Current Configuration:</h4>
                <button 
                  className="config-toggle-btn"
                  onClick={() => {
                    const summary = document.querySelector('.config-summary');
                    summary?.classList.toggle('expanded');
                  }}
                >
                  {/* Toggle icon will be handled by CSS */}
                  📋
                </button>
              </div>
              <div className="config-content">
                <div className="config-preview">
                  {(() => {
                    const config = nodes.find(n => n.id === selectedNode)?.config;
                    const configKeys = config ? Object.keys(config) : [];
                    const nodeType = nodes.find(n => n.id === selectedNode)?.type;
                    
                    if (nodeType === 'lambda' && config?.code) {
                      const lineCount = config.code.split('\n').length;
                      const charCount = config.code.length;
                      return `Lambda Function: ${lineCount} lines, ${charCount} characters`;
                    } else if (configKeys.length > 0) {
                      return `${configKeys.length} configuration${configKeys.length > 1 ? 's' : ''}: ${configKeys.join(', ')}`;
                    }
                    return 'No configuration';
                  })()}
                </div>
                <pre className="config-json">{JSON.stringify(nodes.find(n => n.id === selectedNode)?.config, null, 2)}</pre>
              </div>
            </div>
          )}
        </div>
        )}
      </div>
      
      {/* Configuration Modal */}
      {selectedNode && configModalOpen && (
        <NodeConfigModal
          node={nodes.find(n => n.id === selectedNode)!}
          isOpen={configModalOpen}
          onClose={() => setConfigModalOpen(false)}
          onSave={handleConfigSave}
        />
      )}

      {/* Deployment Status Modal */}
      {deploymentModalOpen && currentDeploymentId && (
        <DeploymentStatusModal
          isOpen={deploymentModalOpen}
          deploymentId={currentDeploymentId}
          workflowName={workflowName}
          onClose={() => {
            setDeploymentModalOpen(false);
            setCurrentDeploymentId(null);
          }}
          onComplete={handleDeploymentComplete}
        />
      )}
    </div>
  );
};

// Main component that provides the DndProvider context
const WorkflowCanvas: React.FC = () => {
  return (
    <DndProvider backend={HTML5Backend}>
      <WorkflowCanvasContent />
    </DndProvider>
  );
};

export default WorkflowCanvas;
