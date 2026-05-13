import React, { useCallback, useEffect, useRef, useState } from 'react';
import { DndProvider, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { useNavigate, useParams } from 'react-router-dom';
import { Connection, WorkflowNode } from '../../types/workflow';
import { useWorkflow } from '../../hooks/useWorkflows';
import {
  DeploymentService,
  DeploymentStatus,
} from '../../services/deploymentReal';
import { autoLayoutWorkflow } from '../../utils/workflowLayout';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import NodeComponent from './NodeComponent';
import NodeSidebar from './NodeSidebar';
import NodeConfigModal from './NodeConfigModal';
import DeploymentStatusModal from './DeploymentStatusModal';
import ConnectionsRenderer from './ConnectionsRenderer';
import './WorkflowCanvas.css';

const CONFIGURABLE_TYPES = ['s3', 'database', 'lambda', 'opensearch'];

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

  const [isSaving, setIsSaving] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const isSavingRefRef = useRef(false);
  const [deploymentModalOpen, setDeploymentModalOpen] = useState(false);
  const [currentDeploymentId, setCurrentDeploymentId] = useState<string | null>(
    null
  );
  const [lastDeploymentStatus, setLastDeploymentStatus] =
    useState<DeploymentStatus | null>(null);

  const [opensearchEnabled, setOpensearchEnabled] = useState(false);
  const [opensearchIndexName, setOpensearchIndexName] =
    useState('health-messages');
  const [savedOpensearchEnabled, setSavedOpensearchEnabled] = useState(false);
  const [savedOpensearchIndexName, setSavedOpensearchIndexName] =
    useState('health-messages');
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  const canvasRef = useRef<HTMLDivElement>(null);

  useDocumentTitle(workflowName || 'Workflow editor');

  const buildOpensearchNode = useCallback(
    (): WorkflowNode => ({
      id: 'opensearch-auto',
      type: 'opensearch',
      name: 'OpenSearch Indexing',
      position: { x: 0, y: 0 },
      config: {
        type: 'opensearch' as const,
        operation: 'index' as const,
        indexName: opensearchIndexName,
        collectionEndpoint: '',
      },
      isConfigured: true,
    }),
    [opensearchIndexName]
  );

  // Load workflow data when workflow is loaded
  useEffect(() => {
    if (!workflow) return;

    setWorkflowName(workflow.name);

    const fixedNodes = (workflow.nodes || []).map((node) => {
      const wasConfigured = node.isConfigured;
      const isStartEnd = node.type === 'start' || node.type === 'end';
      const hasConfig = node.config && Object.keys(node.config).length > 0;
      const shouldBeConfigured = wasConfigured || isStartEnd || hasConfig;
      return {
        ...node,
        isConfigured: Boolean(shouldBeConfigured),
      };
    });

    const osNode = fixedNodes.find((n) => n.type === 'opensearch');
    if (osNode) {
      setOpensearchEnabled(true);
      setSavedOpensearchEnabled(true);
      const indexName = (osNode.config as any)?.indexName || 'health-messages';
      setOpensearchIndexName(indexName);
      setSavedOpensearchIndexName(indexName);
    } else {
      setOpensearchEnabled(false);
      setSavedOpensearchEnabled(false);
      setOpensearchIndexName('health-messages');
      setSavedOpensearchIndexName('health-messages');
    }

    setNodes(fixedNodes.filter((n) => n.type !== 'opensearch'));
    setConnections(workflow.connections || []);
    setHasUnsavedChanges(false);

    setTimeout(() => setIsInitialLoad(false), 100);

    if (workflow.isDeployed && workflow.lastDeploymentId) {
      loadLastDeploymentStatus(workflow.lastDeploymentId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow]);

  // Mark unsaved changes when nodes/connections change
  useEffect(() => {
    if (
      workflow &&
      !isInitialLoad &&
      !isSavingRefRef.current &&
      (nodes.length > 0 || connections.length > 0)
    ) {
      setHasUnsavedChanges(true);
    }
  }, [nodes, connections, workflow, isInitialLoad]);

  // Mark unsaved changes when OpenSearch settings differ from saved state
  useEffect(() => {
    if (workflow && !isInitialLoad) {
      if (
        opensearchEnabled !== savedOpensearchEnabled ||
        opensearchIndexName !== savedOpensearchIndexName
      ) {
        setHasUnsavedChanges(true);
      }
    }
  }, [
    opensearchEnabled,
    opensearchIndexName,
    savedOpensearchEnabled,
    savedOpensearchIndexName,
    workflow,
    isInitialLoad,
  ]);

  /* ---------- Drag & drop ---------- */

  const [{ isOver }, drop] = useDrop({
    accept: ['node-type', 'workflow-node'],
    drop: (item: any, monitor) => {
      const offset = monitor.getClientOffset();
      if (offset && canvasRef.current) {
        const canvasRect = canvasRef.current.getBoundingClientRect();
        const x = offset.x - canvasRect.left + canvasRef.current.scrollLeft;
        const y = offset.y - canvasRect.top + canvasRef.current.scrollTop;

        if (item.type === 'workflow-node') {
          updateNodePosition(
            item.id,
            Math.max(0, x - 100),
            Math.max(0, y - 40)
          );
        } else {
          addNode(
            item.type as WorkflowNode['type'],
            Math.max(50, x),
            Math.max(50, y)
          );
        }
      }
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
    }),
  });

  const addNode = useCallback(
    (type: WorkflowNode['type'], x: number, y: number) => {
      const newNode: WorkflowNode = {
        id: `${type}-${Date.now()}`,
        type,
        name: getDefaultNodeName(type),
        position: { x, y },
        isConfigured: type === 'start' || type === 'end',
      };
      setNodes((prev) => [...prev, newNode]);
    },
    []
  );

  const updateNodePosition = useCallback(
    (nodeId: string, x: number, y: number) => {
      setNodes((prev) =>
        prev.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                position: { x: Math.max(0, x), y: Math.max(0, y) },
              }
            : node
        )
      );
    },
    []
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      setNodes((prev) => prev.filter((node) => node.id !== nodeId));
      setConnections((prev) =>
        prev.filter(
          (conn) =>
            conn.sourceNodeId !== nodeId && conn.targetNodeId !== nodeId
        )
      );
      if (selectedNode === nodeId) setSelectedNode(null);
    },
    [selectedNode]
  );

  const handleNodeSelect = useCallback(
    (nodeId: string) => {
      setSelectedNode(nodeId);
      const node = nodes.find((n) => n.id === nodeId);
      if (node && CONFIGURABLE_TYPES.includes(node.type)) {
        setConfigModalOpen(true);
      }
    },
    [nodes]
  );

  const handleConfigSave = useCallback(
    (nodeId: string, config: any) => {
      setNodes((prev) =>
        prev.map((node) =>
          node.id === nodeId
            ? { ...node, config, isConfigured: true }
            : node
        )
      );
      setConfigModalOpen(false);
    },
    []
  );

  const startConnection = useCallback(
    (sourceNodeId: string, sourceHandle: string) => {
      setIsConnecting({
        sourceNodeId,
        sourceHandle,
        mousePosition: { x: 0, y: 0 },
      });
    },
    []
  );

  const updateConnectionMouse = useCallback(
    (e: React.MouseEvent) => {
      if (isConnecting && canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect();
        const mousePosition = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        };
        setIsConnecting((prev) =>
          prev ? { ...prev, mousePosition } : null
        );
      }
    },
    [isConnecting]
  );

  const completeConnection = useCallback(
    (targetNodeId: string, targetHandle: string) => {
      if (isConnecting && isConnecting.sourceNodeId !== targetNodeId) {
        const newConnection: Connection = {
          id: `conn-${Date.now()}`,
          sourceNodeId: isConnecting.sourceNodeId,
          targetNodeId,
          sourceHandle: isConnecting.sourceHandle,
          targetHandle,
        };
        setConnections([...connections, newConnection]);
      }
      setIsConnecting(null);
    },
    [isConnecting, connections]
  );

  const deleteConnection = useCallback((connectionId: string) => {
    setConnections((prev) => prev.filter((conn) => conn.id !== connectionId));
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

  /* ---------- Save / Deploy ---------- */

  const handleSave = useCallback(async () => {
    if (isSaving || !workflow) return;
    try {
      setIsSaving(true);
      isSavingRefRef.current = true;

      const saveNodes = opensearchEnabled
        ? [...nodes, buildOpensearchNode()]
        : nodes;

      await saveWorkflow({
        name: workflowName,
        nodes: saveNodes,
        connections,
      });

      setHasUnsavedChanges(false);
      setSavedOpensearchEnabled(opensearchEnabled);
      setSavedOpensearchIndexName(opensearchIndexName);
    } catch (err) {
      console.error('Failed to save workflow:', err);
      alert('Failed to save workflow. Please try again.');
    } finally {
      setIsSaving(false);
      setTimeout(() => {
        isSavingRefRef.current = false;
      }, 1000);
    }
  }, [
    workflowName,
    nodes,
    connections,
    isSaving,
    workflow,
    saveWorkflow,
    opensearchEnabled,
    opensearchIndexName,
    buildOpensearchNode,
  ]);

  const handleDeploy = useCallback(async () => {
    if (isDeploying || !workflow) return;

    const deployNodes = opensearchEnabled
      ? [...nodes, buildOpensearchNode()]
      : nodes;

    if (hasUnsavedChanges) {
      try {
        setIsSaving(true);
        await saveWorkflow({
          name: workflowName,
          nodes: deployNodes,
          connections,
        });
        setHasUnsavedChanges(false);
      } finally {
        setIsSaving(false);
      }
    }

    const currentWorkflow = {
      ...workflow,
      name: workflowName,
      nodes: deployNodes,
      connections,
    };

    const validation =
      DeploymentService.validateWorkflowForDeployment(currentWorkflow);
    if (!validation.isValid) {
      alert(`Workflow validation failed:\n\n${validation.errors.join('\n')}`);
      return;
    }

    try {
      setIsDeploying(true);
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
        },
      });

      setCurrentDeploymentId(deploymentResponse.deploymentId);
      setDeploymentModalOpen(true);
    } catch (err) {
      console.error('Failed to deploy workflow:', err);
      alert('Failed to start deployment. Please try again.');
    } finally {
      setIsDeploying(false);
    }
  }, [
    workflowName,
    nodes,
    connections,
    isDeploying,
    workflow,
    saveWorkflow,
    hasUnsavedChanges,
    opensearchEnabled,
    buildOpensearchNode,
  ]);

  const loadLastDeploymentStatus = useCallback(async (deploymentId: string) => {
    try {
      const status = await DeploymentService.getDeploymentStatus(deploymentId);
      if (status) setLastDeploymentStatus(status);
    } catch (err) {
      console.error('Failed to load deployment status:', err);
    }
  }, []);

  const handleDeploymentComplete = useCallback(
    async (status: DeploymentStatus) => {
      setLastDeploymentStatus(status);
      if (status.status === 'completed' && workflow) {
        await saveWorkflow({
          isDeployed: true,
          deploymentStatus: 'deployed',
          lastDeploymentId: status.deploymentId,
          stepFunctionArn: status.stepFunctionArn,
        });
        setHasUnsavedChanges(false);
        setTimeout(() => {
          setDeploymentModalOpen(false);
          setCurrentDeploymentId(null);
          navigate('/');
        }, 2000);
      }
    },
    [workflow, saveWorkflow, navigate]
  );

  const handleAutoLayout = useCallback(() => {
    if (nodes.length < 2) return;
    try {
      const canvasElement = canvasRef.current;
      if (canvasElement) {
        canvasElement.classList.add('auto-layouting');
        setTimeout(() => {
          canvasElement.classList.remove('auto-layouting');
        }, 600);
      }

      const layoutedNodes = autoLayoutWorkflow(nodes, connections, {
        startX: 100,
        startY: 150,
        horizontalSpacing: 150,
        verticalSpacing: 120,
      });
      setNodes(layoutedNodes);
      setHasUnsavedChanges(true);
    } catch (err) {
      console.error('Failed to apply auto-layout:', err);
      alert('Failed to auto-arrange nodes. Please try again.');
    }
  }, [nodes, connections]);

  const handleBack = () => {
    if (hasUnsavedChanges) {
      const shouldLeave = confirm(
        'You have unsaved changes. Are you sure you want to leave?'
      );
      if (!shouldLeave) return;
    }
    navigate('/dashboard');
  };

  const validateWorkflowForDeployment = () => {
    if (nodes.length === 0)
      return { isValid: false, reason: 'No nodes in workflow' };
    if (!nodes.every((node) => node.isConfigured))
      return { isValid: false, reason: 'All nodes must be configured' };
    const startNodes = nodes.filter((n) => n.type === 'start');
    if (startNodes.length === 0)
      return { isValid: false, reason: 'Workflow must have a start node' };
    const endNodes = nodes.filter((n) => n.type === 'end');
    if (endNodes.length === 0)
      return { isValid: false, reason: 'Workflow must have an end node' };
    if (nodes.length > 1 && connections.length === 0)
      return { isValid: false, reason: 'Nodes must be connected' };

    const nodesWithIncoming = new Set(connections.map((c) => c.targetNodeId));
    const startNodeIds = new Set(startNodes.map((n) => n.id));
    for (const node of nodes) {
      if (!startNodeIds.has(node.id) && !nodesWithIncoming.has(node.id)) {
        return {
          isValid: false,
          reason: `Node "${node.name}" has no incoming connections`,
        };
      }
    }

    const nodesWithOutgoing = new Set(connections.map((c) => c.sourceNodeId));
    const endNodeIds = new Set(endNodes.map((n) => n.id));
    for (const node of nodes) {
      if (!endNodeIds.has(node.id) && !nodesWithOutgoing.has(node.id)) {
        return {
          isValid: false,
          reason: `Node "${node.name}" has no outgoing connections`,
        };
      }
    }

    return { isValid: true, reason: 'Workflow is valid for deployment' };
  };

  const workflowValidation = validateWorkflowForDeployment();
  const canDeploy = workflowValidation.isValid;
  const deployButtonDisabled = !canDeploy || isDeploying || hasUnsavedChanges;

  /* ---------- Loading / error gates ---------- */

  if (loading) {
    return (
      <div className="wfc-root">
        <div className="wfc-state">
          <span className="wfc-state-spinner" aria-hidden="true" />
          <p>Loading workflow…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="wfc-root">
        <div className="wfc-state">
          <span className="wfc-state-icon" aria-hidden="true">
            <AlertIcon />
          </span>
          <h3 className="wfc-state-title">Failed to load workflow</h3>
          <div className="wfc-state-error">{error}</div>
          <button
            onClick={() => navigate('/dashboard')}
            className="wfc-btn"
          >
            Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  const selectedNodeData = nodes.find((n) => n.id === selectedNode);
  const isOpensearchEnabledFlag =
    import.meta.env.VITE_ENABLE_OPENSEARCH !== 'false';

  return (
    <div className="wfc-root">
      {/* ---------- Toolbar ---------- */}
      <div className="wfc-toolbar">
        <div className="wfc-toolbar-left">
          <button onClick={handleBack} className="wfc-back">
            <ArrowLeftIcon />
            Dashboard
          </button>
          <div className="wfc-name-wrap">
            <input
              type="text"
              value={workflowName}
              onChange={(e) => handleWorkflowNameChange(e.target.value)}
              className="wfc-name"
              placeholder="Workflow name"
            />
            <div className="wfc-name-meta">
              {workflowId && (
                <span className="wfc-id">ID: {workflowId}</span>
              )}
              {hasUnsavedChanges && (
                <span className="wfc-unsaved">Unsaved changes</span>
              )}
            </div>
          </div>
        </div>

        <div className="wfc-toolbar-right">
          <button
            type="button"
            onClick={handleAutoLayout}
            className="wfc-btn"
            disabled={nodes.length < 2}
            title="Auto-arrange nodes in a clean layout"
          >
            <LayoutIcon />
            Auto layout
          </button>

          <button
            type="button"
            onClick={handleSave}
            className={`wfc-btn${
              hasUnsavedChanges ? ' wfc-btn--has-changes' : ''
            }`}
            disabled={isSaving}
          >
            <SaveIcon />
            {isSaving ? 'Saving…' : 'Save'}
          </button>

          {isOpensearchEnabledFlag && (
            <>
              <label
                className={`wfc-os${
                  opensearchEnabled ? ' wfc-os--active' : ''
                }`}
                title="Enable OpenSearch indexing for this workflow"
              >
                <input
                  type="checkbox"
                  checked={opensearchEnabled}
                  onChange={(e) => setOpensearchEnabled(e.target.checked)}
                />
                <SearchIcon />
                <span>OpenSearch</span>
              </label>
              {opensearchEnabled && (
                <input
                  type="text"
                  className="wfc-os-input"
                  value={opensearchIndexName}
                  onChange={(e) => setOpensearchIndexName(e.target.value)}
                  placeholder="Index name"
                  title="OpenSearch index name"
                />
              )}
            </>
          )}

          <button
            type="button"
            onClick={handleDeploy}
            className="wfc-btn wfc-btn--success"
            disabled={deployButtonDisabled}
            title={
              hasUnsavedChanges
                ? 'Save your changes before deploying'
                : !workflowValidation.isValid
                ? workflowValidation.reason
                : 'Deploy to AWS Step Functions'
            }
          >
            <RocketIcon />
            {isDeploying ? 'Starting…' : 'Deploy to AWS'}
          </button>

          {lastDeploymentStatus && (
            <button
              type="button"
              onClick={() => {
                setCurrentDeploymentId(lastDeploymentStatus.deploymentId);
                setDeploymentModalOpen(true);
              }}
              className={`wfc-deploy-pill wfc-deploy-pill--${lastDeploymentStatus.status}`}
              title={`Last deployment: ${lastDeploymentStatus.status.toUpperCase()}`}
            >
              <span className="wfc-deploy-pill-dot" aria-hidden="true" />
              {deploymentLabel(lastDeploymentStatus.status)}
            </button>
          )}
        </div>
      </div>

      {/* ---------- Body ---------- */}
      <div className="wfc-body">
        <NodeSidebar />

        <div
          ref={(node) => {
            (canvasRef as any).current = node;
            drop(node);
          }}
          /* IMPORTANT: keep `.workflow-canvas` class — ConnectionsRenderer
             uses document.querySelector('.workflow-canvas') for its math. */
          className={`wfc-canvas workflow-canvas${
            isOver ? ' wfc-canvas--drag-over' : ''
          }${isConnecting ? ' wfc-canvas--connecting' : ''}`}
          onClick={handleCanvasClick}
          onMouseMove={updateConnectionMouse}
        >
          <div className="wfc-canvas-inner">
            <ConnectionsRenderer
              key={`connections-${connections.length}-${nodes.length}`}
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
                isConnecting={isConnecting?.sourceNodeId === node.id}
                onSelect={() => handleNodeSelect(node.id)}
                onMove={updateNodePosition}
                onDelete={() => deleteNode(node.id)}
                onStartConnection={startConnection}
                onCompleteConnection={completeConnection}
              />
            ))}

            {isOver && (
              <div className="wfc-drop-indicator">Drop to add node</div>
            )}

            {nodes.length === 0 && !isOver && (
              <div className="wfc-empty">
                <div className="wfc-empty-card">
                  <span className="wfc-empty-icon" aria-hidden="true">
                    <FlowIcon />
                  </span>
                  <h3 className="wfc-empty-title">
                    Start building your workflow
                  </h3>
                  <p className="wfc-empty-sub">
                    Drag components from the left sidebar to compose your
                    AWS Step Functions workflow.
                  </p>
                  <div className="wfc-empty-tips">
                    <div className="wfc-empty-tip">
                      <span className="wfc-empty-tip-num">1</span>
                      <span>Drop a Start node to define the entry point.</span>
                    </div>
                    <div className="wfc-empty-tip">
                      <span className="wfc-empty-tip-num">2</span>
                      <span>
                        Add processing nodes — S3, Database, or Lambda.
                      </span>
                    </div>
                    <div className="wfc-empty-tip">
                      <span className="wfc-empty-tip-num">3</span>
                      <span>
                        Click an output handle then an input handle to connect.
                      </span>
                    </div>
                    <div className="wfc-empty-tip">
                      <span className="wfc-empty-tip-num">4</span>
                      <span>Configure each node, then deploy.</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right config panel */}
        {selectedNodeData && (
          <aside className="wfc-config-panel">
            <div className="wfc-config-head">
              <h3 className="wfc-config-title">
                <span
                  className="wfc-config-icon"
                  style={{
                    background: getNodeColor(selectedNodeData.type),
                  }}
                  aria-hidden="true"
                >
                  {getNodeIcon(selectedNodeData.type)}
                </span>
                Node details
              </h3>
              <button
                type="button"
                className="wfc-config-close"
                onClick={() => setSelectedNode(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="wfc-config-body">
              <div className="wfc-config-info">
                <div className="wfc-config-row">
                  <span className="wfc-config-row-label">ID</span>
                  <span className="wfc-config-row-value wfc-config-row-value--mono">
                    {selectedNodeData.id}
                  </span>
                </div>
                <div className="wfc-config-row">
                  <span className="wfc-config-row-label">Type</span>
                  <span className="wfc-config-row-value">
                    {selectedNodeData.type}
                  </span>
                </div>
                <div className="wfc-config-row">
                  <span className="wfc-config-row-label">Name</span>
                  <span className="wfc-config-row-value">
                    {selectedNodeData.name}
                  </span>
                </div>
                <div className="wfc-config-row">
                  <span className="wfc-config-row-label">Status</span>
                  <span className="wfc-config-row-value">
                    {selectedNodeData.isConfigured ? (
                      <span className="wfc-status-pill wfc-status-pill--ok">
                        Configured
                      </span>
                    ) : (
                      <span className="wfc-status-pill wfc-status-pill--warn">
                        Needs configuration
                      </span>
                    )}
                  </span>
                </div>
              </div>

              {['s3', 'database', 'lambda'].includes(
                selectedNodeData.type
              ) && (
                <div className="wfc-config-action">
                  <button
                    type="button"
                    onClick={() => setConfigModalOpen(true)}
                    className="wfc-btn wfc-btn--primary"
                    style={{ width: '100%' }}
                  >
                    <CogIcon />
                    Configure node
                  </button>
                </div>
              )}

              {selectedNodeData.config && (
                <div className="wfc-config-summary">
                  <h4 className="wfc-config-summary-title">
                    Current configuration
                  </h4>
                  <p className="wfc-config-summary-text">
                    {summarizeConfig(selectedNodeData)}
                  </p>
                  <pre className="wfc-config-pre">
                    {JSON.stringify(selectedNodeData.config, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* ---------- Modals ---------- */}
      {selectedNode && configModalOpen && selectedNodeData && (
        <NodeConfigModal
          node={selectedNodeData}
          isOpen={configModalOpen}
          onClose={() => setConfigModalOpen(false)}
          onSave={handleConfigSave}
        />
      )}

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

const WorkflowCanvas: React.FC = () => {
  return (
    <DndProvider backend={HTML5Backend}>
      <WorkflowCanvasContent />
    </DndProvider>
  );
};

export default WorkflowCanvas;

/* ============================================================
 * Helpers
 * ========================================================== */

function getDefaultNodeName(type: WorkflowNode['type']): string {
  switch (type) {
    case 'start':
      return 'Start';
    case 'end':
      return 'End';
    case 's3':
      return 'S3 Operation';
    case 'database':
      return 'Database Query';
    case 'lambda':
      return 'Lambda Function';
    default:
      return 'Node';
  }
}

function getNodeColor(type: WorkflowNode['type']): string {
  switch (type) {
    case 'start':
      return '#10b981';
    case 'end':
      return '#ef4444';
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
    case 'start':
      return <PlayIcon />;
    case 'end':
      return <StopIcon />;
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

function summarizeConfig(node: WorkflowNode): string {
  const config: any = node.config;
  if (!config) return 'No configuration';
  if (node.type === 'lambda' && config.code) {
    const lineCount = config.code.split('\n').length;
    const charCount = config.code.length;
    return `Lambda function: ${lineCount} lines, ${charCount} characters`;
  }
  const keys = Object.keys(config);
  if (keys.length === 0) return 'No configuration';
  return `${keys.length} configuration${
    keys.length > 1 ? 's' : ''
  }: ${keys.join(', ')}`;
}

function deploymentLabel(status: string): string {
  if (status === 'completed') return 'Deployed';
  if (status === 'failed') return 'Failed';
  if ((status as any) === 'delete_failed') return 'Delete failed';
  if (status === 'in_progress') return 'Deploying';
  return 'Pending';
}

/* ---------- Inline icons ---------- */

function ArrowLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}

function LayoutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function RocketIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09Z" />
      <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2Z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
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

function CogIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.1a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.1a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.1a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.1a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

function FlowIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="6" height="6" rx="1.5" />
      <rect x="15" y="3" width="6" height="6" rx="1.5" />
      <rect x="9" y="15" width="6" height="6" rx="1.5" />
      <path d="M6 9v3a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V9" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <polygon points="6 4 20 12 6 20" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
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

function BoxIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3" />
    </svg>
  );
}
