/**
 * Deployment configuration for switching between real AWS deployment and mock deployment
 */

export interface DeploymentConfig {
  USE_REAL_API: boolean;
  POLLING: {
    MAX_ATTEMPTS: number;
    INTERVAL_MS: number;
    MOCK_INTERVAL_MS: number;
  };
  MOCK_STEP_TIMINGS: {
    [key: string]: number;
  };
}

export const DEPLOYMENT_CONFIG: DeploymentConfig = {
  // Set to true to use real AWS deployment, false for mock
  USE_REAL_API: true, // Enable real deployment by default
  
  POLLING: {
    MAX_ATTEMPTS: 60,
    INTERVAL_MS: 5000, // 5 seconds for real deployment
    MOCK_INTERVAL_MS: 2000, // 2 seconds for mock deployment
  },
  
  MOCK_STEP_TIMINGS: {
    'iam-roles': 3000,
    'lambda-functions': 5000,
    'log-groups': 2000,
    'step-function': 4000,
    'validation': 2000,
  },
};

/**
 * Check if real AWS deployment should be used
 */
export function shouldUseRealAPI(): boolean {
  // Check environment variable first
  if (typeof window !== 'undefined' && (window as any).REACT_APP_USE_REAL_DEPLOYMENT) {
    return (window as any).REACT_APP_USE_REAL_DEPLOYMENT === 'true';
  }
  
  // Check localStorage override
  if (typeof window !== 'undefined') {
    const override = localStorage.getItem('USE_REAL_DEPLOYMENT');
    if (override !== null) {
      return override === 'true';
    }
  }
  
  // Default to config value
  return DEPLOYMENT_CONFIG.USE_REAL_API;
}

/**
 * Enable real AWS deployment
 */
export function enableRealDeployment(): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('USE_REAL_DEPLOYMENT', 'true');
  }
  console.log('🚀 Real AWS deployment enabled');
}

/**
 * Enable mock deployment
 */
export function enableMockDeployment(): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('USE_REAL_DEPLOYMENT', 'false');
  }
  console.log('🎭 Mock deployment enabled');
}

/**
 * Get current deployment mode
 */
export function getDeploymentMode(): 'real' | 'mock' {
  return shouldUseRealAPI() ? 'real' : 'mock';
}