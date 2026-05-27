import React, { useRef } from 'react';
import { useDrag } from 'react-dnd';
import { WorkflowNode } from '../../types/workflow';
import './NodeComponent.css';

interface NodeComponentProps {
  node: WorkflowNode;
  isSelected: boolean;
  isConnecting: boolean;
  onSelect: () => void;
  onMove: (nodeId: string, x: number, y: number) => void;
  onDelete: () => void;
  onStartConnection: (nodeId: string, handle: string) => void;
  onCompleteConnection: (nodeId: string, handle: string) => void;
}

const NodeComponent: React.FC<NodeComponentProps> = ({
  node,
  isSelected,
  isConnecting,
  onSelect,
  onMove: _onMove,
  onDelete,
  onStartConnection,
  onCompleteConnection,
}) => {
  const nodeRef = useRef<HTMLDivElement>(null);

  const [{ isDragging }, drag] = useDrag({
    type: 'workflow-node',
    item: {
      id: node.id,
      type: 'workflow-node',
      initialX: node.position.x,
      initialY: node.position.y,
    },
    canDrag: (monitor) => {
      const initialOffset = monitor.getInitialClientOffset();
      if (initialOffset) {
        const element = document.elementFromPoint(
          initialOffset.x,
          initialOffset.y
        );
        const isHandle = element?.closest('.node-handle');
        return !isHandle;
      }
      return true;
    },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  drag(nodeRef);

  const color = getNodeColor(node.type);

  const handleOutputClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onStartConnection(node.id, 'output');
  };

  const handleInputClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onCompleteConnection(node.id, 'input');
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onDelete();
  };

  const handleNodeClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onSelect();
  };

  const classes = [
    'nc-node',
    isSelected && 'nc-node--selected',
    isDragging && 'nc-node--dragging',
    !node.isConfigured && 'nc-node--unconfigured',
    isConnecting && 'nc-node--connecting',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={nodeRef}
      className={classes}
      style={{
        left: node.position.x,
        top: node.position.y,
        ['--nc-color' as any]: color,
      }}
      onClick={handleNodeClick}
      data-type={node.type}
      data-node-id={node.id}
    >
      {/* Input handle (kept .input-handle / .node-handle class names) */}
      {node.type !== 'start' && (
        <div
          className="node-handle input-handle"
          onClick={handleInputClick}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDragStart={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          title="Click to complete connection"
        >
          <span className="nc-handle-dot" />
        </div>
      )}

      <div className="nc-header">
        <span className="nc-icon" aria-hidden="true">
          {getNodeIcon(node.type)}
        </span>
        <div className="nc-title">
          <span className="nc-name">{node.name}</span>
          <span className="nc-type">{node.type}</span>
        </div>
        {isSelected && (
          <button
            type="button"
            className="nc-delete"
            onClick={handleDeleteClick}
            title="Delete node"
            aria-label="Delete node"
          >
            ×
          </button>
        )}
      </div>

      <div
        className={`nc-status ${
          node.isConfigured ? 'nc-status--ok' : 'nc-status--warn'
        }`}
      >
        {node.isConfigured ? 'Configured' : 'Needs configuration'}
      </div>

      {/* Output handle (kept .output-handle / .node-handle class names) */}
      {node.type !== 'end' && (
        <div
          className="node-handle output-handle"
          onClick={handleOutputClick}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDragStart={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          title="Click to start a connection"
        >
          <span className="nc-handle-dot" />
        </div>
      )}

      {isConnecting && (
        <div className="nc-connecting-tip">
          Click another node's input to connect
        </div>
      )}
    </div>
  );
};

export default NodeComponent;

function getNodeIcon(type: WorkflowNode['type']): React.ReactNode {
  switch (type) {
    case 'start':
      return <PlayIcon />;
    case 'end':
      return <StopIcon />;
    case 's3':
      return <BucketIcon />;
    case 'lambda':
      return <BoltIcon />;
    case 'opensearch':
      return <SearchIcon />;
    default:
      return <BoxIcon />;
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
    case 'lambda':
      return '#3b82f6';
    case 'opensearch':
      return '#ec4899';
    default:
      return '#6b7280';
  }
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
