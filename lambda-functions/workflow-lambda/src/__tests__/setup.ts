// Jest setup file for workflow Lambda tests
// This file runs before each test suite

// Mock AWS SDK
jest.mock('aws-sdk', () => ({
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
process.env.DYNAMODB_TABLE_NAME = 'test-workflows-table';
process.env.AWS_REGION = 'us-east-1';
process.env.NODE_ENV = 'test';

// Global test timeout
jest.setTimeout(10000);