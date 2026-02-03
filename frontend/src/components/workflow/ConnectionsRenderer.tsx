import React from 'react';
import { WorkflowNode, Connection } from '../../types/workflow';

interface ConnectionsRendererProps {
  connections: Connection[];
  nodes: WorkflowNode[];
  onDeleteConnection: (connectionId: string) => void;
  isConnecting?: {
    sourceNodeId: string;
    sourceHandle: string;
    mousePosition?: { x: number; y: number };
  } | null;
}

const ConnectionsRenderer: React.FC<ConnectionsRendererProps> = React.memo(({
  connections,
  nodes,
  onDeleteConnection,
  isConnecting,
}) => {
  // Helper function to get actual node handle positions from DOM
  const getNodeHandlePosition = (nodeId: string, handleType: 'input' | 'output') => {
    const nodeElement = document.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement;
    const handleElement = nodeElement?.querySelector(`.${handleType}-handle`) as HTMLElement;

    if (!nodeElement || !handleElement) {
      return null;
    }

    const handleRect = handleElement.getBoundingClientRect();
    const canvasElement = document.querySelector('.workflow-canvas') as HTMLElement;
    const canvasRect = canvasElement?.getBoundingClientRect();

    if (!canvasRect) {
      return null;
    }

    // Calculate handle center position relative to canvas
    const handleCenterX = handleRect.left + handleRect.width / 2 - canvasRect.left;
    const handleCenterY = handleRect.top + handleRect.height / 2 - canvasRect.top;

    return { x: handleCenterX, y: handleCenterY };
  };


  return (
    <svg
      className="connections-svg"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 1
      }}
    >
      {/* Define arrowhead marker */}
      <defs>
        <marker
          id="arrowhead"
          markerWidth="10"
          markerHeight="7"
          refX="9"
          refY="3.5"
          orient="auto"
        >
          <polygon
            points="0 0, 10 3.5, 0 7"
            fill="#3b82f6"
          />
        </marker>
        <marker
          id="arrowhead-hover"
          markerWidth="10"
          markerHeight="7"
          refX="9"
          refY="3.5"
          orient="auto"
        >
          <polygon
            points="0 0, 10 3.5, 0 7"
            fill="#2563eb"
          />
        </marker>
      </defs>

      {/* Render temporary connection line while dragging */}
      {isConnecting && isConnecting.mousePosition && (() => {
        const sourceNode = nodes.find(n => n.id === isConnecting.sourceNodeId);
        if (!sourceNode) return null;

        const sourceHandlePos = getNodeHandlePosition(sourceNode.id, 'output');
        const sourceX = sourceHandlePos?.x ?? (sourceNode.position.x + 200 + 12);
        const sourceY = sourceHandlePos?.y ?? (sourceNode.position.y + 40);
        const targetX = isConnecting.mousePosition.x;
        const targetY = isConnecting.mousePosition.y;

        return (
          <line
            x1={sourceX}
            y1={sourceY}
            x2={targetX}
            y2={targetY}
            stroke="#10b981"
            strokeWidth="3"
            strokeDasharray="5,5"
            opacity="0.7"
          />
        );
      })()}

      {/* Render permanent connections */}
      {connections.map(connection => {
        const sourceNode = nodes.find(n => n.id === connection.sourceNodeId);
        const targetNode = nodes.find(n => n.id === connection.targetNodeId);

        if (!sourceNode || !targetNode) {
          return null;
        }

        // Get actual handle positions from DOM
        const sourceHandlePos = getNodeHandlePosition(sourceNode.id, 'output');
        const targetHandlePos = getNodeHandlePosition(targetNode.id, 'input');

        // Fallback to calculated positions if DOM lookup fails
        const sourceX = sourceHandlePos?.x ?? (sourceNode.position.x + 200 + 12);
        const sourceY = sourceHandlePos?.y ?? (sourceNode.position.y + 40);
        const targetX = targetHandlePos?.x ?? (targetNode.position.x - 12);
        const targetY = targetHandlePos?.y ?? (targetNode.position.y + 40);

        return (
          <g key={connection.id}>
            {/* Invisible thick line for easier clicking */}
            <line
              x1={sourceX}
              y1={sourceY}
              x2={targetX}
              y2={targetY}
              stroke="transparent"
              strokeWidth="12"
              style={{
                pointerEvents: 'all',
                cursor: 'pointer'
              }}
              onClick={(e) => {
                e.stopPropagation();
                onDeleteConnection(connection.id);
              }}
            />

            {/* Visible connection line */}
            <line
              x1={sourceX}
              y1={sourceY}
              x2={targetX}
              y2={targetY}
              stroke="#3b82f6"
              strokeWidth="3"
              markerEnd="url(#arrowhead)"
              style={{
                transition: 'all 0.2s ease-in-out',
                filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.2))'
              }}
              className="connection-line-svg"
            />
          </g>
        );
      })}
    </svg>
  );
});

export default ConnectionsRenderer;