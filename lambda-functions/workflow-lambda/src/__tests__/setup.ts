// Jest setup file for workflow Lambda tests
// This file runs before each test suite
//
// NOTE: the workflow Lambda uses AWS SDK v3 (@aws-sdk/client-*). There is no
// global aws-sdk (v2) mock here because the runtime code does not depend on
// aws-sdk v2; individual tests mock the specific v3 clients they exercise.

// Mock environment variables
process.env.DYNAMODB_TABLE_NAME = 'test-workflows-table';
process.env.AWS_REGION = 'us-east-1';
process.env.NODE_ENV = 'test';

// Global test timeout
jest.setTimeout(10000);