import { 
  CloudFrontClient, 
  CreateDistributionCommand,
  UpdateDistributionCommand,
  GetDistributionCommand,
  CreateOriginAccessControlCommand,
  CreateInvalidationCommand,
  DeleteDistributionCommand,
  ListDistributionsCommand,
  ListTagsForResourceCommand,
  TagResourceCommand,
  CreateFunctionCommand,
  CreateDistributionCommandInput,
  UpdateDistributionCommandInput,
  GetDistributionCommandInput,
  CreateOriginAccessControlCommandInput,
  CreateInvalidationCommandInput,
  DeleteDistributionCommandInput,
  ListDistributionsCommandInput,
  ListTagsForResourceCommandInput,
  TagResourceCommandInput,
  CreateFunctionCommandInput,
  DistributionConfig,
  DistributionSummary
} from '@aws-sdk/client-cloudfront';
import { S3Client, PutBucketPolicyCommand } from '@aws-sdk/client-s3';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { CloudWatchClient, GetMetricStatisticsCommand, GetMetricStatisticsCommandInput } from '@aws-sdk/client-cloudwatch';
import { CloudFrontConfig } from '../types';

/**
 * CloudFront Service
 * Manages CloudFront distributions for frontend hosting
 */
export class CloudFrontService {
  private cloudFront: CloudFrontClient;
  private s3: S3Client;
  private sts: STSClient;
  private cloudWatch: CloudWatchClient;

  constructor(region?: string) {
    const awsRegion = region || process.env.AWS_REGION || 'us-east-1';
    this.cloudFront = new CloudFrontClient({
      region: awsRegion
    });
    this.s3 = new S3Client({ region: awsRegion });
    this.sts = new STSClient({ region: awsRegion });
    this.cloudWatch = new CloudWatchClient({ region: awsRegion });
  }

  /**
   * Create or update CloudFront distribution
   */
  async createOrUpdateDistribution(
    bucketName: string, 
    environment: string, 
    config?: Partial<CloudFrontConfig>
  ): Promise<CloudFrontDistributionResult> {
    const distributionConfig = await this.buildDistributionConfig(bucketName, environment, config);
    
    try {
      // Check if distribution already exists
      const existingDistribution = await this.findDistributionByTag(environment, bucketName);
      
      if (existingDistribution) {
        return await this.updateDistribution(existingDistribution.Id!, distributionConfig);
      } else {
        return await this.createDistribution(distributionConfig, environment, bucketName);
      }
    } catch (error) {
      throw new Error(`Failed to create/update CloudFront distribution: ${error.message}`);
    }
  }

  /**
   * Create new CloudFront distribution
   */
  private async createDistribution(
    distributionConfig: DistributionConfig,
    environment: string,
    bucketName: string
  ): Promise<CloudFrontDistributionResult> {
    const params: CreateDistributionCommandInput = {
      DistributionConfig: distributionConfig
    };

    const command = new CreateDistributionCommand(params);
    const result = await this.cloudFront.send(command);
    
    // Add tags to the distribution
    await this.tagDistribution(result.Distribution!.Id!, environment, bucketName);
    
    console.log(`Created CloudFront distribution: ${result.Distribution!.Id}`);
    
    return {
      distributionId: result.Distribution!.Id!,
      domainName: result.Distribution!.DomainName!,
      status: result.Distribution!.Status!,
      arn: result.Distribution!.ARN!,
      etag: result.ETag!,
      isNew: true
    };
  }

  /**
   * Update existing CloudFront distribution
   */
  private async updateDistribution(
    distributionId: string,
    distributionConfig: DistributionConfig
  ): Promise<CloudFrontDistributionResult> {
    // Get current distribution to get ETag
    const getCommand = new GetDistributionCommand({ Id: distributionId });
    const getResult = await this.cloudFront.send(getCommand);
    
    const params: UpdateDistributionCommandInput = {
      Id: distributionId,
      DistributionConfig: distributionConfig,
      IfMatch: getResult.ETag!
    };

    const command = new UpdateDistributionCommand(params);
    const result = await this.cloudFront.send(command);
    
    console.log(`Updated CloudFront distribution: ${distributionId}`);
    
    return {
      distributionId: result.Distribution!.Id!,
      domainName: result.Distribution!.DomainName!,
      status: result.Distribution!.Status!,
      arn: result.Distribution!.ARN!,
      etag: result.ETag!,
      isNew: false
    };
  }

  /**
   * Create Origin Access Control for secure S3 access
   */
  async createOriginAccessControl(bucketName: string): Promise<string> {
    const params: CreateOriginAccessControlCommandInput = {
      OriginAccessControlConfig: {
        Name: `OAC-${bucketName}-${Date.now()}`,
        Description: `Origin Access Control for S3 bucket: ${bucketName}`,
        OriginAccessControlOriginType: 's3',
        SigningBehavior: 'always',
        SigningProtocol: 'sigv4'
      }
    };

    try {
      const command = new CreateOriginAccessControlCommand(params);
      const result = await this.cloudFront.send(command);
      console.log(`Created Origin Access Control: ${result.OriginAccessControl!.Id}`);
      
      // Update S3 bucket policy to allow CloudFront OAC access
      await this.updateS3BucketPolicyForOAC(bucketName, result.OriginAccessControl!.Id!);
      
      return result.OriginAccessControl!.Id!;
    } catch (error) {
      throw new Error(`Failed to create Origin Access Control: ${error.message}`);
    }
  }

  /**
   * Update S3 bucket policy to allow CloudFront Origin Access Control
   */
  private async updateS3BucketPolicyForOAC(bucketName: string, oacId: string): Promise<void> {
    const accountId = await this.getAccountId();
    
    const bucketPolicy = {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'AllowCloudFrontServicePrincipal',
          Effect: 'Allow',
          Principal: {
            Service: 'cloudfront.amazonaws.com'
          },
          Action: 's3:GetObject',
          Resource: `arn:aws:s3:::${bucketName}/*`,
          Condition: {
            StringEquals: {
              'AWS:SourceArn': `arn:aws:cloudfront::${accountId}:distribution/*`
            }
          }
        }
      ]
    };

    try {
      const command = new PutBucketPolicyCommand({
        Bucket: bucketName,
        Policy: JSON.stringify(bucketPolicy)
      });
      await this.s3.send(command);
      
      console.log(`Updated S3 bucket policy for OAC: ${bucketName}`);
    } catch (error) {
      console.warn(`Failed to update S3 bucket policy for ${bucketName}:`, error.message);
      // Don't throw here as the OAC was created successfully
    }
  }

  /**
   * Build CloudFront distribution configuration
   */
  private async buildDistributionConfig(
    bucketName: string, 
    environment: string, 
    config?: Partial<CloudFrontConfig>
  ): Promise<DistributionConfig> {
    const s3DomainName = `${bucketName}.s3.amazonaws.com`;
    const originId = `S3-${bucketName}`;
    
    // Create Origin Access Control for secure S3 access
    const oac = await this.createOriginAccessControl(bucketName);
    
    const distributionConfig: DistributionConfig = {
      CallerReference: `${bucketName}-${Date.now()}`,
      Comment: `Frontend distribution for ${environment} environment - ${bucketName}`,
      Enabled: true,
      HttpVersion: 'http2',
      IsIPV6Enabled: true,
      PriceClass: config?.priceClass || (environment === 'production' ? 'PriceClass_All' : 'PriceClass_100'),
      
      Origins: {
        Quantity: 1,
        Items: [{
          Id: originId,
          DomainName: s3DomainName,
          S3OriginConfig: {
            OriginAccessIdentity: '' // Empty for OAC
          },
          OriginAccessControlId: oac
        }]
      },
      
      DefaultCacheBehavior: {
        TargetOriginId: originId,
        ViewerProtocolPolicy: 'redirect-to-https',
        Compress: true,
        // Use AWS managed cache policies
        CachePolicyId: '4135ea2d-6df8-44a3-9df3-4b5a84be39ad', // Managed-CachingOptimized
        OriginRequestPolicyId: '88a5eaf4-2fd4-4709-b370-b4c650ea3fcf', // Managed-CORS-S3Origin
        ResponseHeadersPolicyId: '67f7725c-6f97-4210-82d7-5512b31e9d03', // Managed-SecurityHeadersPolicy
        AllowedMethods: {
          Quantity: 3,
          Items: ['GET', 'HEAD', 'OPTIONS'],
          CachedMethods: {
            Quantity: 2,
            Items: ['GET', 'HEAD']
          }
        },
        TrustedSigners: {
          Enabled: false,
          Quantity: 0
        },
        ForwardedValues: {
          QueryString: false,
          Cookies: {
            Forward: 'none'
          }
        },
        MinTTL: 0
      },
      
      // Cache behaviors for different file types
      CacheBehaviors: {
        Quantity: config?.cacheBehaviors?.length || 1,
        Items: config?.cacheBehaviors?.map(behavior => ({
          PathPattern: behavior.pathPattern,
          TargetOriginId: originId,
          ViewerProtocolPolicy: 'redirect-to-https',
          Compress: true,
          CachePolicyId: behavior.cachePolicyId,
          OriginRequestPolicyId: behavior.originRequestPolicyId,
          ResponseHeadersPolicyId: behavior.responseHeadersPolicyId,
          AllowedMethods: {
            Quantity: 2,
            Items: ['GET', 'HEAD'],
            CachedMethods: {
              Quantity: 2,
              Items: ['GET', 'HEAD']
            }
          },
          TrustedSigners: {
            Enabled: false,
            Quantity: 0
          },
          ForwardedValues: {
            QueryString: false,
            Cookies: {
              Forward: 'none'
            }
          },
          MinTTL: 0
        })) || [{
          PathPattern: '/static/*',
          TargetOriginId: originId,
          ViewerProtocolPolicy: 'redirect-to-https',
          Compress: true,
          CachePolicyId: '658327ea-f89d-4fab-a63d-7e88639e58f6', // Managed-CachingOptimizedForUncompressedObjects
          AllowedMethods: {
            Quantity: 2,
            Items: ['GET', 'HEAD'],
            CachedMethods: {
              Quantity: 2,
              Items: ['GET', 'HEAD']
            }
          },
          TrustedSigners: {
            Enabled: false,
            Quantity: 0
          },
          ForwardedValues: {
            QueryString: false,
            Cookies: {
              Forward: 'none'
            }
          },
          MinTTL: 0
        }]
      },
      
      // Custom error responses for SPA routing
      CustomErrorResponses: {
        Quantity: config?.customErrorResponses?.length || 2,
        Items: config?.customErrorResponses?.map(response => ({
          ErrorCode: response.errorCode,
          ResponseCode: response.responseCode.toString(),
          ResponsePagePath: response.responsePagePath,
          ErrorCachingMinTTL: response.errorCachingMinTTL || 300
        })) || [
          {
            ErrorCode: 404,
            ResponseCode: '200',
            ResponsePagePath: '/index.html',
            ErrorCachingMinTTL: 300
          },
          {
            ErrorCode: 403,
            ResponseCode: '200',
            ResponsePagePath: '/index.html',
            ErrorCachingMinTTL: 300
          }
        ]
      },
      
      DefaultRootObject: 'index.html'
    };

    // Add custom domain configuration if provided
    if (config?.domainName && config?.certificateArn) {
      distributionConfig.Aliases = {
        Quantity: 1,
        Items: [config.domainName]
      };
      
      distributionConfig.ViewerCertificate = {
        ACMCertificateArn: config.certificateArn,
        SSLSupportMethod: 'sni-only',
        MinimumProtocolVersion: 'TLSv1.2_2021'
      };
    } else {
      distributionConfig.ViewerCertificate = {
        CloudFrontDefaultCertificate: true
      };
    }

    // Add logging configuration if enabled
    if (config?.enableLogging && config?.logsBucketName) {
      distributionConfig.Logging = {
        Enabled: true,
        Bucket: `${config.logsBucketName}.s3.amazonaws.com`,
        Prefix: 'cloudfront-logs/',
        IncludeCookies: false
      };
    }

    return distributionConfig;
  }

  /**
   * Invalidate CloudFront cache
   */
  async invalidateCache(distributionId: string, paths: string[] = ['/*']): Promise<string> {
    const params: CreateInvalidationCommandInput = {
      DistributionId: distributionId,
      InvalidationBatch: {
        CallerReference: `invalidation-${Date.now()}`,
        Paths: {
          Quantity: paths.length,
          Items: paths
        }
      }
    };

    const command = new CreateInvalidationCommand(params);
    const result = await this.cloudFront.send(command);
    
    console.log(`Created CloudFront invalidation: ${result.Invalidation!.Id} for distribution ${distributionId}`);
    
    return result.Invalidation!.Id!;
  }

  /**
   * Wait for distribution to be deployed
   */
  async waitForDistributionDeployed(distributionId: string, maxWaitTime: number = 1800000): Promise<void> {
    const startTime = Date.now();
    const pollInterval = 30000; // 30 seconds
    
    console.log(`Waiting for CloudFront distribution ${distributionId} to be deployed...`);
    
    while (Date.now() - startTime < maxWaitTime) {
      const getCommand = new GetDistributionCommand({ Id: distributionId });
      const result = await this.cloudFront.send(getCommand);
      const status = result.Distribution!.Status!;
      
      console.log(`Distribution status: ${status}`);
      
      if (status === 'Deployed') {
        console.log(`Distribution ${distributionId} is now deployed`);
        return;
      }
      
      if (status === 'InProgress') {
        await this.sleep(pollInterval);
        continue;
      }
      
      throw new Error(`Unexpected distribution status: ${status}`);
    }
    
    throw new Error(`Distribution deployment timed out after ${maxWaitTime / 1000} seconds`);
  }

  /**
   * Get distribution status
   */
  async getDistributionStatus(distributionId: string): Promise<DistributionStatus> {
    try {
      const getCommand = new GetDistributionCommand({ Id: distributionId });
      const result = await this.cloudFront.send(getCommand);
      const distribution = result.Distribution!;
      
      return {
        distributionId: distribution.Id!,
        domainName: distribution.DomainName!,
        status: distribution.Status!,
        arn: distribution.ARN!,
        enabled: distribution.DistributionConfig.Enabled,
        lastModifiedTime: distribution.LastModifiedTime!.toISOString(),
        aliases: distribution.DistributionConfig.Aliases?.Items || [],
        origins: distribution.DistributionConfig.Origins.Items.map(origin => ({
          id: origin.Id,
          domainName: origin.DomainName
        }))
      };
    } catch (error) {
      if (error.statusCode === 404) {
        throw new Error(`Distribution ${distributionId} not found`);
      }
      throw new Error(`Failed to get distribution status: ${error.message}`);
    }
  }

  /**
   * Delete CloudFront distribution
   */
  async deleteDistribution(distributionId: string): Promise<void> {
    try {
      // First, disable the distribution
      const getCommand = new GetDistributionCommand({ Id: distributionId });
      const getResult = await this.cloudFront.send(getCommand);
      const distributionConfig = getResult.Distribution!.DistributionConfig;
      
      if (distributionConfig.Enabled) {
        distributionConfig.Enabled = false;
        
        const updateCommand = new UpdateDistributionCommand({
          Id: distributionId,
          DistributionConfig: distributionConfig,
          IfMatch: getResult.ETag!
        });
        await this.cloudFront.send(updateCommand);
        
        console.log(`Disabled CloudFront distribution: ${distributionId}`);
        
        // Wait for distribution to be deployed in disabled state
        await this.waitForDistributionDeployed(distributionId);
      }
      
      // Now delete the distribution
      const deleteGetCommand = new GetDistributionCommand({ Id: distributionId });
      const deleteResult = await this.cloudFront.send(deleteGetCommand);
      
      const deleteCommand = new DeleteDistributionCommand({
        Id: distributionId,
        IfMatch: deleteResult.ETag!
      });
      await this.cloudFront.send(deleteCommand);
      
      console.log(`Deleted CloudFront distribution: ${distributionId}`);
    } catch (error) {
      if (error.statusCode === 404) {
        console.log(`Distribution ${distributionId} not found, already deleted`);
        return;
      }
      throw new Error(`Failed to delete distribution: ${error.message}`);
    }
  }

  /**
   * Find distribution by tags
   */
  private async findDistributionByTag(environment: string, bucketName: string): Promise<DistributionSummary | null> {
    const listCommand = new ListDistributionsCommand({});
    const result = await this.cloudFront.send(listCommand);
    
    for (const distribution of result.DistributionList.Items) {
      try {
        const tagsCommand = new ListTagsForResourceCommand({
          Resource: distribution.ARN
        });
        const tags = await this.cloudFront.send(tagsCommand);
        
        const envTag = tags.Tags.Items.find(tag => tag.Key === 'Environment');
        const bucketTag = tags.Tags.Items.find(tag => tag.Key === 'S3Bucket');
        
        if (envTag?.Value === environment && bucketTag?.Value === bucketName) {
          return distribution;
        }
      } catch (error) {
        // Continue if we can't get tags for this distribution
        continue;
      }
    }
    
    return null;
  }

  /**
   * Tag CloudFront distribution
   */
  private async tagDistribution(distributionId: string, environment: string, bucketName: string): Promise<void> {
    const distributionArn = `arn:aws:cloudfront::${await this.getAccountId()}:distribution/${distributionId}`;
    
    const tagCommand = new TagResourceCommand({
      Resource: distributionArn,
      Tags: {
        Items: [
          { Key: 'Environment', Value: environment },
          { Key: 'Application', Value: 'WorkflowBuilder' },
          { Key: 'Component', Value: 'Frontend' },
          { Key: 'S3Bucket', Value: bucketName },
          { Key: 'ManagedBy', Value: 'WorkflowBuilder' }
        ]
      }
    });
    await this.cloudFront.send(tagCommand);
  }

  /**
   * Get AWS account ID
   */
  private async getAccountId(): Promise<string> {
    const command = new GetCallerIdentityCommand({});
    const result = await this.sts.send(command);
    return result.Account!;
  }

  /**
   * Create CloudFront distribution with enhanced security settings
   */
  async createSecureDistribution(
    bucketName: string,
    environment: string,
    config?: Partial<CloudFrontConfig>
  ): Promise<CloudFrontDistributionResult> {
    // Enhanced security configuration
    const securityConfig: Partial<CloudFrontConfig> = {
      ...config,
      customErrorResponses: [
        {
          errorCode: 404,
          responseCode: 200,
          responsePagePath: '/index.html',
          errorCachingMinTTL: 300
        },
        {
          errorCode: 403,
          responseCode: 200,
          responsePagePath: '/index.html',
          errorCachingMinTTL: 300
        },
        {
          errorCode: 500,
          responseCode: 200,
          responsePagePath: '/index.html',
          errorCachingMinTTL: 60
        }
      ],
      cacheBehaviors: [
        {
          pathPattern: '/static/*',
          cachePolicyId: '658327ea-f89d-4fab-a63d-7e88639e58f6', // Managed-CachingOptimizedForUncompressedObjects
          originRequestPolicyId: '88a5eaf4-2fd4-4709-b370-b4c650ea3fcf', // Managed-CORS-S3Origin
          responseHeadersPolicyId: '67f7725c-6f97-4210-82d7-5512b31e9d03' // Managed-SecurityHeadersPolicy
        },
        {
          pathPattern: '/api/*',
          cachePolicyId: '4135ea2d-6df8-44a3-9df3-4b5a84be39ad', // Managed-CachingDisabled
          originRequestPolicyId: '88a5eaf4-2fd4-4709-b370-b4c650ea3fcf', // Managed-CORS-S3Origin
          responseHeadersPolicyId: '67f7725c-6f97-4210-82d7-5512b31e9d03' // Managed-SecurityHeadersPolicy
        }
      ]
    };

    return await this.createOrUpdateDistribution(bucketName, environment, securityConfig);
  }

  /**
   * Configure CloudFront distribution with HTTPS redirect and security headers
   */
  async configureDistributionSecurity(distributionId: string): Promise<void> {
    try {
      const getCommand = new GetDistributionCommand({ Id: distributionId });
      const getResult = await this.cloudFront.send(getCommand);
      const distributionConfig = getResult.Distribution!.DistributionConfig;

      // Ensure HTTPS redirect is enabled
      distributionConfig.DefaultCacheBehavior.ViewerProtocolPolicy = 'redirect-to-https';

      // Update all cache behaviors to use HTTPS redirect
      if (distributionConfig.CacheBehaviors && distributionConfig.CacheBehaviors.Items) {
        distributionConfig.CacheBehaviors.Items.forEach(behavior => {
          behavior.ViewerProtocolPolicy = 'redirect-to-https';
        });
      }

      // Update the distribution
      const updateCommand = new UpdateDistributionCommand({
        Id: distributionId,
        DistributionConfig: distributionConfig,
        IfMatch: getResult.ETag!
      });
      await this.cloudFront.send(updateCommand);

      console.log(`Updated security configuration for distribution: ${distributionId}`);
    } catch (error) {
      throw new Error(`Failed to configure distribution security: ${error.message}`);
    }
  }

  /**
   * Get CloudFront distribution metrics and performance data
   */
  async getDistributionMetrics(distributionId: string, startTime: Date, endTime: Date): Promise<DistributionMetrics> {
    
    const metricsToFetch = [
      'Requests',
      'BytesDownloaded',
      'BytesUploaded',
      '4xxErrorRate',
      '5xxErrorRate',
      'OriginLatency'
    ];

    const metrics: Record<string, any[]> = {};

    for (const metricName of metricsToFetch) {
      try {
        const params: GetMetricStatisticsCommandInput = {
          Namespace: 'AWS/CloudFront',
          MetricName: metricName,
          Dimensions: [
            {
              Name: 'DistributionId',
              Value: distributionId
            }
          ],
          StartTime: startTime,
          EndTime: endTime,
          Period: 3600, // 1 hour
          Statistics: ['Sum', 'Average', 'Maximum']
        };

        const command = new GetMetricStatisticsCommand(params);
        const result = await this.cloudWatch.send(command);
        metrics[metricName] = result.Datapoints || [];
      } catch (error) {
        console.warn(`Failed to fetch metric ${metricName}:`, error.message);
        metrics[metricName] = [];
      }
    }

    return {
      distributionId,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      metrics
    };
  }

  /**
   * Create CloudFront function for request/response manipulation
   */
  async createCloudFrontFunction(
    name: string,
    code: string,
    runtime: 'cloudfront-js-1.0' = 'cloudfront-js-1.0'
  ): Promise<string> {
    const params: CreateFunctionCommandInput = {
      Name: name,
      FunctionConfig: {
        Comment: `CloudFront function: ${name}`,
        Runtime: runtime
      },
      FunctionCode: Buffer.from(code, 'utf8')
    };

    try {
      const command = new CreateFunctionCommand(params);
      const result = await this.cloudFront.send(command);
      console.log(`Created CloudFront function: ${result.FunctionSummary!.Name}`);
      return result.FunctionSummary!.Name!;
    } catch (error) {
      throw new Error(`Failed to create CloudFront function: ${error.message}`);
    }
  }

  /**
   * Associate CloudFront function with distribution
   */
  async associateFunctionWithDistribution(
    distributionId: string,
    functionName: string,
    eventType: 'viewer-request' | 'viewer-response' | 'origin-request' | 'origin-response'
  ): Promise<void> {
    try {
      const getCommand = new GetDistributionCommand({ Id: distributionId });
      const getResult = await this.cloudFront.send(getCommand);
      const distributionConfig = getResult.Distribution!.DistributionConfig;

      // Add function association to default cache behavior
      if (!distributionConfig.DefaultCacheBehavior.FunctionAssociations) {
        distributionConfig.DefaultCacheBehavior.FunctionAssociations = {
          Quantity: 0,
          Items: []
        };
      }

      distributionConfig.DefaultCacheBehavior.FunctionAssociations.Items!.push({
        EventType: eventType,
        FunctionARN: `arn:aws:cloudfront::${await this.getAccountId()}:function/${functionName}`
      });
      distributionConfig.DefaultCacheBehavior.FunctionAssociations.Quantity++;

      // Update the distribution
      const updateCommand = new UpdateDistributionCommand({
        Id: distributionId,
        DistributionConfig: distributionConfig,
        IfMatch: getResult.ETag!
      });
      await this.cloudFront.send(updateCommand);

      console.log(`Associated function ${functionName} with distribution ${distributionId}`);
    } catch (error) {
      throw new Error(`Failed to associate function with distribution: ${error.message}`);
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Types for CloudFront service
export interface CloudFrontDistributionResult {
  distributionId: string;
  domainName: string;
  status: string;
  arn: string;
  etag: string;
  isNew: boolean;
}

export interface DistributionStatus {
  distributionId: string;
  domainName: string;
  status: string;
  arn: string;
  enabled: boolean;
  lastModifiedTime: string;
  aliases: string[];
  origins: Array<{
    id: string;
    domainName: string;
  }>;
}

export interface DistributionMetrics {
  distributionId: string;
  startTime: string;
  endTime: string;
  metrics: Record<string, any[]>;
}