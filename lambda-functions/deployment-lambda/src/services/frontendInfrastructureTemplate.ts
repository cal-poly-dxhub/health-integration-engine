/**
 * CloudFormation template for frontend hosting infrastructure
 * Creates S3 bucket and CloudFront distribution for static website hosting
 */

export interface FrontendInfrastructureTemplateParams {
  environment: 'development' | 'staging' | 'production';
  domainName?: string;
  certificateArn?: string;
}

export class FrontendInfrastructureTemplate {
  /**
   * Generate CloudFormation template for frontend infrastructure
   */
  static generateTemplate(params: FrontendInfrastructureTemplateParams): any {
    const { environment, domainName, certificateArn } = params;
    
    const template = {
      AWSTemplateFormatVersion: '2010-09-09',
      Description: `Frontend hosting infrastructure with S3 and CloudFront for ${environment} environment`,
      
      Parameters: {
        Environment: {
          Type: 'String',
          Default: environment,
          AllowedValues: ['development', 'staging', 'production'],
          Description: 'Environment name for resource naming and configuration'
        },
        DomainName: {
          Type: 'String',
          Description: 'Custom domain name (optional)',
          Default: domainName || ''
        },
        CertificateArn: {
          Type: 'String',
          Description: 'ACM certificate ARN for custom domain (optional)',
          Default: certificateArn || ''
        }
      },
      
      Conditions: {
        HasCustomDomain: {
          'Fn::Not': [
            { 'Fn::Equals': [{ Ref: 'DomainName' }, ''] }
          ]
        },
        HasCertificate: {
          'Fn::Not': [
            { 'Fn::Equals': [{ Ref: 'CertificateArn' }, ''] }
          ]
        }
      },
      
      Resources: {
        // S3 Bucket for static website hosting
        S3Bucket: {
          Type: 'AWS::S3::Bucket',
          Properties: {
            BucketName: {
              'Fn::Sub': `workflow-builder-frontend-\${Environment}-\${AWS::AccountId}`
            },
            // Comprehensive public access blocking
            PublicAccessBlockConfiguration: {
              BlockPublicAcls: true,
              BlockPublicPolicy: true,
              IgnorePublicAcls: true,
              RestrictPublicBuckets: true
            },
            // Enable versioning for rollback capabilities
            VersioningConfiguration: {
              Status: 'Enabled'
            },
            // Enhanced encryption configuration
            BucketEncryption: {
              ServerSideEncryptionConfiguration: [{
                ServerSideEncryptionByDefault: {
                  SSEAlgorithm: 'AES256'
                },
                BucketKeyEnabled: true
              }]
            },
            // Comprehensive lifecycle management
            LifecycleConfiguration: {
              Rules: [
                {
                  Id: 'DeleteOldVersions',
                  Status: 'Enabled',
                  NoncurrentVersionExpirationInDays: 30
                },
                {
                  Id: 'DeleteIncompleteMultipartUploads',
                  Status: 'Enabled',
                  AbortIncompleteMultipartUpload: {
                    DaysAfterInitiation: 7
                  }
                },
                {
                  Id: 'TransitionToIA',
                  Status: 'Enabled',
                  Transitions: [{
                    Days: 30,
                    StorageClass: 'STANDARD_IA'
                  }]
                }
              ]
            },
            // Notification configuration for security monitoring
            NotificationConfiguration: {
              CloudWatchConfigurations: [{
                Event: 's3:ObjectCreated:*',
                CloudWatchConfiguration: {
                  LogGroupName: {
                    'Fn::Sub': '/aws/s3/workflow-builder-frontend-${Environment}'
                  }
                }
              }]
            },
            // Enhanced security and compliance tags
            Tags: [
              {
                Key: 'Environment',
                Value: { Ref: 'Environment' }
              },
              {
                Key: 'Application',
                Value: 'WorkflowBuilder'
              },
              {
                Key: 'Component',
                Value: 'Frontend'
              },
              {
                Key: 'SecurityLevel',
                Value: {
                  'Fn::If': [
                    { 'Fn::Equals': [{ Ref: 'Environment' }, 'production'] },
                    'High',
                    'Standard'
                  ]
                }
              },
              {
                Key: 'DataClassification',
                Value: 'Internal'
              },
              {
                Key: 'CostCenter',
                Value: 'Engineering'
              },
              {
                Key: 'Owner',
                Value: 'WorkflowBuilder-Team'
              },
              {
                Key: 'BackupRequired',
                Value: 'true'
              }
            ]
          }
        },
        
        // Origin Access Control for CloudFront
        OriginAccessControl: {
          Type: 'AWS::CloudFront::OriginAccessControl',
          Properties: {
            OriginAccessControlConfig: {
              Name: {
                'Fn::Sub': `OAC-\${Environment}-\${AWS::AccountId}`
              },
              Description: `Origin Access Control for ${environment} frontend`,
              OriginAccessControlOriginType: 's3',
              SigningBehavior: 'always',
              SigningProtocol: 'sigv4'
            }
          }
        },
        
        // Custom Response Headers Policy for Enhanced Security
        SecurityResponseHeadersPolicy: {
          Type: 'AWS::CloudFront::ResponseHeadersPolicy',
          Properties: {
            ResponseHeadersPolicyConfig: {
              Name: {
                'Fn::Sub': 'WorkflowBuilder-Security-Headers-${Environment}'
              },
              Comment: `Enhanced security headers for ${environment} environment`,
              SecurityHeadersConfig: {
                StrictTransportSecurity: {
                  AccessControlMaxAgeSec: 31536000, // 1 year
                  IncludeSubdomains: true,
                  Preload: true,
                  Override: false
                },
                ContentTypeOptions: {
                  Override: false
                },
                FrameOptions: {
                  FrameOption: 'DENY',
                  Override: false
                },
                ReferrerPolicy: {
                  ReferrerPolicy: 'strict-origin-when-cross-origin',
                  Override: false
                }
              },
              CustomHeadersConfig: {
                Items: [
                  {
                    Header: 'X-Content-Security-Policy',
                    Value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cognito-idp.*.amazonaws.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://*.amazonaws.com https://*.execute-api.*.amazonaws.com; frame-ancestors 'none';",
                    Override: false
                  },
                  {
                    Header: 'X-Permitted-Cross-Domain-Policies',
                    Value: 'none',
                    Override: false
                  },
                  {
                    Header: 'X-XSS-Protection',
                    Value: '1; mode=block',
                    Override: false
                  }
                ]
              }
            }
          }
        },

        // Custom Cache Policy for HTML files with security considerations
        HTMLCachePolicy: {
          Type: 'AWS::CloudFront::CachePolicy',
          Properties: {
            CachePolicyConfig: {
              Name: {
                'Fn::Sub': 'WorkflowBuilder-HTML-Cache-${Environment}'
              },
              Comment: 'Cache policy for HTML files with security headers',
              DefaultTTL: 300, // 5 minutes
              MaxTTL: 3600, // 1 hour
              MinTTL: 0,
              ParametersInCacheKeyAndForwardedToOrigin: {
                EnableAcceptEncodingGzip: true,
                EnableAcceptEncodingBrotli: true,
                QueryStringsConfig: {
                  QueryStringBehavior: 'none'
                },
                HeadersConfig: {
                  HeaderBehavior: 'whitelist',
                  Headers: [
                    'Authorization',
                    'CloudFront-Viewer-Country'
                  ]
                },
                CookiesConfig: {
                  CookieBehavior: 'none'
                }
              }
            }
          }
        },

        // CloudFront Distribution with Enhanced Security
        CloudFrontDistribution: {
          Type: 'AWS::CloudFront::Distribution',
          Properties: {
            DistributionConfig: {
              Comment: {
                'Fn::Sub': `Frontend distribution for \${Environment} environment with enhanced security`
              },
              Enabled: true,
              HttpVersion: 'http2and3',
              IPV6Enabled: true,
              PriceClass: environment === 'production' ? 'PriceClass_All' : 'PriceClass_100',
              
              // Web Application Firewall (WAF) integration for production
              WebACLId: environment === 'production' ? {
                Ref: 'WebACL'
              } : { Ref: 'AWS::NoValue' },
              
              Origins: [{
                Id: 'S3Origin',
                DomainName: {
                  'Fn::GetAtt': ['S3Bucket', 'RegionalDomainName']
                },
                OriginAccessControlId: {
                  Ref: 'OriginAccessControl'
                },
                S3OriginConfig: {
                  OriginAccessIdentity: ''
                },
                // Origin shield for production
                OriginShield: environment === 'production' ? {
                  Enabled: true,
                  OriginShieldRegion: 'us-east-1'
                } : { Ref: 'AWS::NoValue' }
              }],
              
              DefaultCacheBehavior: {
                TargetOriginId: 'S3Origin',
                ViewerProtocolPolicy: 'redirect-to-https',
                Compress: true,
                CachePolicyId: {
                  Ref: 'HTMLCachePolicy'
                },
                OriginRequestPolicyId: '88a5eaf4-2fd4-4709-b370-b4c650ea3fcf', // Managed-CORS-S3Origin
                ResponseHeadersPolicyId: {
                  Ref: 'SecurityResponseHeadersPolicy'
                },
                AllowedMethods: ['GET', 'HEAD', 'OPTIONS'],
                CachedMethods: ['GET', 'HEAD'],
                // Trusted key groups for signed URLs (if needed)
                TrustedKeyGroups: environment === 'production' ? [{
                  Ref: 'TrustedKeyGroup'
                }] : { Ref: 'AWS::NoValue' }
              },
              
              // Enhanced cache behaviors for different asset types
              CacheBehaviors: [
                {
                  PathPattern: '/static/js/*',
                  TargetOriginId: 'S3Origin',
                  ViewerProtocolPolicy: 'redirect-to-https',
                  Compress: true,
                  CachePolicyId: '658327ea-f89d-4fab-a63d-7e88639e58f6', // Managed-CachingOptimizedForUncompressedObjects
                  ResponseHeadersPolicyId: {
                    Ref: 'SecurityResponseHeadersPolicy'
                  },
                  AllowedMethods: ['GET', 'HEAD'],
                  CachedMethods: ['GET', 'HEAD']
                },
                {
                  PathPattern: '/static/css/*',
                  TargetOriginId: 'S3Origin',
                  ViewerProtocolPolicy: 'redirect-to-https',
                  Compress: true,
                  CachePolicyId: '658327ea-f89d-4fab-a63d-7e88639e58f6',
                  ResponseHeadersPolicyId: {
                    Ref: 'SecurityResponseHeadersPolicy'
                  },
                  AllowedMethods: ['GET', 'HEAD'],
                  CachedMethods: ['GET', 'HEAD']
                },
                {
                  PathPattern: '/static/media/*',
                  TargetOriginId: 'S3Origin',
                  ViewerProtocolPolicy: 'redirect-to-https',
                  Compress: false, // Don't compress images
                  CachePolicyId: '4135ea2d-6df8-44a3-9df3-4b5a84be39ad', // Managed-CachingOptimized
                  ResponseHeadersPolicyId: {
                    Ref: 'SecurityResponseHeadersPolicy'
                  },
                  AllowedMethods: ['GET', 'HEAD'],
                  CachedMethods: ['GET', 'HEAD']
                }
              ],
              
              // Enhanced custom error responses for SPA routing and security
              CustomErrorResponses: [
                {
                  ErrorCode: 404,
                  ResponseCode: 200,
                  ResponsePagePath: '/index.html',
                  ErrorCachingMinTTL: 300
                },
                {
                  ErrorCode: 403,
                  ResponseCode: 200,
                  ResponsePagePath: '/index.html',
                  ErrorCachingMinTTL: 300
                },
                {
                  ErrorCode: 500,
                  ResponseCode: 500,
                  ResponsePagePath: '/error.html',
                  ErrorCachingMinTTL: 60
                },
                {
                  ErrorCode: 502,
                  ResponseCode: 502,
                  ResponsePagePath: '/error.html',
                  ErrorCachingMinTTL: 60
                },
                {
                  ErrorCode: 503,
                  ResponseCode: 503,
                  ResponsePagePath: '/maintenance.html',
                  ErrorCachingMinTTL: 60
                }
              ],
              
              DefaultRootObject: 'index.html',
              
              // Conditional custom domain configuration
              Aliases: {
                'Fn::If': [
                  'HasCustomDomain',
                  [{ Ref: 'DomainName' }],
                  { Ref: 'AWS::NoValue' }
                ]
              },
              
              // Enhanced SSL/TLS configuration
              ViewerCertificate: {
                'Fn::If': [
                  'HasCertificate',
                  {
                    AcmCertificateArn: { Ref: 'CertificateArn' },
                    SslSupportMethod: 'sni-only',
                    MinimumProtocolVersion: 'TLSv1.2_2021',
                    CloudFrontDefaultCertificate: false
                  },
                  {
                    CloudFrontDefaultCertificate: true,
                    MinimumProtocolVersion: 'TLSv1.2_2021'
                  }
                ]
              },
              
              // Enhanced logging configuration
              Logging: {
                'Fn::If': [
                  { 'Fn::Or': [
                    { 'Fn::Equals': [{ Ref: 'Environment' }, 'production'] },
                    { 'Fn::Equals': [{ Ref: 'Environment' }, 'staging'] }
                  ]},
                  {
                    Bucket: {
                      'Fn::GetAtt': ['AccessLogsBucket', 'DomainName']
                    },
                    Prefix: 'cloudfront-logs/',
                    IncludeCookies: false
                  },
                  { Ref: 'AWS::NoValue' }
                ]
              },

              // Geo restrictions for enhanced security (if needed)
              Restrictions: {
                GeoRestriction: {
                  RestrictionType: 'none'
                }
              }
            },
            Tags: [
              {
                Key: 'Environment',
                Value: { Ref: 'Environment' }
              },
              {
                Key: 'Application',
                Value: 'WorkflowBuilder'
              },
              {
                Key: 'Component',
                Value: 'Frontend'
              },
              {
                Key: 'SecurityLevel',
                Value: {
                  'Fn::If': [
                    { 'Fn::Equals': [{ Ref: 'Environment' }, 'production'] },
                    'High',
                    'Standard'
                  ]
                }
              }
            ]
          }
        },
        
        // Enhanced S3 Bucket Policy for CloudFront access with security controls
        BucketPolicy: {
          Type: 'AWS::S3::BucketPolicy',
          Properties: {
            Bucket: {
              Ref: 'S3Bucket'
            },
            PolicyDocument: {
              Version: '2012-10-17',
              Statement: [
                {
                  Sid: 'AllowCloudFrontServicePrincipal',
                  Effect: 'Allow',
                  Principal: {
                    Service: 'cloudfront.amazonaws.com'
                  },
                  Action: 's3:GetObject',
                  Resource: {
                    'Fn::Sub': '${S3Bucket}/*'
                  },
                  Condition: {
                    StringEquals: {
                      'AWS:SourceArn': {
                        'Fn::Sub': 'arn:aws:cloudfront::${AWS::AccountId}:distribution/${CloudFrontDistribution}'
                      }
                    }
                  }
                },
                {
                  Sid: 'DenyInsecureConnections',
                  Effect: 'Deny',
                  Principal: '*',
                  Action: 's3:*',
                  Resource: [
                    {
                      'Fn::GetAtt': ['S3Bucket', 'Arn']
                    },
                    {
                      'Fn::Sub': '${S3Bucket}/*'
                    }
                  ],
                  Condition: {
                    Bool: {
                      'aws:SecureTransport': 'false'
                    }
                  }
                },
                {
                  Sid: 'DenyUnencryptedObjectUploads',
                  Effect: 'Deny',
                  Principal: '*',
                  Action: 's3:PutObject',
                  Resource: {
                    'Fn::Sub': '${S3Bucket}/*'
                  },
                  Condition: {
                    StringNotEquals: {
                      's3:x-amz-server-side-encryption': 'AES256'
                    }
                  }
                },
                {
                  Sid: 'DenyPublicReadACL',
                  Effect: 'Deny',
                  Principal: '*',
                  Action: [
                    's3:PutObject',
                    's3:PutObjectAcl'
                  ],
                  Resource: {
                    'Fn::Sub': '${S3Bucket}/*'
                  },
                  Condition: {
                    StringEquals: {
                      's3:x-amz-acl': [
                        'public-read',
                        'public-read-write',
                        'authenticated-read'
                      ]
                    }
                  }
                }
              ]
            }
          }
        },

        // CloudWatch Log Group for S3 access logging
        S3AccessLogGroup: {
          Type: 'AWS::Logs::LogGroup',
          Properties: {
            LogGroupName: {
              'Fn::Sub': '/aws/s3/workflow-builder-frontend-${Environment}'
            },
            RetentionInDays: environment === 'production' ? 365 : 30,
            Tags: [
              {
                Key: 'Environment',
                Value: { Ref: 'Environment' }
              },
              {
                Key: 'Application',
                Value: 'WorkflowBuilder'
              },
              {
                Key: 'Component',
                Value: 'Frontend-Logs'
              }
            ]
          }
        },

        // IAM Role for Frontend Deployment Lambda Functions
        FrontendDeploymentRole: {
          Type: 'AWS::IAM::Role',
          Properties: {
            RoleName: {
              'Fn::Sub': 'WorkflowBuilder-FrontendDeployment-${Environment}-Role'
            },
            AssumeRolePolicyDocument: {
              Version: '2012-10-17',
              Statement: [{
                Effect: 'Allow',
                Principal: {
                  Service: 'lambda.amazonaws.com'
                },
                Action: 'sts:AssumeRole'
              }]
            },
            ManagedPolicyArns: [
              'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'
            ],
            Policies: [{
              PolicyName: 'FrontendDeploymentPolicy',
              PolicyDocument: {
                Version: '2012-10-17',
                Statement: [
                  {
                    Sid: 'S3BucketAccess',
                    Effect: 'Allow',
                    Action: [
                      's3:GetObject',
                      's3:PutObject',
                      's3:DeleteObject',
                      's3:ListBucket',
                      's3:GetBucketLocation',
                      's3:GetBucketVersioning'
                    ],
                    Resource: [
                      {
                        'Fn::GetAtt': ['S3Bucket', 'Arn']
                      },
                      {
                        'Fn::Sub': '${S3Bucket}/*'
                      }
                    ]
                  },
                  {
                    Sid: 'CloudFrontAccess',
                    Effect: 'Allow',
                    Action: [
                      'cloudfront:GetDistribution',
                      'cloudfront:GetDistributionConfig',
                      'cloudfront:UpdateDistribution',
                      'cloudfront:CreateInvalidation',
                      'cloudfront:GetInvalidation',
                      'cloudfront:ListInvalidations'
                    ],
                    Resource: {
                      'Fn::Sub': 'arn:aws:cloudfront::${AWS::AccountId}:distribution/${CloudFrontDistribution}'
                    }
                  },
                  {
                    Sid: 'CloudFormationAccess',
                    Effect: 'Allow',
                    Action: [
                      'cloudformation:DescribeStacks',
                      'cloudformation:DescribeStackResources',
                      'cloudformation:GetTemplate'
                    ],
                    Resource: {
                      'Fn::Sub': 'arn:aws:cloudformation:${AWS::Region}:${AWS::AccountId}:stack/${AWS::StackName}/*'
                    }
                  },
                  {
                    Sid: 'LogsAccess',
                    Effect: 'Allow',
                    Action: [
                      'logs:CreateLogStream',
                      'logs:PutLogEvents',
                      'logs:DescribeLogGroups',
                      'logs:DescribeLogStreams'
                    ],
                    Resource: {
                      'Fn::GetAtt': ['S3AccessLogGroup', 'Arn']
                    }
                  }
                ]
              }
            }],
            Tags: [
              {
                Key: 'Environment',
                Value: { Ref: 'Environment' }
              },
              {
                Key: 'Application',
                Value: 'WorkflowBuilder'
              },
              {
                Key: 'Component',
                Value: 'Frontend-Deployment'
              }
            ]
          }
        }
      },
      
      Outputs: {
        S3BucketName: {
          Description: 'Name of the S3 bucket for frontend hosting',
          Value: {
            Ref: 'S3Bucket'
          },
          Export: {
            Name: {
              'Fn::Sub': '${AWS::StackName}-S3BucketName'
            }
          }
        },
        
        S3BucketArn: {
          Description: 'ARN of the S3 bucket',
          Value: {
            'Fn::GetAtt': ['S3Bucket', 'Arn']
          },
          Export: {
            Name: {
              'Fn::Sub': '${AWS::StackName}-S3BucketArn'
            }
          }
        },
        
        CloudFrontUrl: {
          Description: 'CloudFront distribution URL',
          Value: {
            'Fn::Sub': 'https://${CloudFrontDistribution.DomainName}'
          },
          Export: {
            Name: {
              'Fn::Sub': '${AWS::StackName}-CloudFrontUrl'
            }
          }
        },
        
        DistributionId: {
          Description: 'CloudFront distribution ID',
          Value: {
            Ref: 'CloudFrontDistribution'
          },
          Export: {
            Name: {
              'Fn::Sub': '${AWS::StackName}-DistributionId'
            }
          }
        },
        
        DistributionArn: {
          Description: 'CloudFront distribution ARN',
          Value: {
            'Fn::Sub': 'arn:aws:cloudfront::${AWS::AccountId}:distribution/${CloudFrontDistribution}'
          },
          Export: {
            Name: {
              'Fn::Sub': '${AWS::StackName}-DistributionArn'
            }
          }
        },
        
        CustomDomainUrl: {
          Description: 'Custom domain URL (if configured)',
          Value: {
            'Fn::If': [
              'HasCustomDomain',
              {
                'Fn::Sub': 'https://${DomainName}'
              },
              'Not configured'
            ]
          },
          Export: {
            Name: {
              'Fn::Sub': '${AWS::StackName}-CustomDomainUrl'
            }
          }
        },

        FrontendDeploymentRoleArn: {
          Description: 'ARN of the IAM role for frontend deployment Lambda functions',
          Value: {
            'Fn::GetAtt': ['FrontendDeploymentRole', 'Arn']
          },
          Export: {
            Name: {
              'Fn::Sub': '${AWS::StackName}-FrontendDeploymentRoleArn'
            }
          }
        },

        S3AccessLogGroupArn: {
          Description: 'ARN of the CloudWatch Log Group for S3 access logging',
          Value: {
            'Fn::GetAtt': ['S3AccessLogGroup', 'Arn']
          },
          Export: {
            Name: {
              'Fn::Sub': '${AWS::StackName}-S3AccessLogGroupArn'
            }
          }
        }
      }
    };

    // Add WAF and additional security resources for production environment
    if (environment === 'production') {
      // Web Application Firewall (WAF) for production
      (template.Resources as any).WebACL = {
        Type: 'AWS::WAFv2::WebACL',
        Properties: {
          Name: {
            'Fn::Sub': 'WorkflowBuilder-Frontend-WAF-${Environment}'
          },
          Description: 'WAF for WorkflowBuilder frontend protection',
          Scope: 'CLOUDFRONT',
          DefaultAction: {
            Allow: {}
          },
          Rules: [
            {
              Name: 'AWSManagedRulesCommonRuleSet',
              Priority: 1,
              OverrideAction: {
                None: {}
              },
              Statement: {
                ManagedRuleGroupStatement: {
                  VendorName: 'AWS',
                  Name: 'AWSManagedRulesCommonRuleSet'
                }
              },
              VisibilityConfig: {
                SampledRequestsEnabled: true,
                CloudWatchMetricsEnabled: true,
                MetricName: 'CommonRuleSetMetric'
              }
            },
            {
              Name: 'AWSManagedRulesKnownBadInputsRuleSet',
              Priority: 2,
              OverrideAction: {
                None: {}
              },
              Statement: {
                ManagedRuleGroupStatement: {
                  VendorName: 'AWS',
                  Name: 'AWSManagedRulesKnownBadInputsRuleSet'
                }
              },
              VisibilityConfig: {
                SampledRequestsEnabled: true,
                CloudWatchMetricsEnabled: true,
                MetricName: 'KnownBadInputsRuleSetMetric'
              }
            },
            {
              Name: 'RateLimitRule',
              Priority: 3,
              Action: {
                Block: {}
              },
              Statement: {
                RateBasedStatement: {
                  Limit: 2000,
                  AggregateKeyType: 'IP'
                }
              },
              VisibilityConfig: {
                SampledRequestsEnabled: true,
                CloudWatchMetricsEnabled: true,
                MetricName: 'RateLimitRuleMetric'
              }
            }
          ],
          VisibilityConfig: {
            SampledRequestsEnabled: true,
            CloudWatchMetricsEnabled: true,
            MetricName: 'WorkflowBuilderFrontendWAF'
          },
          Tags: [
            {
              Key: 'Environment',
              Value: { Ref: 'Environment' }
            },
            {
              Key: 'Application',
              Value: 'WorkflowBuilder'
            },
            {
              Key: 'Component',
              Value: 'Frontend-WAF'
            }
          ]
        }
      };

      // Trusted Key Group for signed URLs (if needed for premium features)
      (template.Resources as any).TrustedKeyGroup = {
        Type: 'AWS::CloudFront::KeyGroup',
        Properties: {
          KeyGroupConfig: {
            Name: {
              'Fn::Sub': 'WorkflowBuilder-TrustedKeys-${Environment}'
            },
            Comment: 'Trusted key group for WorkflowBuilder frontend',
            Items: [
              {
                Ref: 'PublicKey'
              }
            ]
          }
        }
      };

      // Public Key for trusted key group
      (template.Resources as any).PublicKey = {
        Type: 'AWS::CloudFront::PublicKey',
        Properties: {
          PublicKeyConfig: {
            Name: {
              'Fn::Sub': 'WorkflowBuilder-PublicKey-${Environment}'
            },
            Comment: 'Public key for WorkflowBuilder signed URLs',
            CallerReference: {
              'Fn::Sub': '${AWS::StackName}-${AWS::AccountId}-${Environment}'
            },
            EncodedKey: 'LS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS0KTUlJQklqQU5CZ2txaGtpRzl3MEJBUUVGQUFPQ0FROEFNSUlCQ2dLQ0FRRUF0V0N6dkVtWjBHcjBhQnNVCi0tLS0tRU5EIFBVQkxJQyBLRVktLS0tLQ==' // Placeholder - should be replaced with actual key
          }
        }
      };
    }

    // Add access logs bucket for production and staging environments
    if (environment === 'production' || environment === 'staging') {
      (template.Resources as any).AccessLogsBucket = {
        Type: 'AWS::S3::Bucket',
        Properties: {
          BucketName: {
            'Fn::Sub': `workflow-builder-frontend-logs-\${Environment}-\${AWS::AccountId}`
          },
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: true,
            BlockPublicPolicy: true,
            IgnorePublicAcls: true,
            RestrictPublicBuckets: true
          },
          LifecycleConfiguration: {
            Rules: [{
              Id: 'DeleteOldLogs',
              Status: 'Enabled',
              ExpirationInDays: 90
            }]
          },
          Tags: [
            {
              Key: 'Environment',
              Value: { Ref: 'Environment' }
            },
            {
              Key: 'Application',
              Value: 'WorkflowBuilder'
            },
            {
              Key: 'Component',
              Value: 'Frontend-Logs'
            }
          ]
        }
      };
    }

    return template;
  }

  /**
   * Generate stack name for frontend infrastructure
   */
  static generateStackName(environment: string, userId?: string): string {
    const suffix = userId ? `-${userId.substring(0, 8)}` : '';
    return `workflow-builder-frontend-${environment}${suffix}`;
  }

  /**
   * Generate resource names for frontend infrastructure
   */
  static generateResourceNames(environment: string, accountId: string) {
    return {
      s3BucketName: `workflow-builder-frontend-${environment}-${accountId}`,
      accessLogsBucketName: `workflow-builder-frontend-logs-${environment}-${accountId}`,
      originAccessControlName: `OAC-${environment}-${accountId}`,
      distributionComment: `Frontend distribution for ${environment} environment`
    };
  }

  /**
   * Validate template parameters
   */
  static validateParameters(params: FrontendInfrastructureTemplateParams): void {
    const { environment, domainName, certificateArn } = params;
    
    if (!['development', 'staging', 'production'].includes(environment)) {
      throw new Error(`Invalid environment: ${environment}. Must be development, staging, or production.`);
    }
    
    if (domainName && !certificateArn) {
      throw new Error('Certificate ARN is required when custom domain is specified');
    }
    
    if (certificateArn && !domainName) {
      throw new Error('Domain name is required when certificate ARN is specified');
    }
    
    if (domainName && !/^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$/.test(domainName)) {
      throw new Error('Invalid domain name format');
    }
    
    if (certificateArn && !certificateArn.startsWith('arn:aws:acm:')) {
      throw new Error('Invalid certificate ARN format');
    }
  }
}