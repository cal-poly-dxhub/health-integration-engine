import React from 'react';
import { useDrag } from 'react-dnd';
import './NodeSidebar.css';

interface DraggableNodeProps {
  type: string;
  icon: string;
  label: string;
  description: string;
  color: string;
}

const DraggableNode: React.FC<DraggableNodeProps> = ({ type, icon, label, description, color }) => {
  const [{ isDragging }, drag] = useDrag({
    type: 'node-type',
    item: { type },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  return (
    <div
      ref={drag}
      className={`draggable-node ${isDragging ? 'dragging' : ''}`}
      style={{ borderLeftColor: color }}
    >
      <div className="node-preview">
        <span className="node-preview-icon" style={{ color }}>
          {icon}
        </span>
        <div className="node-preview-content">
          <span className="node-preview-label">{label}</span>
          <span className="node-preview-description">{description}</span>
        </div>
      </div>
    </div>
  );
};

const NodeSidebar: React.FC = () => {
  const nodeTypes = [
    {
      type: 'start',
      icon: '▶️',
      label: 'Start',
      description: 'Workflow entry point',
      color: '#10b981',
    },
    {
      type: 's3',
      icon: '🪣',
      label: 'S3 Operation',
      description: 'Read/write files from S3',
      color: '#f59e0b',
    },
    {
      type: 'database',
      icon: '🗄️',
      label: 'Database',
      description: 'Query database operations',
      color: '#8b5cf6',
    },
    {
      type: 'lambda',
      icon: '⚡',
      label: 'Lambda Function',
      description: 'Execute custom code',
      color: '#3b82f6',
    },
    {
      type: 'end',
      icon: '⏹️',
      label: 'End',
      description: 'Workflow completion',
      color: '#ef4444',
    },
  ];

  return (
    <div className="node-sidebar">
      <div className="sidebar-header">
        <h3>Components</h3>
        <p>Drag components to the canvas</p>
      </div>
      
      <div className="sidebar-content">
        <div className="node-category">
          <h4>Workflow Nodes</h4>
          <div className="node-list">
            {nodeTypes.map((nodeType) => (
              <DraggableNode
                key={nodeType.type}
                type={nodeType.type}
                icon={nodeType.icon}
                label={nodeType.label}
                description={nodeType.description}
                color={nodeType.color}
              />
            ))}
          </div>
        </div>

        <div className="sidebar-help">
          <h4>How to use:</h4>
          <ul>
            <li>Drag nodes from here to the canvas</li>
            <li>Click nodes to select and configure them</li>
            <li>Click the output handle (right side) to start connecting</li>
            <li>Click the input handle (left side) to complete connection</li>
            <li>Configure all nodes before deploying</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default NodeSidebar;