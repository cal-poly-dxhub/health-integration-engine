import { NodeHandlerRegistry, NodeHandler } from './index';

/**
 * End node handler
 */
export const endHandler: NodeHandler = (node) => ({
  Type: 'Pass',
  Comment: 'Workflow end',
  End: true,
});

// Auto-register the handler
NodeHandlerRegistry.register('end', endHandler);