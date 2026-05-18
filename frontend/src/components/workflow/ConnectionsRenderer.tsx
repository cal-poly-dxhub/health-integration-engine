import React, { useEffect } from 'react';
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

const ConnectionsRenderer: React.FC<ConnectionsRendererProps> = ({
  connections,
  nodes,
  onDeleteConnection,
  isConnecting,
}) => {
  // Re-render on every animation frame for instant arrow updates
  const [, forceUpdate] = React.useReducer(x => x + 1, 0);
  
  useEffect(() => {
    let rafId: number;
    const update = () => {
      forceUpdate();
      rafId = requestAnimationFrame(update);
    };
    rafId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(rafId);
  }, []);

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

    // Calculate handle center position relative to canvas, accounting for scroll
    const handleCenterX = handleRect.left + handleRect.width / 2 - canvasRect.left + canvasElement.scrollLeft;
    const handleCenterY = handleRect.top + handleRect.height / 2 - canvasRect.top + canvasElement.scrollTop;

    return { x: handleCenterX, y: handleCenterY };
  };

  // Create curved path between two points
  const createCurvedPath = (x1: number, y1: number, x2: number, y2: number): string => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Control point offset based on distance
    const controlOffset = Math.min(distance * 0.5, 150);
    
    // Bezier curve control points
    const cx1 = x1 + controlOffset;
    const cy1 = y1;
    const cx2 = x2 - controlOffset;
    const cy2 = y2;
    
    return `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
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
        zIndex: 1,
        overflow: 'visible'
      }}
    >
      {/* Define arrowhead markers */}
      <defs>
        <marker
          id="arrowhead"
          markerWidth="8"
          markerHeight="8"
          refX="7"
          refY="4"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path
            d="M 0 0 L 8 4 L 0 8 z"
            fill="#3b82f6"
          />
        </marker>
        <marker
          id="arrowhead-hover"
          markerWidth="8"
          markerHeight="8"
          refX="7"
          refY="4"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path
            d="M 0 0 L 8 4 L 0 8 z"
            fill="#ef4444"
          />
        </marker>
        <marker
          id="arrowhead-temp"
          markerWidth="8"
          markerHeight="8"
          refX="7"
          refY="4"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path
            d="M 0 0 L 8 4 L 0 8 z"
            fill="#10b981"
          />
        </marker>
      </defs>

      {/* Render temporary connection line while dragging */}
      {isConnecting && isConnecting.mousePosition && (() => {
        const sourceNode = nodes.find(n => n.id === isConnecting.sourceNodeId);
        if (!sourceNode) return null;

        const sourceHandlePos = getNodeHandlePosition(sourceNode.id, 'output');
        if (!sourceHandlePos) return null;

        const sourceX = sourceHandlePos.x;
        const sourceY = sourceHandlePos.y;
        const targetX = isConnecting.mousePosition.x;
        const targetY = isConnecting.mousePosition.y;

        const pathData = createCurvedPath(sourceX, sourceY, targetX, targetY);

        return (
          <path
            d={pathData}
            stroke="#10b981"
            strokeWidth="3"
            fill="none"
            strokeDasharray="8,4"
            opacity="0.8"
            markerEnd="url(#arrowhead-temp)"
            style={{
              filter: 'drop-shadow(0 2px 4px rgba(16, 185, 129, 0.3))'
            }}
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

        if (!sourceHandlePos || !targetHandlePos) {
          return null;
        }

        const sourceX = sourceHandlePos.x;
        const sourceY = sourceHandlePos.y;
        const targetX = targetHandlePos.x;
        const targetY = targetHandlePos.y;

        const pathData = createCurvedPath(sourceX, sourceY, targetX, targetY);

        return (
          <g key={connection.id} className="connection-group">
            {/* Invisible thick path for easier clicking */}
            <path
              d={pathData}
              stroke="transparent"
              strokeWidth="20"
              fill="none"
              style={{
                pointerEvents: 'all',
                cursor: 'pointer'
              }}
              onClick={(e) => {
                e.stopPropagation();
                onDeleteConnection(connection.id);
              }}
            />

            {/* Visible connection path */}
            <path
              d={pathData}
              stroke="#3b82f6"
              strokeWidth="3"
              fill="none"
              markerEnd="url(#arrowhead)"
              className="connection-path-svg"
              style={{
                transition: 'all 0.2s ease-in-out',
                filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.2))',
                pointerEvents: 'none'
              }}
            />
          </g>
        );
      })}
    </svg>
  );
};

export default ConnectionsRenderer;