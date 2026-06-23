import { Workflow, WorkflowNode, Connection } from '../types/workflow';

/**
 * Structured, human-readable diff between two versions of a workflow.
 *
 * Computed at save time (saveWorkflow) where both the previous and the new
 * workflow are available, then persisted on the change-log entry so the UI can
 * render "what changed" without re-deriving it.
 */

/** A single changed field on a node or on the workflow itself. */
export interface FieldChange {
  /** Machine key / dot-path, e.g. "bucketName" or "code.source". */
  key: string;
  /** Human-readable label, e.g. "S3 bucket name". */
  label: string;
  /** Previous value (stringified). null = the field was absent before. */
  from: string | null;
  /** New value (stringified). null = the field was removed. */
  to: string | null;
  /**
   * value  — ordinary field; render `from` -> `to`.
   * code   — large code body; UI shows only the line delta, full bodies are
   *          kept in oldCode/newCode for the audit record.
   * masked — large/opaque blob (e.g. uploaded zip); only the fact that it
   *          changed is recorded.
   */
  kind: 'value' | 'code' | 'masked';
  /** code kind only — lines added in the new version. */
  linesAdded?: number;
  /** code kind only — lines removed from the previous version. */
  linesRemoved?: number;
  /** code kind only — full previous code body (audit record, not shown in UI). */
  oldCode?: string;
  /** code kind only — full new code body (audit record, not shown in UI). */
  newCode?: string;
}

/** Lightweight reference to a node, used for added/removed lists. */
export interface NodeRef {
  nodeId: string;
  name: string;
  nodeType: string;
}

/** A node that existed before and after, with its field-level changes. */
export interface NodeModification {
  nodeId: string;
  name: string;
  nodeType: string;
  /** Set when the node's display name changed. */
  renamedFrom?: string;
  fields: FieldChange[];
}

/** A connection described by the human names of its endpoints. */
export interface ConnectionRef {
  from: string;
  to: string;
}

export interface WorkflowDiff {
  /** Set for the "created" action — number of nodes the workflow started with. */
  createdNodeCount?: number;
  /** Changes to workflow-level fields (name, description). */
  workflowFields?: FieldChange[];
  nodesAdded?: NodeRef[];
  nodesRemoved?: NodeRef[];
  nodesModified?: NodeModification[];
  connectionsAdded?: ConnectionRef[];
  connectionsRemoved?: ConnectionRef[];
}

/** Friendly labels for known config dot-paths. */
const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  description: 'Description',
  // S3
  bucketName: 'S3 bucket name',
  operation: 'Operation',
  objectKey: 'Object key',
  prefix: 'Prefix',
  folderPrefix: 'Folder prefix',
  triggerOnUpload: 'Trigger on upload',
  region: 'Region',
  versioning: 'Versioning',
  'encryption.enabled': 'Encryption enabled',
  'encryption.kmsKeyId': 'KMS key ID',
  // Lambda
  functionName: 'Function name',
  runtime: 'Runtime',
  handler: 'Handler',
  timeout: 'Timeout (seconds)',
  memorySize: 'Memory (MB)',
  layers: 'Layers',
  'code.source': 'Code source',
  'code.content': 'Lambda code',
  'code.zipFile': 'Code zip upload',
  'code.s3Bucket': 'Code S3 bucket',
  'code.s3Key': 'Code S3 key',
  'code.s3ObjectVersion': 'Code S3 version',
  'iamRole.useExisting': 'Use existing IAM role',
  'iamRole.existingRoleArn': 'Existing IAM role ARN',
  'tracingConfig.mode': 'Tracing mode',
  'deadLetterConfig.targetArn': 'Dead-letter ARN',
  // OpenSearch
  collectionEndpoint: 'OpenSearch endpoint',
  indexName: 'Index name',
  dateRangeField: 'Date range field',
  dateRangeDays: 'Date range days',
};

/** Paths whose contents are large code bodies (line-delta + stored full text). */
const CODE_PATHS = new Set(['code.content']);
/** Paths whose contents are large opaque blobs (record "changed" only). */
const MASKED_PATHS = new Set(['code.zipFile', 'zipFile']);

/** camelCase / dotted.path -> "Camel case" style label. */
function humanizeKey(path: string): string {
  const last = path.split('.').pop() || path;
  const spaced = last
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function labelFor(path: string): string {
  if (FIELD_LABELS[path]) return FIELD_LABELS[path];
  if (path.startsWith('environment.')) return `Env var: ${path.slice('environment.'.length)}`;
  if (path.startsWith('metadata.')) return `Metadata: ${path.slice('metadata.'.length)}`;
  return humanizeKey(path);
}

/**
 * Flatten an object into dot-path -> stringified-leaf pairs.
 * Arrays are treated as a single leaf (joined) so we don't emit noisy
 * per-index changes.
 */
function flatten(obj: any, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (obj === null || obj === undefined || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v === null || v === undefined || v === '') continue;
    if (Array.isArray(v)) {
      out[path] = v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ');
    } else if (typeof v === 'object') {
      flatten(v, path, out);
    } else {
      out[path] = String(v);
    }
  }
  return out;
}

/** Approximate +added / -removed line counts using a line multiset difference. */
function lineDelta(oldStr: string, newStr: string): { added: number; removed: number } {
  const count = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (const line of s.split('\n')) m.set(line, (m.get(line) || 0) + 1);
    return m;
  };
  const a = count(oldStr || '');
  const b = count(newStr || '');
  let added = 0;
  let removed = 0;
  const keys = new Set<string>([...a.keys(), ...b.keys()]);
  for (const k of keys) {
    const delta = (b.get(k) || 0) - (a.get(k) || 0);
    if (delta > 0) added += delta;
    else if (delta < 0) removed += -delta;
  }
  return { added, removed };
}

/** Diff two node configs into a list of FieldChange. */
function diffConfig(oldConfig: any, newConfig: any): FieldChange[] {
  const oldFlat = flatten(oldConfig || {});
  const newFlat = flatten(newConfig || {});
  const changes: FieldChange[] = [];

  // Special-case large code/blob paths first so we never put their content
  // into ordinary from/to fields.
  const handled = new Set<string>();

  for (const path of CODE_PATHS) {
    const oldVal = (oldConfig && getByPath(oldConfig, path)) ?? '';
    const newVal = (newConfig && getByPath(newConfig, path)) ?? '';
    handled.add(path);
    if (String(oldVal) === String(newVal)) continue;
    const { added, removed } = lineDelta(String(oldVal), String(newVal));
    changes.push({
      key: path,
      label: labelFor(path),
      from: null,
      to: null,
      kind: 'code',
      linesAdded: added,
      linesRemoved: removed,
      oldCode: oldVal ? String(oldVal) : undefined,
      newCode: newVal ? String(newVal) : undefined,
    });
  }

  for (const path of MASKED_PATHS) {
    const oldVal = (oldConfig && getByPath(oldConfig, path)) ?? '';
    const newVal = (newConfig && getByPath(newConfig, path)) ?? '';
    handled.add(path);
    if (String(oldVal) === String(newVal)) continue;
    changes.push({ key: path, label: labelFor(path), from: null, to: null, kind: 'masked' });
  }

  const allKeys = new Set<string>([...Object.keys(oldFlat), ...Object.keys(newFlat)]);
  for (const key of allKeys) {
    if (handled.has(key)) continue;
    const from = oldFlat[key] ?? null;
    const to = newFlat[key] ?? null;
    if (from === to) continue;
    changes.push({ key, label: labelFor(key), from, to, kind: 'value' });
  }

  // Stable, readable ordering.
  changes.sort((a, b) => a.label.localeCompare(b.label));
  return changes;
}

/** Read a dot-path value from an object without throwing. */
function getByPath(obj: any, path: string): any {
  return path.split('.').reduce((acc, part) => (acc == null ? undefined : acc[part]), obj);
}

function diffWorkflowFields(oldWf: Partial<Workflow>, newWf: Partial<Workflow>): FieldChange[] {
  const fields: FieldChange[] = [];
  for (const key of ['name', 'description'] as const) {
    const from = oldWf[key] != null && oldWf[key] !== '' ? String(oldWf[key]) : null;
    const to = newWf[key] != null && newWf[key] !== '' ? String(newWf[key]) : null;
    if (from !== to) {
      fields.push({ key, label: labelFor(key), from, to, kind: 'value' });
    }
  }
  return fields;
}

function nodeMap(nodes: WorkflowNode[] | undefined): Map<string, WorkflowNode> {
  const m = new Map<string, WorkflowNode>();
  (nodes || []).forEach((n) => m.set(n.id, n));
  return m;
}

function connectionKey(c: Connection): string {
  return `${c.sourceNodeId}->${c.targetNodeId}`;
}

function nodeName(map: Map<string, WorkflowNode>, id: string): string {
  return map.get(id)?.name || id;
}

/**
 * Compute a structured diff between an existing workflow and the incoming one.
 * Node canvas positions and the transient `isConfigured` flag are ignored —
 * they are not meaningful "changes" for an audit trail.
 */
export function computeWorkflowDiff(
  oldWf: Partial<Workflow> | null | undefined,
  newWf: Partial<Workflow>
): WorkflowDiff {
  // Created: no prior version.
  if (!oldWf) {
    const newNodes = newWf.nodes || [];
    return {
      createdNodeCount: newNodes.length,
      nodesAdded: newNodes.map((n) => ({ nodeId: n.id, name: n.name, nodeType: n.type })),
    };
  }

  const diff: WorkflowDiff = {};

  const workflowFields = diffWorkflowFields(oldWf, newWf);
  if (workflowFields.length) diff.workflowFields = workflowFields;

  const oldNodes = nodeMap(oldWf.nodes);
  const newNodes = nodeMap(newWf.nodes);

  const nodesAdded: NodeRef[] = [];
  const nodesRemoved: NodeRef[] = [];
  const nodesModified: NodeModification[] = [];

  for (const [id, node] of newNodes) {
    if (!oldNodes.has(id)) {
      nodesAdded.push({ nodeId: id, name: node.name, nodeType: node.type });
    }
  }
  for (const [id, node] of oldNodes) {
    if (!newNodes.has(id)) {
      nodesRemoved.push({ nodeId: id, name: node.name, nodeType: node.type });
    }
  }
  for (const [id, newNode] of newNodes) {
    const oldNode = oldNodes.get(id);
    if (!oldNode) continue;
    const fields = diffConfig(oldNode.config, newNode.config);
    const renamed = oldNode.name !== newNode.name;
    if (fields.length || renamed) {
      nodesModified.push({
        nodeId: id,
        name: newNode.name,
        nodeType: newNode.type,
        renamedFrom: renamed ? oldNode.name : undefined,
        fields,
      });
    }
  }

  if (nodesAdded.length) diff.nodesAdded = nodesAdded;
  if (nodesRemoved.length) diff.nodesRemoved = nodesRemoved;
  if (nodesModified.length) diff.nodesModified = nodesModified;

  // Connections.
  const oldConns = new Map<string, Connection>();
  (oldWf.connections || []).forEach((c) => oldConns.set(connectionKey(c), c));
  const newConns = new Map<string, Connection>();
  (newWf.connections || []).forEach((c) => newConns.set(connectionKey(c), c));

  const connectionsAdded: ConnectionRef[] = [];
  const connectionsRemoved: ConnectionRef[] = [];
  for (const [key, c] of newConns) {
    if (!oldConns.has(key)) {
      connectionsAdded.push({ from: nodeName(newNodes, c.sourceNodeId), to: nodeName(newNodes, c.targetNodeId) });
    }
  }
  for (const [key, c] of oldConns) {
    if (!newConns.has(key)) {
      connectionsRemoved.push({ from: nodeName(oldNodes, c.sourceNodeId), to: nodeName(oldNodes, c.targetNodeId) });
    }
  }
  if (connectionsAdded.length) diff.connectionsAdded = connectionsAdded;
  if (connectionsRemoved.length) diff.connectionsRemoved = connectionsRemoved;

  return diff;
}

/** True when the diff carries no meaningful change. */
export function isEmptyDiff(diff: WorkflowDiff): boolean {
  return (
    diff.createdNodeCount === undefined &&
    !diff.workflowFields?.length &&
    !diff.nodesAdded?.length &&
    !diff.nodesRemoved?.length &&
    !diff.nodesModified?.length &&
    !diff.connectionsAdded?.length &&
    !diff.connectionsRemoved?.length
  );
}
