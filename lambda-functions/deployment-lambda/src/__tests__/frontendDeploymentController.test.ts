import { APIGatewayProxyEvent } from 'aws-lambda';
import { 
  deployFrontend, 
  getFrontendDeploymentStatus, 
  rollbackFrontendDeployment,
  listFrontendDeployments 
} from '../handlers/frontendDeploymentController';
import { FrontendDeploymentService } from '../services/frontendDeploymentService';

// Mock the FrontendDeploymentService
jest.mock('../services/frontendDeploymentService');

describe('Frontend Deployment Controller', () => {
  let mockDeploymentService: jest.Mocked<FrontendDeploymentService>;

  beforeEach(() => {
    mockDeploymentService = new FrontendDeploymentService() as jest.Mocked<FrontendDeploymentService>;
    (FrontendDeploymentService as jest.Mock).mockImplementation(() => mockDeploymentService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('deployFrontend', () => {
    it('should successfully initiate frontend deployment', async () => {
      const mockResult = {
        deploymentId: 'frontend-123456789-abc123',
        environment: 'production',
        status: 'pending' as const,
        s3BucketName: 'test-bucket',
        buildLogs: [],
        deploymentLogs: ['Deployment initiated'],
        createdAt: '2023-01-01T00:00:00.000Z'
      };

      mockDeploymentService.deployFrontend.mockResolvedValue(mockResult);

      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        body: JSON.stringify({
          environment: 'production',
          domainName: 'example.com'
        }),
        requestContext: {
          authorizer: {
            claims: {
              sub: 'user-123'
            }
          }
        } as any
      };

      const result = await deployFrontend(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(202);
      expect(JSON.parse(result.body)).toEqual({
        success: true,
        data: mockResult,
        message: 'Frontend deployment initiated successfully'
      });

      expect(mockDeploymentService.deployFrontend).toHaveBeenCalledWith({
        environment: 'production',
        domainName: 'example.com',
        userId: 'user-123'
      });
    });

    it('should return 401 when user ID is missing', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        body: JSON.stringify({
          environment: 'production'
        }),
        requestContext: {} as any
      };

      const result = await deployFrontend(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body)).toEqual({
        success: false,
        error: 'Unauthorized: User ID not found in token'
      });
    });

    it('should return 400 for invalid request body', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        body: 'invalid json',
        requestContext: {
          authorizer: {
            claims: {
              sub: 'user-123'
            }
          }
        } as any
      };

      const result = await deployFrontend(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body)).toEqual({
        success: false,
        error: 'Invalid JSON in request body'
      });
    });

    it('should return 400 for missing required fields', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        body: JSON.stringify({}), // Missing environment
        requestContext: {
          authorizer: {
            claims: {
              sub: 'user-123'
            }
          }
        } as any
      };

      const result = await deployFrontend(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body)).toEqual({
        success: false,
        error: 'Invalid deployment request format',
        details: 'Required fields: environment'
      });
    });

    it('should handle deployment service errors', async () => {
      mockDeploymentService.deployFrontend.mockRejectedValue(new Error('Deployment failed'));

      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        body: JSON.stringify({
          environment: 'production'
        }),
        requestContext: {
          authorizer: {
            claims: {
              sub: 'user-123'
            }
          }
        } as any
      };

      const result = await deployFrontend(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body)).toEqual({
        success: false,
        error: 'Internal server error',
        message: 'Deployment failed'
      });
    });
  });

  describe('getFrontendDeploymentStatus', () => {
    it('should successfully retrieve deployment status', async () => {
      const mockStatus = {
        deploymentId: 'frontend-123456789-abc123',
        environment: 'production',
        status: 'completed' as const,
        progress: {
          currentStep: 'Completed',
          completedSteps: ['build', 'upload', 'configure'],
          totalSteps: 3,
          percentage: 100
        },
        s3BucketName: 'test-bucket',
        cloudFrontUrl: 'https://d123.cloudfront.net',
        logs: [],
        createdAt: '2023-01-01T00:00:00.000Z',
        updatedAt: '2023-01-01T00:05:00.000Z',
        completedAt: '2023-01-01T00:05:00.000Z'
      };

      mockDeploymentService.getFrontendDeploymentStatus.mockResolvedValue(mockStatus);

      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'GET',
        pathParameters: {
          deploymentId: 'frontend-123456789-abc123'
        },
        requestContext: {
          authorizer: {
            claims: {
              sub: 'user-123'
            }
          }
        } as any
      };

      const result = await getFrontendDeploymentStatus(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({
        success: true,
        data: mockStatus,
        message: 'Frontend deployment status retrieved successfully'
      });

      expect(mockDeploymentService.getFrontendDeploymentStatus).toHaveBeenCalledWith('frontend-123456789-abc123');
    });

    it('should return 404 when deployment not found', async () => {
      mockDeploymentService.getFrontendDeploymentStatus.mockRejectedValue(
        new Error('Frontend deployment not found: invalid-id')
      );

      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'GET',
        pathParameters: {
          deploymentId: 'invalid-id'
        },
        requestContext: {
          authorizer: {
            claims: {
              sub: 'user-123'
            }
          }
        } as any
      };

      const result = await getFrontendDeploymentStatus(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body)).toEqual({
        success: false,
        error: 'Deployment not found',
        message: 'Frontend deployment not found: invalid-id'
      });
    });

    it('should return 400 when deployment ID is missing', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'GET',
        pathParameters: {},
        requestContext: {
          authorizer: {
            claims: {
              sub: 'user-123'
            }
          }
        } as any
      };

      const result = await getFrontendDeploymentStatus(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body)).toEqual({
        success: false,
        error: 'Deployment ID is required'
      });
    });
  });

  describe('rollbackFrontendDeployment', () => {
    it('should successfully rollback deployment', async () => {
      mockDeploymentService.rollbackFrontendDeployment.mockResolvedValue({
        deploymentId: 'rollback-123456789-abc123',
        status: 'completed',
        environment: 'development',
        s3BucketName: 'test-bucket',
        distributionId: 'test-distribution',
        buildLogs: [],
        deploymentLogs: [],
        createdAt: '2023-01-01T00:00:00Z',
        completedAt: '2023-01-01T01:00:00Z'
      });

      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        pathParameters: {
          deploymentId: 'frontend-123456789-abc123'
        },
        requestContext: {
          authorizer: {
            claims: {
              sub: 'user-123'
            }
          }
        } as any
      };

      const result = await rollbackFrontendDeployment(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({
        success: true,
        message: 'Frontend deployment rollback completed successfully'
      });

      expect(mockDeploymentService.rollbackFrontendDeployment).toHaveBeenCalledWith('frontend-123456789-abc123');
    });

    it('should return 400 for invalid rollback request', async () => {
      mockDeploymentService.rollbackFrontendDeployment.mockRejectedValue(
        new Error('Cannot rollback deployment in status: pending')
      );

      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        pathParameters: {
          deploymentId: 'frontend-123456789-abc123'
        },
        requestContext: {
          authorizer: {
            claims: {
              sub: 'user-123'
            }
          }
        } as any
      };

      const result = await rollbackFrontendDeployment(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body)).toEqual({
        success: false,
        error: 'Invalid rollback request',
        message: 'Cannot rollback deployment in status: pending'
      });
    });
  });

  describe('listFrontendDeployments', () => {
    it('should successfully list deployments', async () => {
      const mockDeployments = {
        deployments: [
          {
            deploymentId: 'frontend-123456789-abc123',
            environment: 'production',
            status: 'completed' as const,
            progress: {
              currentStep: 'Completed',
              completedSteps: ['build', 'upload', 'configure'],
              totalSteps: 3,
              percentage: 100
            },
            logs: [],
            createdAt: '2023-01-01T00:00:00.000Z',
            updatedAt: '2023-01-01T00:05:00.000Z'
          }
        ],
        lastKey: undefined
      };

      mockDeploymentService.listFrontendDeployments.mockResolvedValue(mockDeployments);

      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'GET',
        queryStringParameters: {
          environment: 'production',
          limit: '10'
        },
        requestContext: {
          authorizer: {
            claims: {
              sub: 'user-123'
            }
          }
        } as any
      };

      const result = await listFrontendDeployments(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({
        success: true,
        data: mockDeployments,
        message: 'Frontend deployments retrieved successfully'
      });

      expect(mockDeploymentService.listFrontendDeployments).toHaveBeenCalledWith('user-123', {
        environment: 'production',
        limit: 10,
        lastKey: undefined
      });
    });
  });
});