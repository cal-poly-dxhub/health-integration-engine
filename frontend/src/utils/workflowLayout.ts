import { WorkflowNode, Connection } from '../types/workflow';

interface LayoutNode extends WorkflowNode {
  level: number;
  children: string[];
  parents: string[];
}

interface LayoutOptions {
  nodeWidth: number;
  nodeHeight: number;
  horizontalSpacing: number;
  verticalSpacing: number;
  startX: number;
  startY: number;
}

const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
  nodeWidth: 200,
  nodeHeight: 80,
  horizontalSpacing: 100,
  verticalSpacing: 120,
  startX: 100,
  startY: 100,
};

/**
 * Auto-layout algorithm that arranges nodes in a hierarchical flow
 * Preserves all connections and node configurations
 */
export class WorkflowLayoutEngine {
  private nodes: LayoutNode[] = [];
  private connections: Connection[] = [];
  private options: LayoutOptions;

  constructor(nodes: WorkflowNode[], connections: Connection[], options?: Partial<LayoutOptions>) {
    this.connections = connections;
    this.options = { ...DEFAULT_LAYOUT_OPTIONS, ...options };
    this.initializeNodes(nodes);
  }

  private initializeNodes(nodes: WorkflowNode[]) {
    // Convert nodes to layout nodes with relationship info
    this.nodes = nodes.map(node => ({
      ...node,
      level: 0,
      children: [],
      parents: [],
    }));

    // Build parent-child relationships from connections
    this.connections.forEach(connection => {
      const sourceNode = this.nodes.find(n => n.id === connection.sourceNodeId);
      const targetNode = this.nodes.find(n => n.id === connection.targetNodeId);

      if (sourceNode && targetNode) {
        sourceNode.children.push(targetNode.id);
        targetNode.parents.push(sourceNode.id);
      }
    });
  }

  /**
   * Calculate hierarchical levels for each node
   */
  private calculateLevels() {
    // Find root nodes (nodes with no parents, typically 'start' nodes)
    const rootNodes = this.nodes.filter(node => node.parents.length === 0);
    
    if (rootNodes.length === 0) {
      // If no clear root, use the first node
      if (this.nodes.length > 0) {
        this.nodes[0].level = 0;
        this.calculateLevelsFromNode(this.nodes[0].id, 0);
      }
      return;
    }

    // Set root nodes to level 0 and calculate from there
    rootNodes.forEach(rootNode => {
      rootNode.level = 0;
      this.calculateLevelsFromNode(rootNode.id, 0);
    });
  }

  private calculateLevelsFromNode(nodeId: string, currentLevel: number) {
    const node = this.nodes.find(n => n.id === nodeId);
    if (!node) return;

    // Update level if this path gives a higher level
    node.level = Math.max(node.level, currentLevel);

    // Recursively calculate levels for children
    node.children.forEach(childId => {
      const childNode = this.nodes.find(n => n.id === childId);
      if (childNode) {
        // Avoid infinite loops by checking if we're making progress
        if (childNode.level <= currentLevel) {
          this.calculateLevelsFromNode(childId, currentLevel + 1);
        }
      }
    });
  }

  /**
   * Arrange nodes within each level to minimize connection crossings
   */
  private arrangeNodesInLevels() {
    const levelGroups = new Map<number, LayoutNode[]>();
    
    // Group nodes by level
    this.nodes.forEach(node => {
      if (!levelGroups.has(node.level)) {
        levelGroups.set(node.level, []);
      }
      levelGroups.get(node.level)!.push(node);
    });

    // Sort nodes within each level to minimize crossings
    levelGroups.forEach((nodesInLevel, level) => {
      if (level === 0) {
        // For root level, sort by node type priority (start first)
        nodesInLevel.sort((a, b) => {
          const typePriority: Record<string, number> = {
            start: 0,
            s3: 1,
            lambda: 2,
            database: 3,
            opensearch: 4,
            end: 5,
          };
          return (typePriority[a.type] ?? 6) - (typePriority[b.type] ?? 6);
        });
      } else {
        // For other levels, try to minimize connection crossings
        // Sort by the average position of parent nodes
        nodesInLevel.sort((a, b) => {
          const aParentAvg = this.getAverageParentPosition(a);
          const bParentAvg = this.getAverageParentPosition(b);
          return aParentAvg - bParentAvg;
        });
      }
    });

    return levelGroups;
  }

  private getAverageParentPosition(node: LayoutNode): number {
    if (node.parents.length === 0) return 0;

    const parentPositions = node.parents
      .map(parentId => this.nodes.find(n => n.id === parentId))
      .filter(parent => parent !== undefined)
      .map(parent => parent!.position.y);

    return parentPositions.reduce((sum, pos) => sum + pos, 0) / parentPositions.length;
  }

  /**
   * Calculate final positions for all nodes
   */
  private calculatePositions(): WorkflowNode[] {
    this.calculateLevels();
    const levelGroups = this.arrangeNodesInLevels();

    const updatedNodes: WorkflowNode[] = [];

    levelGroups.forEach((nodesInLevel, level) => {
      const levelX = this.options.startX + (level * (this.options.nodeWidth + this.options.horizontalSpacing));
      
      // Calculate total height needed for this level
      const totalHeight = (nodesInLevel.length - 1) * (this.options.nodeHeight + this.options.verticalSpacing);
      const startY = this.options.startY - (totalHeight / 2);

      nodesInLevel.forEach((node, index) => {
        const nodeY = startY + (index * (this.options.nodeHeight + this.options.verticalSpacing));
        
        updatedNodes.push({
          ...node,
          position: {
            x: levelX,
            y: Math.max(this.options.startY, nodeY), // Ensure minimum Y position
          },
        });
      });
    });

    return updatedNodes;
  }

  /**
   * Main method to perform auto-layout
   */
  public autoLayout(): WorkflowNode[] {
    if (this.nodes.length === 0) return [];

    return this.calculatePositions();
  }

  /**
   * Get layout statistics for debugging
   */
  public getLayoutStats() {
    this.calculateLevels();
    const levelCounts = new Map<number, number>();
    
    this.nodes.forEach(node => {
      levelCounts.set(node.level, (levelCounts.get(node.level) || 0) + 1);
    });

    return {
      totalNodes: this.nodes.length,
      totalConnections: this.connections.length,
      levels: Array.from(levelCounts.entries()).map(([level, count]) => ({ level, count })),
      maxLevel: Math.max(...Array.from(levelCounts.keys())),
    };
  }
}

/**
 * Convenience function to auto-layout a workflow
 */
export function autoLayoutWorkflow(
  nodes: WorkflowNode[], 
  connections: Connection[], 
  options?: Partial<LayoutOptions>
): WorkflowNode[] {
  const layoutEngine = new WorkflowLayoutEngine(nodes, connections, options);
  return layoutEngine.autoLayout();
}