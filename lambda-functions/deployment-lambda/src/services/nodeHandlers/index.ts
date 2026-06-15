import { Workflow } from '../../types/workflow';

import { DeploymentContext } from '../../types/deployment';

/**
 * Node handler interface - all node handlers must implement this
 */
export interface NodeHandler {
  (node: any, nextState: string | null, workflow: Workflow, deploymentContext?: DeploymentContext): any;
}

/**
 * Node handler registry - makes it easy to add new node types
 */
export class NodeHandlerRegistry {
  private static handlers: Map<string, NodeHandler> = new Map();

  /**
   * Register a new node handler
   */
  static register(nodeType: string, handler: NodeHandler): void {
    this.handlers.set(nodeType, handler);
  }

  /**
   * Get handler for a node type
   */
  static getHandler(nodeType: string): NodeHandler {
    return this.handlers.get(nodeType) || this.getDefaultHandler();
  }

  /**
   * Get all registered node types
   */
  static getRegisteredTypes(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Default handler for unknown node types
   */
  private static getDefaultHandler(): NodeHandler {
    return (node: any, nextState: string | null, workflow, deploymentContext) => ({
      Type: 'Pass',
      Comment: `Unknown node type: ${node.type}`,
      Next: nextState || 'End',
    });
  }
}

/**
 * Export individual handlers for easy testing and reuse
 */
export * from './startHandler';
export * from './endHandler';
export * from './lambdaHandler';
export * from './s3Handler';
export * from './opensearchHandler';

// Auto-register all handlers
import './startHandler';
import './endHandler';
import './lambdaHandler';
import './s3Handler';
import './opensearchHandler';