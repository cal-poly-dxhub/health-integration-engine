import { NodeHandlerRegistry, NodeHandler } from './index';

/**
 * Start node handler
 * Preserves the original event input (e.g. EventBridge S3 trigger event)
 * into $.originalEvent so downstream states can reference it.
 */
export const startHandler: NodeHandler = (node, nextState) => ({
  Type: 'Pass',
  Comment: 'Workflow start',
  Parameters: {
    'originalEvent.$': '$',
  },
  Next: nextState || 'End',
});

// Auto-register the handler
NodeHandlerRegistry.register('start', startHandler);
