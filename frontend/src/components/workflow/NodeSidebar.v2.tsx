import React from 'react';
import { useDrag } from 'react-dnd';
import './NodeSidebar.v2.css';

interface DraggableNodeProps {
  type: string;
  label: string;
  description: string;
  color: string;
  icon: React.ReactNode;
}

const DraggableNode: React.FC<DraggableNodeProps> = ({
  type,
  label,
  description,
  color,
  icon,
}) => {
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
      className={`nsb-v2-card${isDragging ? ' nsb-v2-card--dragging' : ''}`}
      style={{ ['--accent' as any]: color }}
    >
      <span className="nsb-v2-card-icon" aria-hidden="true">
        {icon}
      </span>
      <div className="nsb-v2-card-body">
        <p className="nsb-v2-card-label">{label}</p>
        <p className="nsb-v2-card-desc">{description}</p>
      </div>
    </div>
  );
};

const NodeSidebar: React.FC = () => {
  const nodeTypes: Array<{
    type: string;
    label: string;
    description: string;
    color: string;
    icon: React.ReactNode;
  }> = [
    {
      type: 'start',
      label: 'Start',
      description: 'Workflow entry point',
      color: '#10b981',
      icon: <PlayIcon />,
    },
    {
      type: 's3',
      label: 'S3 Operation',
      description: 'Read/write files in S3',
      color: '#f59e0b',
      icon: <BucketIcon />,
    },
    {
      type: 'database',
      label: 'Database',
      description: 'Query a database',
      color: '#8b5cf6',
      icon: <DatabaseIcon />,
    },
    {
      type: 'lambda',
      label: 'Lambda Function',
      description: 'Execute custom code',
      color: '#3b82f6',
      icon: <BoltIcon />,
    },
    {
      type: 'end',
      label: 'End',
      description: 'Workflow completion',
      color: '#ef4444',
      icon: <StopIcon />,
    },
  ];

  return (
    <aside className="nsb-v2-root">
      <div className="nsb-v2-head">
        <h3 className="nsb-v2-title">Components</h3>
        <p className="nsb-v2-sub">Drag onto the canvas to add a node.</p>
      </div>

      <div className="nsb-v2-section">
        <div className="nsb-v2-section-label">Workflow nodes</div>
        <div className="nsb-v2-list">
          {nodeTypes.map((nt) => (
            <DraggableNode
              key={nt.type}
              type={nt.type}
              label={nt.label}
              description={nt.description}
              color={nt.color}
              icon={nt.icon}
            />
          ))}
        </div>
      </div>

      <div className="nsb-v2-help">
        <div className="nsb-v2-help-title">How to use</div>
        <ul>
          <li>Drag components onto the canvas.</li>
          <li>Click a node to select and configure it.</li>
          <li>Click the right (output) handle, then a left (input) handle to connect nodes.</li>
          <li>Configure all nodes before deploying.</li>
        </ul>
      </div>
    </aside>
  );
};

export default NodeSidebar;

/* ---------- Inline icons ---------- */

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
