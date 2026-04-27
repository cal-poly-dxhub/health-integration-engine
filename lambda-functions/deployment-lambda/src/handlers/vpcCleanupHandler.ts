import {
  CloudFormationClient,
  DeleteStackCommand,
  DescribeStacksCommand,
  ListStacksCommand,
  StackStatus,
} from '@aws-sdk/client-cloudformation';
import {
  DeleteNetworkInterfaceCommand,
  DescribeNetworkInterfacesCommand,
  EC2Client,
} from '@aws-sdk/client-ec2';

/**
 * CloudFormation Custom Resource handler that, on stack Delete, tears down all
 * child workflow stacks (name prefix "workflow-") and drains Lambda Hyperplane
 * ENIs from the parent stack's subnets/security group so CFN can then delete
 * the VPC resources cleanly. No-op on Create/Update.
 *
 * Required env:
 *   CHILD_STACK_PREFIX  - stack name prefix of workflow child stacks (default "workflow-")
 *   SUBNET_IDS          - comma-separated subnet IDs of the parent stack's private subnets
 *   SECURITY_GROUP_ID   - parent stack's lambda security group id
 */
export const handler = async (event: any): Promise<any> => {
  console.log('🧹 VPC CLEANUP: event', JSON.stringify(event));
  const response = (status: 'SUCCESS' | 'FAILED', reason?: string) => ({
    Status: status,
    Reason: reason,
    PhysicalResourceId: event.PhysicalResourceId || 'vpc-cleanup',
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
  });

  if (event.RequestType !== 'Delete') return response('SUCCESS');

  try {
    const region = process.env.AWS_REGION!;
    const prefix = process.env.CHILD_STACK_PREFIX || 'workflow-';
    const subnetIds = (process.env.SUBNET_IDS || '').split(',').filter(Boolean);
    const sgId = process.env.SECURITY_GROUP_ID!;
    const parentStackId = event.StackId as string;

    const cfn = new CloudFormationClient({ region });
    const ec2 = new EC2Client({ region });

    // Step A: delete all child workflow stacks (skip self).
    const active: StackStatus[] = [
      StackStatus.CREATE_COMPLETE,
      StackStatus.UPDATE_COMPLETE,
      StackStatus.UPDATE_ROLLBACK_COMPLETE,
      StackStatus.ROLLBACK_COMPLETE,
      StackStatus.CREATE_FAILED,
      StackStatus.DELETE_FAILED,
    ];
    const summaries = await cfn.send(new ListStacksCommand({ StackStatusFilter: active }));
    const children = (summaries.StackSummaries || []).filter(
      (s) => s.StackName?.startsWith(prefix) && s.StackId !== parentStackId,
    );
    console.log(`🧹 deleting ${children.length} child stacks`);
    await Promise.all(
      children.map((s) => cfn.send(new DeleteStackCommand({ StackName: s.StackName! }))),
    );

    const deadline = Date.now() + 45 * 60 * 1000; // 45 min
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    // Wait for child stacks to reach DELETE_COMPLETE (or disappear).
    for (const s of children) {
      while (Date.now() < deadline) {
        try {
          const d = await cfn.send(new DescribeStacksCommand({ StackName: s.StackId! }));
          const st = d.Stacks?.[0]?.StackStatus;
          if (st === StackStatus.DELETE_COMPLETE) break;
          if (st === StackStatus.DELETE_FAILED) {
            throw new Error(`child stack ${s.StackName} DELETE_FAILED`);
          }
        } catch (e: any) {
          if (String(e?.message || e).includes('does not exist')) break;
          throw e;
        }
        await sleep(15_000);
      }
    }

    // Step B: drain Lambda ENIs from the parent subnets/SG.
    while (Date.now() < deadline) {
      const { NetworkInterfaces = [] } = await ec2.send(
        new DescribeNetworkInterfacesCommand({
          Filters: [
            { Name: 'group-id', Values: [sgId] },
            ...(subnetIds.length ? [{ Name: 'subnet-id', Values: subnetIds }] : []),
          ],
        }),
      );
      if (NetworkInterfaces.length === 0) break;
      for (const eni of NetworkInterfaces) {
        if (eni.Status === 'available' && eni.NetworkInterfaceId) {
          await ec2
            .send(new DeleteNetworkInterfaceCommand({ NetworkInterfaceId: eni.NetworkInterfaceId }))
            .catch((e) => console.log(`delete ENI ${eni.NetworkInterfaceId} failed: ${e}`));
        }
      }
      await sleep(30_000);
    }

    return response('SUCCESS');
  } catch (err: any) {
    console.error('❌ VPC CLEANUP failed', err);
    return response('FAILED', String(err?.message || err));
  }
};
