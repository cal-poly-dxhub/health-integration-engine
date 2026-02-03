// Jest setup file for deployment Lambda tests
// This file runs before each test suite

// Mock AWS SDK
jest.mock('aws-sdk', () => ({
  Lambda: jest.fn(() => ({
    createFunction: jest.fn(),
    updateFunctionCode: jest.fn(),
    updateFunctionConfiguration: jest.fn(),
    deleteFunction: jest.fn(),
    getFunction: jest.fn(),
  })),
  IAM: jest.fn(() => ({
    createRole: jest.fn(),
    attachRolePolicy: jest.fn(),
    putRolePolicy: jest.fn(),
    deleteRole: jest.fn(),
    getRole: jest.fn(),
  })),
  StepFunctions: jest.fn(() => ({
    createStateMachine: jest.fn(),
    updateStateMachine: jest.fn(),
    deleteStateMachine: jest.fn(),
    describeStateMachine: jest.fn(),
    startExecution: jest.fn(),
  })),
  DynamoDB: {
    DocumentClient: jest.fn(() => ({
      get: jest.fn(),
      put: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      query: jest.fn(),
      scan: jest.fn(),
    })),
  },
  config: {
    update: jest.fn(),
  },
}));

// Mock environment variables
process.env.DYNAMODB_TABLE_NAME = 'test-deployments-table';
process.env.AWS_REGION = 'us-east-1';
process.env.NODE_ENV = 'test';

// Global test timeout
jest.setTimeout(15000);