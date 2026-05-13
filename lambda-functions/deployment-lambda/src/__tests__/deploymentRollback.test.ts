import { DeploymentRollbackService } from '../services/deploymentRollbackService';
import { FrontendDeploymentStatus } from '../types/frontend';

// Mock AWS services
jest.mock('aws-sdk', () => ({
  S3: jest.fn(() => ({
    listObjectsV2: jest.fn(() => ({
      promise: jest.fn(() => Promise.resolve({
        Contents: [
          { Key: 'index.html' },
          { Key: 'static/js/main.js' },
          { Key: 'static/css/main.css' }
        ]
      }))
    })),
    copyObject: jest.fn(() => ({
      promise: jest.fn(() => Promise.resolve({}))
    })),
    deleteObjects: jest.fn(() => ({
      promise: jest.fn(() => Promise.resolve({ Deleted: [] }))
    }))
  }))
}));

// Mock other services
jest.mock('../services/s3UploadService');
jest.mock('../services/cloudFrontService');
jest.mock('../utils/frontendDeploymentDatabase');
jest.mock('../services/deploymentNotificationService');
jest.mock('../utils/deploymentStatusTracker');
jest.mock('../utils/deploymentLogger');

describe('DeploymentRollbackService', () => {
  let rollbackService: DeploymentRollbackService;
  
  beforeEach(() => {
    rollbackService = new DeploymentRollbackService('us-east-1', 'ws://test');
  });

  describe('rollbackDeployment', () => {
    it('should successfully rollback a deployment', async () => {
      // Mock the database methods
      const mockCurrentDeployment: FrontendDeploymentStatus = {
        deploymentId: 'current-deployment-123',
        environment: 'production',
        status: 'completed',
        s3BucketName: 'test-bucket',
        distributionId: 'test-distribution',
        progress: {
          currentStep: 'Completed',
          completedSteps: [],
          totalSteps: 7,
          percentage: 100
        },
        logs: [],
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-01T01:00:00Z',
        completedAt: '2023-01-01T01:00:00Z'
      };

      const mockPreviousDeployment: FrontendDeploymentStatus = {
        deploymentId: 'previous-deployment-456',
        environment: 'production',
        status: 'completed',
        s3BucketName: 'test-bucket',
        distributionId: 'test-distribution',
        progress: {
          currentStep: 'Completed',
          completedSteps: [],
          totalSteps: 7,
          percentage: 100
        },
        logs: [],
        createdAt: '2022-12-31T00:00:00Z',
        updatedAt: '2022-12-31T01:00:00Z',
        completedAt: '2022-12-31T01:00:00Z'
      };

      // Mock database methods
      jest.spyOn(rollbackService['database'], 'getFrontendDeploymentStatus')
        .mockResolvedValue(mockCurrentDeployment);
      
      jest.spyOn(rollbackService['historyTracker'], 'findPreviousSuccessfulDeployment')
        .mockResolvedValue(mockPreviousDeployment);

      jest.spyOn(rollbackService['database'], 'saveFrontendDeploymentStatus')
        .mockResolvedValue();

      jest.spyOn(rollbackService['historyTracker'], 'recordDeploymentStart')
        .mockResolvedValue();

      jest.spyOn(rollbackService['historyTracker'], 'recordStepCompletion')
        .mockResolvedValue();

      jest.spyOn(rollbackService['historyTracker'], 'recordDeploymentCompletion')
        .mockResolvedValue();

      jest.spyOn(rollbackService['s3Service'], 'clearBucket')
        .mockResolvedValue();

      jest.spyOn(rollbackService['cloudFrontService'], 'invalidateCache')
        .mockResolvedValue(undefined);

      jest.spyOn(rollbackService['notificationService'], 'notifyRollbackCompleted')
        .mockResolvedValue(undefined);

      // Execute rollback
      const result = await rollbackService.rollbackDeployment(
        'current-deployment-123',
        'test-user',
        'test@example.com'
      );

      // Verify result
      expect(result.status).toBe('completed');
      expect(result.environment).toBe('production');
      expect(result.s3BucketName).toBe('test-bucket');
      expect(result.buildLogs).toContain('Rollback from current-deployment-123 to previous-deployment-456');
    });

    it('should throw error when no previous deployment is found', async () => {
      const mockCurrentDeployment: FrontendDeploymentStatus = {
        deploymentId: 'current-deployment-123',
        environment: 'production',
        status: 'completed',
        s3BucketName: 'test-bucket',
        distributionId: 'test-distribution',
        progress: {
          currentStep: 'Completed',
          completedSteps: [],
          totalSteps: 7,
          percentage: 100
        },
        logs: [],
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-01T01:00:00Z',
        completedAt: '2023-01-01T01:00:00Z'
      };

      jest.spyOn(rollbackService['database'], 'getFrontendDeploymentStatus')
        .mockResolvedValue(mockCurrentDeployment);
      
      jest.spyOn(rollbackService['historyTracker'], 'findPreviousSuccessfulDeployment')
        .mockResolvedValue(null);

      await expect(rollbackService.rollbackDeployment('current-deployment-123', 'test-user'))
        .rejects.toThrow('No previous successful deployment found for rollback');
    });

    it('should throw error when deployment is not in completed status', async () => {
      const mockCurrentDeployment: FrontendDeploymentStatus = {
        deploymentId: 'current-deployment-123',
        environment: 'production',
        status: 'pending',
        progress: {
          currentStep: 'Building',
          completedSteps: [],
          totalSteps: 7,
          percentage: 20
        },
        logs: [],
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-01T00:30:00Z'
      };

      jest.spyOn(rollbackService['database'], 'getFrontendDeploymentStatus')
        .mockResolvedValue(mockCurrentDeployment);

      await expect(rollbackService.rollbackDeployment('current-deployment-123', 'test-user'))
        .rejects.toThrow('Cannot rollback deployment in status: pending');
    });
  });

  describe('getAvailableRollbackTargets', () => {
    it('should return list of available rollback targets', async () => {
      const mockDeployments: FrontendDeploymentStatus[] = [
        {
          deploymentId: 'deployment-1',
          environment: 'production',
          status: 'completed',
          s3BucketName: 'test-bucket',
          distributionId: 'test-distribution',
          progress: { currentStep: 'Completed', completedSteps: [], totalSteps: 7, percentage: 100 },
          logs: [],
          createdAt: '2023-01-01T00:00:00Z',
          updatedAt: '2023-01-01T01:00:00Z',
          completedAt: '2023-01-01T01:00:00Z'
        },
        {
          deploymentId: 'deployment-2',
          environment: 'production',
          status: 'completed',
          s3BucketName: 'test-bucket',
          distributionId: 'test-distribution',
          progress: { currentStep: 'Completed', completedSteps: [], totalSteps: 7, percentage: 100 },
          logs: [],
          createdAt: '2023-01-02T00:00:00Z',
          updatedAt: '2023-01-02T01:00:00Z',
          completedAt: '2023-01-02T01:00:00Z'
        }
      ];

      jest.spyOn(rollbackService['historyTracker'], 'getDeploymentHistory')
        .mockResolvedValue(mockDeployments);

      const targets = await rollbackService.getAvailableRollbackTargets(
        'test-user',
        'production',
        'current-deployment'
      );

      expect(targets).toHaveLength(2);
      expect(targets[0].deploymentId).toBe('deployment-1');
      expect(targets[1].deploymentId).toBe('deployment-2');
    });
  });

  describe('storeDeploymentVersion', () => {
    it('should successfully store deployment version for rollback', async () => {
      jest.spyOn(rollbackService['historyTracker'], 'recordStepCompletion')
        .mockResolvedValue();

      await expect(rollbackService.storeDeploymentVersion(
        'test-deployment',
        'test-bucket',
        'test-user'
      )).resolves.not.toThrow();
    });
  });
});