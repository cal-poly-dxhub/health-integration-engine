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
  onMove,
  onDelete,
  onStartConnection,
  onCompleteConnection,
}) => {
  const nodeRef = useRef<HTMLDivElement>(null);

  const [{ isDragging }, drag] = useDrag({
    type: 'workflow-node',
    item: { id: node.id, type: 'workflow-node' },
    canDrag: (monitor) => {
      // Don't allow drag if the initial click was on a handle
      const initialOffset = monitor.getInitialClientOffset();
      if (initialOffset) {
        const element = document.elementFromPoint(initialOffset.x, initialOffset.y);
        const isHandle = element?.closest('.node-handle');
        console.log('🔍 Drag check - clicked element:', element?.className, 'isHandle:', !!isHandle);
        return !isHandle;
      }
      return true;
    },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
    end: (_item, monitor) => {
      const delta = monitor.getDifferenceFromInitialOffset();
      if (delta && Math.abs(delta.x) > 5 && Math.abs(delta.y) > 5) {
        // Only move if there was significant drag movement
        onMove(node.id, node.position.x + delta.x, node.position.y + delta.y);
      }
    },
  });

  const getNodeIcon = (type: WorkflowNode['type']) => {
    switch (type) {
      case 'start':
        return '▶️';
      case 'end':
        return '⏹️';
      case 's3':
        return '🪣';
      case 'database':
        return '🗄️';
      case 'lambda':
        return '⚡';
      default:
        return '📦';
    }
  };

  const getNodeColor = (type: WorkflowNode['type']) => {
    switch (type) {
      case 'start':
        return '#10b981'; // green
      case 'end':
        return '#ef4444'; // red
      case 's3':
        return '#f59e0b'; // amber
      case 'database':
        return '#8b5cf6'; // violet
      case 'lambda':
        return '#3b82f6'; // blue
      default:
        return '#6b7280'; // gray
    }
  };

  const handleOutputClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('🔗 Output handle clicked for node:', node.id);
    onStartConnection(node.id, 'output');
  };

  const handleInputClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('🔗 Input handle clicked for node:', node.id);
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

  drag(nodeRef);

  return (
    <div
      ref={nodeRef}
      className={`workflow-node ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${!node.isConfigured ? 'unconfigured' : ''} ${isConnecting ? 'connecting' : ''}`}
      style={{
        left: node.position.x,
        top: node.position.y,
        borderColor: getNodeColor(node.type),
      }}
      onClick={handleNodeClick}
      data-type={node.type}
      data-node-id={node.id}
    >
      {/* Input handle */}
      {node.type !== 'start' && (
        <div 
          className="node-handle input-handle"
          onClick={handleInputClick}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('🔍 Input handle mousedown');
          }}
          onDragStart={(e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('🔍 Input handle drag prevented');
          }}
          title="Click to connect input"
          style={{ pointerEvents: 'all', zIndex: 20 }}
        >
          <div 
            className="handle-dot" 
            style={{ 
              background: getNodeColor(node.type),
              pointerEvents: 'none'
            }}
          />
        </div>
      )}

      {/* Node content */}
      <div className="node-header">
        <div className="node-icon" style={{ color: getNodeColor(node.type) }}>
          {getNodeIcon(node.type)}
        </div>
        <div className="node-title">
          <span className="node-name">{node.name}</span>
          <span className="node-type">{node.type}</span>
        </div>
        {isSelected && (
          <button 
            className="node-delete-btn"
            onClick={handleDeleteClick}
            title="Delete node"
          >
            ×
          </button>
        )}
      </div>

      {/* Configuration status */}
      <div className="node-status">
        {node.isConfigured ? (
          <span className="status-configured">✓ Configured</span>
        ) : (
          <span className="status-unconfigured">⚠ Needs Configuration</span>
        )}
      </div>

      {/* Output handle */}
      {node.type !== 'end' && (
        <div 
          className="node-handle output-handle"
          onClick={handleOutputClick}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('🔍 Output handle mousedown');
          }}
          onDragStart={(e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('🔍 Output handle drag prevented');
          }}
          title="Click to start connection"
          style={{ pointerEvents: 'all', zIndex: 20 }}
        >
          <div 
            className="handle-dot" 
            style={{ 
              background: getNodeColor(node.type),
              pointerEvents: 'none'
            }}
          />
        </div>
      )}

      {/* Connection indicator */}
      {isConnecting && (
        <div className="connection-indicator">
          Click another node to connect
        </div>
      )}
    </div>
  );
};

export default NodeComponent;