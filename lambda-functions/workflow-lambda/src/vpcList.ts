import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { EC2Client, DescribeVpcsCommand, DescribeSubnetsCommand, DescribeSecurityGroupsCommand, Vpc, Subnet, SecurityGroup, Tag } from '@aws-sdk/client-ec2';

const ec2 = new EC2Client({});

const tagName = (tags?: Tag[]): string => tags?.find(t => t.Key === 'Name')?.Value || '';

export const handler = async (
  _event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  try {
    const [vpcsRes, subnetsRes, sgsRes] = await Promise.all([
      ec2.send(new DescribeVpcsCommand({})),
      ec2.send(new DescribeSubnetsCommand({})),
      ec2.send(new DescribeSecurityGroupsCommand({})),
    ]);

    const allSubnets = subnetsRes.Subnets || [];
    const allSgs = sgsRes.SecurityGroups || [];

    const vpcs = (vpcsRes.Vpcs || []).map((vpc: Vpc) => ({
      vpcId: vpc.VpcId!,
      name: tagName(vpc.Tags),
      cidrBlock: vpc.CidrBlock,
      isDefault: vpc.IsDefault || false,
      subnets: allSubnets
        .filter((s: Subnet) => s.VpcId === vpc.VpcId)
        .map((s: Subnet) => ({
          subnetId: s.SubnetId!,
          name: tagName(s.Tags),
          cidrBlock: s.CidrBlock,
          availabilityZone: s.AvailabilityZone,
        })),
      securityGroups: allSgs
        .filter((sg: SecurityGroup) => sg.VpcId === vpc.VpcId)
        .map((sg: SecurityGroup) => ({
          groupId: sg.GroupId!,
          name: sg.GroupName || '',
          description: sg.Description || '',
        })),
    }));

    return { statusCode: 200, headers, body: JSON.stringify({ vpcs }) };
  } catch (error) {
    console.error('Error fetching VPCs:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to fetch VPCs', message: error instanceof Error ? error.message : 'Unknown error' }),
    };
  }
};
