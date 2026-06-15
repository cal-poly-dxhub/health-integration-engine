import { computeWorkflowDiff, isEmptyDiff } from '../utils/workflowDiff';
import { Workflow } from '../types/workflow';

function wf(partial: Partial<Workflow>): Workflow {
  return {
    id: 'w1',
    name: 'Test',
    teamId: 't1',
    nodes: [],
    connections: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    version: 1,
    ...partial,
  } as Workflow;
}

const lambdaNode = (overrides: any = {}) => ({
  id: 'n1',
  type: 'lambda' as const,
  name: 'Parser',
  position: { x: 0, y: 0 },
  isConfigured: true,
  config: {
    type: 'lambda',
    runtime: 'nodejs20.x',
    handler: 'index.handler',
    timeout: 30,
    memorySize: 128,
    code: { source: 'inline', content: 'line1\nline2\nline3' },
  },
  ...overrides,
});

describe('computeWorkflowDiff', () => {
  it('reports created with node count and added nodes when there is no prior version', () => {
    const next = wf({ nodes: [lambdaNode(), { ...lambdaNode(), id: 'n2', name: 'Sink' }] as any });
    const diff = computeWorkflowDiff(null, next);
    expect(diff.createdNodeCount).toBe(2);
    expect(diff.nodesAdded).toHaveLength(2);
    expect(isEmptyDiff(diff)).toBe(false);
  });

  it('detects scalar config changes with from/to values and friendly labels', () => {
    const prev = wf({ nodes: [lambdaNode()] as any });
    const next = wf({
      nodes: [lambdaNode({ config: { ...lambdaNode().config, timeout: 60, memorySize: 256 } })] as any,
    });
    const diff = computeWorkflowDiff(prev, next);
    expect(diff.nodesModified).toHaveLength(1);
    const fields = diff.nodesModified![0].fields;
    const timeout = fields.find((f) => f.key === 'timeout');
    expect(timeout).toMatchObject({ label: 'Timeout (seconds)', from: '30', to: '60', kind: 'value' });
    const mem = fields.find((f) => f.key === 'memorySize');
    expect(mem).toMatchObject({ label: 'Memory (MB)', from: '128', to: '256' });
  });

  it('treats lambda code as a code change: line delta + stored old/new, no from/to', () => {
    const prev = wf({ nodes: [lambdaNode()] as any });
    const next = wf({
      nodes: [lambdaNode({ config: { ...lambdaNode().config, code: { source: 'inline', content: 'line1\nlineX\nline3\nline4' } } })] as any,
    });
    const diff = computeWorkflowDiff(prev, next);
    const codeChange = diff.nodesModified![0].fields.find((f) => f.kind === 'code');
    expect(codeChange).toBeDefined();
    expect(codeChange!.label).toBe('Lambda code');
    expect(codeChange!.from).toBeNull();
    expect(codeChange!.to).toBeNull();
    // line2 removed, lineX + line4 added
    expect(codeChange!.linesAdded).toBe(2);
    expect(codeChange!.linesRemoved).toBe(1);
    expect(codeChange!.oldCode).toContain('line2');
    expect(codeChange!.newCode).toContain('lineX');
  });

  it('masks zip uploads without storing their content', () => {
    const base = lambdaNode({ config: { type: 'lambda', runtime: 'nodejs20.x', handler: 'index.handler', code: { source: 'zip', zipFile: 'AAAA' } } });
    const prev = wf({ nodes: [base] as any });
    const next = wf({ nodes: [lambdaNode({ config: { type: 'lambda', runtime: 'nodejs20.x', handler: 'index.handler', code: { source: 'zip', zipFile: 'BBBB' } } })] as any });
    const diff = computeWorkflowDiff(prev, next);
    const masked = diff.nodesModified![0].fields.find((f) => f.kind === 'masked');
    expect(masked).toBeDefined();
    expect(masked!.from).toBeNull();
    expect(masked!.to).toBeNull();
    expect((masked as any).oldCode).toBeUndefined();
  });

  it('detects node rename, add, remove', () => {
    const prev = wf({ nodes: [lambdaNode(), { ...lambdaNode(), id: 'n2', name: 'Old' }] as any });
    const next = wf({ nodes: [{ ...lambdaNode(), name: 'Parser Renamed' }, { ...lambdaNode(), id: 'n3', name: 'New' }] as any });
    const diff = computeWorkflowDiff(prev, next);
    expect(diff.nodesModified!.find((n) => n.nodeId === 'n1')!.renamedFrom).toBe('Parser');
    expect(diff.nodesAdded!.map((n) => n.nodeId)).toContain('n3');
    expect(diff.nodesRemoved!.map((n) => n.nodeId)).toContain('n2');
  });

  it('detects connection add/remove using node names', () => {
    const a = { ...lambdaNode(), id: 'a', name: 'A' };
    const b = { ...lambdaNode(), id: 'b', name: 'B' };
    const conn = { id: 'c1', sourceNodeId: 'a', targetNodeId: 'b', sourceHandle: 's', targetHandle: 't' };
    const prev = wf({ nodes: [a, b] as any, connections: [] });
    const next = wf({ nodes: [a, b] as any, connections: [conn] });
    const diff = computeWorkflowDiff(prev, next);
    expect(diff.connectionsAdded).toEqual([{ from: 'A', to: 'B' }]);

    const reverse = computeWorkflowDiff(next, prev);
    expect(reverse.connectionsRemoved).toEqual([{ from: 'A', to: 'B' }]);
  });

  it('detects workflow name/description changes', () => {
    const prev = wf({ name: 'Old', description: '' });
    const next = wf({ name: 'New', description: 'now described' });
    const diff = computeWorkflowDiff(prev, next);
    const labels = diff.workflowFields!.map((f) => f.label);
    expect(labels).toContain('Name');
    expect(labels).toContain('Description');
  });

  it('returns an empty diff when nothing meaningful changed (e.g. only position)', () => {
    const prev = wf({ nodes: [lambdaNode()] as any });
    const next = wf({ nodes: [lambdaNode({ position: { x: 999, y: 999 }, isConfigured: false })] as any });
    const diff = computeWorkflowDiff(prev, next);
    expect(isEmptyDiff(diff)).toBe(true);
  });
});
