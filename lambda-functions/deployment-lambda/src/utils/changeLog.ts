import { randomUUID } from 'crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { WorkflowDiff } from './workflowDiff';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: { removeUndefinedValues: true },
});

const WORKFLOW_CHANGE_LOGS_TABLE =
  process.env.WORKFLOW_CHANGE_LOGS_TABLE || 'WorkflowBuilder-WorkflowChangeLogs';

export type ChangeAction =
  | 'created'
  | 'saved'
  | 'deploy_triggered'
  | 'deployed'
  | 'deploy_failed'
  | 'delete_triggered'
  | 'deleted';

export interface ChangeLogEntry {
  workflowId: string;
  sk: string; // ISO timestamp#uuid — enables newest-first queries
  timestamp: string;
  action: ChangeAction;
  actorUserId: string;
  actorEmail: string;
  teamId: string;
  workflowName: string;
  /** Optional extra context, e.g. deploymentId */
  meta?: Record<string, string>;
  /** Structured "what changed" diff — present on created/saved entries. */
  changes?: WorkflowDiff;
}

/**
 * Append one entry to the workflow change log.
 * Non-throwing — a logging failure must never break the primary operation.
 */
export async function writeWorkflowChangeLog(
  entry: Omit<ChangeLogEntry, 'sk' | 'timestamp'>
): Promise<void> {
  try {
    const now = new Date().toISOString();
    const sk = `${now}#${randomUUID()}`;
    await docClient.send(new PutCommand({
      TableName: WORKFLOW_CHANGE_LOGS_TABLE,
      Item: { ...entry, sk, timestamp: now },
    }));
  } catch (error) {
    console.warn('writeWorkflowChangeLog failed (non-fatal):', error);
  }
}
