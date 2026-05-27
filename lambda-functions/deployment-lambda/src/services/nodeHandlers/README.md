# Node Handlers

This directory contains handlers for different workflow node types. The system uses a registry pattern to make it easy to add new node types without modifying core code.

## How to Add a New Node Type

Adding a new node type is simple and requires only 3 steps:

### 1. Create the Handler File

Create a new file `{nodeType}Handler.ts` in this directory:

```typescript
import { NodeHandlerRegistry, NodeHandler } from './index';

/**
 * Your new node handler
 */
export const myNewNodeHandler: NodeHandler = (node, nextState, workflow) => ({
  Type: 'Task', // or 'Pass', 'Wait', 'Choice', etc.
  Resource: 'arn:aws:states:::service:action',
  Comment: `My new node: ${node.name}`,
  Parameters: {
    // Your node-specific parameters based on node.config
    SomeParam: node.config?.someParam || 'default-value',
  },
  Next: nextState || 'End',
  Retry: [
    {
      ErrorEquals: ['States.TaskFailed'],
      IntervalSeconds: 2,
      MaxAttempts: 3,
      BackoffRate: 2,
    },
  ],
});

// Auto-register the handler
NodeHandlerRegistry.register('myNewNode', myNewNodeHandler);
```

### 2. Export from Index

Add your handler to `index.ts`:

```typescript
export * from './myNewNodeHandler';
import './myNewNodeHandler'; // Auto-registers the handler
```

### 3. Update Workflow Types

Add your new node type to the workflow types in `lambda-functions/workflow-lambda/src/types/workflow.ts`:

```typescript
export interface WorkflowNode {
  id: string;
  type: 'start' | 's3' | 'database' | 'lambda' | 'end' | 'myNewNode'; // Add here
  // ... rest of interface
}
```

That's it! The system will automatically:
- Use your handler when generating CloudFormation templates
- Include your node type in validation
- Support your node in the deployment process

## Available Node Types

Currently supported node types:

- **start**: Workflow entry point (Pass state)
- **end**: Workflow exit point (Pass state with End: true)
- **lambda**: AWS Lambda function invocation
- **database**: Database operations (DynamoDB, RDS Data API)
- **s3**: S3 operations (get, put, list, delete)

## Example Node Types (Ready to Enable)

The following handlers are already created but not enabled:

- **wait**: Wait for a specified duration
- Add more as needed...

To enable them, just:
1. Add the node type to workflow types
2. Uncomment the registration line in the handler file

## Handler Interface

All handlers must implement the `NodeHandler` interface:

```typescript
interface NodeHandler {
  (node: any, nextState: string | null, workflow: Workflow): any;
}
```

Parameters:
- `node`: The workflow node with config and metadata
- `nextState`: The name of the next state (or null if this is the last)
- `workflow`: The complete workflow (for complex handlers that need context)

Returns: A Step Functions ASL state definition object

## Best Practices

1. **Error Handling**: Always include appropriate Retry and Catch blocks
2. **Default Values**: Provide sensible defaults for all configuration options
3. **Comments**: Include descriptive comments in the generated states
4. **Validation**: Validate node configuration and provide helpful error messages
5. **Documentation**: Document your handler's configuration options

## Testing

Each handler should be unit tested. Create test files in the `__tests__` directory:

```typescript
import { myNewNodeHandler } from '../myNewNodeHandler';

describe('myNewNodeHandler', () => {
  it('should generate correct state definition', () => {
    const node = {
      id: 'test-1',
      type: 'myNewNode',
      name: 'Test Node',
      config: { someParam: 'test-value' }
    };
    
    const result = myNewNodeHandler(node, 'NextState', mockWorkflow);
    
    expect(result.Type).toBe('Task');
    expect(result.Parameters.SomeParam).toBe('test-value');
    expect(result.Next).toBe('NextState');
  });
});
```

This architecture makes the system highly extensible while keeping the core deployment logic clean and maintainable.