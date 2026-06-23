import React from 'react';
import { WorkflowDiff, FieldChange } from '../services/teamApi';

/**
 * Renders a structured workflow change diff (computed at save time on the
 * backend) into a readable "what changed" summary. Used by both the Admin
 * "Workflow changes" tab and the per-workflow changelog.
 */

const NODE_TYPE_LABELS: Record<string, string> = {
  start: 'Start',
  end: 'End',
  s3: 'S3',
  lambda: 'Lambda',
  opensearch: 'OpenSearch',
};

function nodeTypeLabel(type: string): string {
  return NODE_TYPE_LABELS[type] || type;
}

const styles = {
  root: { fontSize: 12, color: '#374151', display: 'flex', flexDirection: 'column', gap: 10 } as React.CSSProperties,
  section: { display: 'flex', flexDirection: 'column', gap: 4 } as React.CSSProperties,
  sectionTitle: { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b' } as React.CSSProperties,
  line: { lineHeight: 1.5 } as React.CSSProperties,
  nodeBlock: { borderLeft: '2px solid #e2e8f0', paddingLeft: 10, marginTop: 2 } as React.CSSProperties,
  nodeHeader: { fontWeight: 600, color: '#1e293b' } as React.CSSProperties,
  typeTag: { fontWeight: 400, color: '#64748b' } as React.CSSProperties,
  val: { fontFamily: 'monospace', background: '#f1f5f9', borderRadius: 4, padding: '0 4px', wordBreak: 'break-all' } as React.CSSProperties,
  empty: { fontFamily: 'monospace', color: '#9ca3af', fontStyle: 'italic' } as React.CSSProperties,
  added: { color: '#166534' } as React.CSSProperties,
  removed: { color: '#b91c1c' } as React.CSSProperties,
};

function Value({ v }: { v: string | null }) {
  if (v === null || v === '') return <span style={styles.empty}>(empty)</span>;
  return <span style={styles.val}>{v}</span>;
}

function FieldChangeLine({ change }: { change: FieldChange }) {
  if (change.kind === 'code') {
    const added = change.linesAdded || 0;
    const removed = change.linesRemoved || 0;
    return (
      <div style={styles.line}>
        {change.label} updated{' '}
        <span style={styles.added}>+{added}</span> / <span style={styles.removed}>-{removed}</span> lines
      </div>
    );
  }
  if (change.kind === 'masked') {
    return <div style={styles.line}>{change.label} updated</div>;
  }
  return (
    <div style={styles.line}>
      {change.label} changed from <Value v={change.from} /> to <Value v={change.to} />
    </div>
  );
}

export default function ChangeDiffView({ diff }: { diff: WorkflowDiff }) {
  const sections: React.ReactNode[] = [];

  if (diff.createdNodeCount !== undefined) {
    sections.push(
      <div key="created" style={styles.section}>
        <div style={styles.line}>
          Created with <strong>{diff.createdNodeCount}</strong> node{diff.createdNodeCount === 1 ? '' : 's'}.
        </div>
        {diff.nodesAdded && diff.nodesAdded.length > 0 && (
          <div style={styles.nodeBlock}>
            {diff.nodesAdded.map((n) => (
              <div key={n.nodeId} style={styles.line}>
                <span style={styles.nodeHeader}>{n.name}</span>{' '}
                <span style={styles.typeTag}>({nodeTypeLabel(n.nodeType)})</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (diff.workflowFields && diff.workflowFields.length > 0) {
    sections.push(
      <div key="wf-fields" style={styles.section}>
        <div style={styles.sectionTitle}>Workflow</div>
        {diff.workflowFields.map((c) => (
          <FieldChangeLine key={c.key} change={c} />
        ))}
      </div>
    );
  }

  if (diff.nodesAdded && diff.nodesAdded.length > 0 && diff.createdNodeCount === undefined) {
    sections.push(
      <div key="nodes-added" style={styles.section}>
        <div style={styles.sectionTitle}>Nodes added</div>
        {diff.nodesAdded.map((n) => (
          <div key={n.nodeId} style={styles.line}>
            <span style={styles.added}>+</span> <span style={styles.nodeHeader}>{n.name}</span>{' '}
            <span style={styles.typeTag}>({nodeTypeLabel(n.nodeType)})</span>
          </div>
        ))}
      </div>
    );
  }

  if (diff.nodesRemoved && diff.nodesRemoved.length > 0) {
    sections.push(
      <div key="nodes-removed" style={styles.section}>
        <div style={styles.sectionTitle}>Nodes removed</div>
        {diff.nodesRemoved.map((n) => (
          <div key={n.nodeId} style={styles.line}>
            <span style={styles.removed}>-</span> <span style={styles.nodeHeader}>{n.name}</span>{' '}
            <span style={styles.typeTag}>({nodeTypeLabel(n.nodeType)})</span>
          </div>
        ))}
      </div>
    );
  }

  if (diff.nodesModified && diff.nodesModified.length > 0) {
    sections.push(
      <div key="nodes-modified" style={styles.section}>
        <div style={styles.sectionTitle}>Nodes changed</div>
        {diff.nodesModified.map((n) => (
          <div key={n.nodeId} style={styles.nodeBlock}>
            <div style={styles.nodeHeader}>
              {n.name} <span style={styles.typeTag}>({nodeTypeLabel(n.nodeType)})</span>
            </div>
            {n.renamedFrom !== undefined && (
              <div style={styles.line}>
                Renamed from <Value v={n.renamedFrom} /> to <Value v={n.name} />
              </div>
            )}
            {n.fields.map((c) => (
              <FieldChangeLine key={c.key} change={c} />
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (diff.connectionsAdded && diff.connectionsAdded.length > 0) {
    sections.push(
      <div key="conn-added" style={styles.section}>
        <div style={styles.sectionTitle}>Connections added</div>
        {diff.connectionsAdded.map((c, i) => (
          <div key={`${c.from}-${c.to}-${i}`} style={styles.line}>
            <span style={styles.added}>+</span> {c.from} → {c.to}
          </div>
        ))}
      </div>
    );
  }

  if (diff.connectionsRemoved && diff.connectionsRemoved.length > 0) {
    sections.push(
      <div key="conn-removed" style={styles.section}>
        <div style={styles.sectionTitle}>Connections removed</div>
        {diff.connectionsRemoved.map((c, i) => (
          <div key={`${c.from}-${c.to}-${i}`} style={styles.line}>
            <span style={styles.removed}>-</span> {c.from} → {c.to}
          </div>
        ))}
      </div>
    );
  }

  if (sections.length === 0) {
    return <span style={styles.empty}>No structural changes recorded.</span>;
  }

  return <div style={styles.root}>{sections}</div>;
}
