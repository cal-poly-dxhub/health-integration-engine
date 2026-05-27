import React from 'react';
import { useDrag } from 'react-dnd';
import './NodeSidebar.css';

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
      className={`nsb-card${isDragging ? ' nsb-card--dragging' : ''}`}
      style={{ ['--accent' as any]: color }}
    >
      <span className="nsb-card-icon" aria-hidden="true">
        {icon}
      </span>
      <div className="nsb-card-body">
        <p className="nsb-card-label">{label}</p>
        <p className="nsb-card-desc">{description}</p>
      </div>
    </div>
  );
};

interface NodeSidebarProps {
  onHide?: () => void;
}

const NodeSidebar: React.FC<NodeSidebarProps> = ({ onHide }) => {
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
    <aside className="nsb-root">
      <div className="nsb-head">
        <div className="nsb-head-row">
          <h3 className="nsb-title">Components</h3>
          {onHide && (
            <button
              type="button"
              className="nsb-hide"
              onClick={onHide}
              aria-label="Hide components panel"
              title="Hide components"
            >
              <ChevronLeftIcon />
            </button>
          )}
        </div>
        <p className="nsb-sub">Drag onto the canvas to add a node.</p>
      </div>

      <div className="nsb-section">
        <div className="nsb-section-label">Workflow nodes</div>
        <div className="nsb-list">
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

      <div className="nsb-help">
        <div className="nsb-help-title">How to use</div>
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

function BoltIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <path d="M13 2 4 14h7l-2 8 9-12h-7Z" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}
