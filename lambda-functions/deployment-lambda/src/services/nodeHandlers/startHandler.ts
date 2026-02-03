import { NodeHandlerRegistry, NodeHandler } from './index';

/**
 * Start node handler
 */
export const startHandler: NodeHandler = (node, nextState) => ({
  Type: 'Pass',
  Comment: 'Workflow start',
  Next: nextState || 'End',
});

// Auto-register the handler
NodeHandlerRegistry.register('start', startHandler);