import {
  CloudFormationClient,
  DeleteStackCommand,
  DescribeStacksCommand,
  StackStatus,
} from '@aws-sdk/client-cloudformation';
import { paginateListStacks } from '@aws-sdk/client-cloudformation';
import {
  DeleteNetworkInterfaceCommand,
  DescribeNetworkInterfacesCommandInput,
  EC2Client,
  NetworkInterface,
} from '@aws-sdk/client-ec2';
import { paginateDescribeNetworkInterfaces } from '@aws-sdk/client-ec2';

/**
 * CloudFormation Custom Resource handler (for use with `cr.Provider`) that,
 * on stack Delete, tears down all child workflow stacks (name prefix
 * "workflow-") and drains Lambda Hyperplane ENIs from the parent stack's
 * subnets/security group so CFN can then delete the VPC resources cleanly.
 * No-op on Create/Update.
 *
 * `cr.Provider` contract (onEvent-only):
 *   - Success  → return { PhysicalResourceId: string }
 *   - Failure  → throw. The Provider framework reports FAILED to CFN.
 *
 * Returning { Status: 'FAILED', ... } would be read by the framework as a
 * successful invocation with that object as output, so cleanup failures must
 * propagate as exceptions.
 *
 * Time budget:
 *   The enclosing Lambda is configured with a 15-minute timeout (Lambda max).
 *   To leave room for final response + CFN round-trip we stop work at 14 min.
 *   If child-stack deletion routinely exceeds this, convert to the
 *   onEvent + isComplete async pattern instead of extending the deadline.
 *
 * Required env:
 *   CHILD_STACK_PREFIX  - stack name prefix of workflow child stacks (default "workflow-")
 *   SUBNET_IDS          - comma-separated subnet IDs of the parent stack's private subnets
 *   SECURITY_GROUP_ID   - parent stack's lambda security group id
 */

const HANDLER_DEADLINE_MS = 14 * 60 * 1000; // 14 min; Lambda timeout is 15 min

export const handler = async (event: any): Promise<{ PhysicalResourceId: string }> => {
  console.log('VPC CLEANUP: event', JSON.stringify(event));
  const physicalResourceId = event.PhysicalResourceId || 'vpc-cleanup';

  if (event.RequestType !== 'Delete') {
    return { PhysicalResourceId: physicalResourceId };
  }

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
  const allSummaries = [];
  for await (const page of paginateListStacks({ client: cfn }, { StackStatusFilter: active })) {
    allSummaries.push(...(page.StackSummaries || []));
  }

  const children = allSummaries.filter(
    (s) => s.StackName?.startsWith(prefix) && s.StackId !== parentStackId,
  );
  console.log(`deleting ${children.length} child stacks`);

  // Batch deletes to avoid CloudFormation API throttling.
  const BATCH_SIZE = 5;
  for (let i = 0; i < children.length; i += BATCH_SIZE) {
    await Promise.all(
      children.slice(i, i + BATCH_SIZE).map((s) =>
        cfn.send(new DeleteStackCommand({ StackName: s.StackName! })),
      ),
    );
  }

  const deadline = Date.now() + HANDLER_DEADLINE_MS;
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
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out waiting for child stack ${s.StackName} to delete within ${HANDLER_DEADLINE_MS / 60000} minutes`,
      );
    }
  }

  // Step B: drain Lambda ENIs from the parent subnets/SG.
  const eniFilters: DescribeNetworkInterfacesCommandInput = {
    Filters: [
      { Name: 'group-id', Values: [sgId] },
      ...(subnetIds.length ? [{ Name: 'subnet-id', Values: subnetIds }] : []),
    ],
  };

  const listENIs = async (): Promise<NetworkInterface[]> => {
    const enis: NetworkInterface[] = [];
    for await (const page of paginateDescribeNetworkInterfaces({ client: ec2 }, eniFilters)) {
      enis.push(...(page.NetworkInterfaces || []));
    }
    return enis;
  };

  while (Date.now() < deadline) {
    const enis = await listENIs();
    if (enis.length === 0) break;
    for (const eni of enis) {
      if (eni.Status === 'available' && eni.NetworkInterfaceId) {
        await ec2
          .send(new DeleteNetworkInterfaceCommand({ NetworkInterfaceId: eni.NetworkInterfaceId }))
          .catch((e) => console.log(`delete ENI ${eni.NetworkInterfaceId} failed: ${e}`));
      }
    }
    await sleep(10_000);
  }

  // If ENIs are still attached at deadline, fail loudly so CFN does not
  // proceed to delete the VPC (which would then fail with a dependency error).
  const remaining = await listENIs();
  if (remaining.length > 0) {
    throw new Error(
      `Timed out with ${remaining.length} ENI(s) still attached to SG ${sgId}; VPC deletion would fail`,
    );
  }

  return { PhysicalResourceId: physicalResourceId };
};
