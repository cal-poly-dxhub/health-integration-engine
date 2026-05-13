import { NodeHandlerRegistry, NodeHandler } from './index';

/**
 * Wait node handler - demonstrates how easy it is to add new node types
 * 
 * To add this node type to the system:
 * 1. Create this handler file
 * 2. Import it in the nodeHandlers/index.ts
 * 3. Add 'wait' to the workflow node types
 * 4. That's it! The system will automatically use this handler
 */
export const waitHandler: NodeHandler = (node, nextState) => ({
  Type: 'Wait',
  Comment: `Wait: ${node.name}`,
  Seconds: parseInt(node.config?.seconds || '5'),
  Next: nextState || 'End',
});

// Auto-register the handler
// Uncomment this line when 'wait' is added to the workflow node types
// NodeHandlerRegistry.register('wait', waitHandler);