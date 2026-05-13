export interface DeploymentUpdate {
  deploymentId: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  message: string;
  timestamp: string;
  executionArn?: string;
  originalStatus?: string; // Include original detailed status for step tracking
}

export interface DeploymentStepUpdate {
  deploymentId: string;
  step: {
    stepId: string;
    stepName: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
    startTime?: string;
    endTime?: string;
    duration?: number;
    error?: any;
    allSteps?: any[];
  };
  timestamp: string;
}

export interface WebSocketMessage {
  type: 'deployment_progress' | 'deployment_step_progress' | 'workflow_deletion_update' | 'error' | 'ping';
  deploymentId?: string;
  workflowId?: string;
  userId?: string;
  status?: string;
  message?: string;
  timestamp?: string;
  executionArn?: string;
  step?: any;
  originalStatus?: string; // Include original detailed status
}

/**
 * Simplified WebSocket service following AWS sample pattern
 * Connects to WebSocket and listens for deployment progress updates
 */
export class WebSocketService {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private listeners: Map<string, Set<(update: DeploymentUpdate) => void>> = new Map();
  private stepListeners: Map<string, Set<(update: DeploymentStepUpdate) => void>> = new Map();
  private deletionListeners: Map<string, Set<(update: any) => void>> = new Map();
  private connectionPromise: Promise<void> | null = null;

  constructor(private webSocketUrl: string) {}

  /**
   * Connect to WebSocket - simplified approach following AWS sample
   * Prevents multiple simultaneous connections
   */
  connect(deploymentId?: string, userId?: string): Promise<void> {
    // If already connected, return resolved promise
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    // If connection is in progress, return existing promise
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    // Create new connection promise
    this.connectionPromise = new Promise((resolve, reject) => {
      try {
        // Build WebSocket URL with query parameters
        let wsUrl = this.webSocketUrl;
        const params = new URLSearchParams();
        
        if (deploymentId) {
          params.append('deploymentId', deploymentId);
        }
        if (userId) {
          params.append('userId', userId);
        }
        
        if (params.toString()) {
          wsUrl += `?${params.toString()}`;
        }
        
        console.log('Connecting to WebSocket:', wsUrl);
        
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          console.log('WebSocket connected successfully to:', wsUrl);
          this.reconnectAttempts = 0;
          this.connectionPromise = null; // Clear connection promise
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message: WebSocketMessage = JSON.parse(event.data);
            console.log('WebSocket message received:', message);
            
            // Handle ping messages to keep connection alive
            if (message.type === 'ping') {
              console.log('Received ping from server');
              return;
            }
            
            if (message.type === 'deployment_progress' && message.deploymentId) {
              this.handleDeploymentUpdate({
                deploymentId: message.deploymentId,
                status: message.status as any || 'PENDING',
                message: message.message || 'Status updated',
                timestamp: message.timestamp || new Date().toISOString(),
                executionArn: message.executionArn,
                originalStatus: message.originalStatus, // Pass through original status
              });
            } else if (message.type === 'deployment_step_progress' && message.deploymentId && message.step) {
              this.handleDeploymentStepUpdate({
                deploymentId: message.deploymentId,
                step: message.step,
                timestamp: message.timestamp || new Date().toISOString(),
              });
            } else if (message.type === 'workflow_deletion_update' && message.workflowId) {
              console.log('🔍 Processing workflow_deletion_update message:', message);
              
              const deletionUpdate = {
                workflowId: message.workflowId,
                userId: message.userId,
                status: message.status || 'deleting',
                message: message.message || 'Deletion status updated',
                timestamp: message.timestamp || new Date().toISOString(),
              };
              
              console.log('🔍 Created deletion update:', deletionUpdate);
              
              // Handle as deletion update
              this.handleDeletionUpdate(deletionUpdate);
              
              // ALSO handle as deployment update for DeploymentStatusModal
              // Convert deletion update to deployment update format
              try {
                const deploymentUpdate: DeploymentUpdate = {
                  deploymentId: message.workflowId, // Use workflowId as deploymentId for deletion
                  status: this.mapDeletionStatusToDeploymentStatus(message.status || 'deleting'),
                  message: message.message || 'Deletion status updated',
                  timestamp: message.timestamp || new Date().toISOString(),
                  originalStatus: message.status || 'deleting',
                };
                
                console.log('🔄 Converting deletion update to deployment update:', deploymentUpdate);
                this.handleDeploymentUpdate(deploymentUpdate);
                console.log('✅ Deployment update handled successfully');
              } catch (error) {
                console.error('❌ Error converting deletion to deployment update:', error);
              }
            } else if (message.type === 'error') {
              console.error('WebSocket server error:', message.message);
            }
          } catch (error) {
            console.error('Error parsing WebSocket message:', error);
          }
        };

        this.ws.onclose = (event) => {
          console.log('WebSocket connection closed:', event.code, event.reason);
          this.connectionPromise = null; // Clear connection promise
          this.handleReconnect();
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket connection error:', error);
          this.connectionPromise = null; // Clear connection promise
          reject(error);
        };

      } catch (error) {
        console.error('Failed to create WebSocket connection:', error);
        this.connectionPromise = null; // Clear connection promise
        reject(error);
      }
    });

    return this.connectionPromise;
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    if (this.ws) {
      console.log('Disconnecting WebSocket...');
      this.ws.close();
      this.ws = null;
    }
    this.connectionPromise = null; // Clear connection promise
  }

  /**
   * Subscribe to deployment updates - simplified approach
   */
  subscribeToDeployment(deploymentId: string, callback: (update: DeploymentUpdate) => void, userId?: string): void {
    console.log(`Subscribing to deployment updates: ${deploymentId}`);
    
    // Add callback to listeners first
    if (!this.listeners.has(deploymentId)) {
      this.listeners.set(deploymentId, new Set());
    }
    
    this.listeners.get(deploymentId)!.add(callback);
    
    // Only connect if not already connected or connecting
    if (!this.isConnected() && !this.connectionPromise) {
      this.connect(deploymentId, userId).catch(error => {
        console.error('Failed to connect WebSocket for deployment subscription:', error);
      });
    } else {
      console.log('WebSocket already connected, reusing existing connection');
    }
  }

  /**
   * Unsubscribe from deployment updates
   */
  unsubscribeFromDeployment(deploymentId: string, callback?: (update: DeploymentUpdate) => void): void {
    console.log(`Unsubscribing from deployment updates: ${deploymentId}`);
    
    const listeners = this.listeners.get(deploymentId);
    if (listeners) {
      if (callback) {
        listeners.delete(callback);
      } else {
        listeners.clear();
      }
      
      if (listeners.size === 0) {
        this.listeners.delete(deploymentId);
      }
    }
  }

  /**
   * Subscribe to deployment step updates
   */
  subscribeToDeploymentSteps(deploymentId: string, callback: (update: DeploymentStepUpdate) => void): void {
    console.log(`Subscribing to deployment step updates: ${deploymentId}`);
    
    if (!this.stepListeners.has(deploymentId)) {
      this.stepListeners.set(deploymentId, new Set());
    }
    
    this.stepListeners.get(deploymentId)!.add(callback);
  }

  /**
   * Unsubscribe from deployment step updates
   */
  unsubscribeFromDeploymentSteps(deploymentId: string, callback?: (update: DeploymentStepUpdate) => void): void {
    console.log(`Unsubscribing from deployment step updates: ${deploymentId}`);
    
    const listeners = this.stepListeners.get(deploymentId);
    if (listeners) {
      if (callback) {
        listeners.delete(callback);
      } else {
        listeners.clear();
      }
      
      if (listeners.size === 0) {
        this.stepListeners.delete(deploymentId);
      }
    }
  }

  /**
   * Subscribe to workflow deletion updates
   */
  subscribeToDeletion(workflowId: string, callback: (update: any) => void): void {
    console.log(`Subscribing to deletion updates: ${workflowId}`);
    
    if (!this.deletionListeners.has(workflowId)) {
      this.deletionListeners.set(workflowId, new Set());
    }
    
    this.deletionListeners.get(workflowId)!.add(callback);
  }

  /**
   * Unsubscribe from workflow deletion updates
   */
  unsubscribeFromDeletion(workflowId: string, callback?: (update: any) => void): void {
    console.log(`Unsubscribing from deletion updates: ${workflowId}`);
    
    const listeners = this.deletionListeners.get(workflowId);
    if (listeners) {
      if (callback) {
        listeners.delete(callback);
      } else {
        listeners.clear();
      }
      
      if (listeners.size === 0) {
        this.deletionListeners.delete(workflowId);
      }
    }
  }

  /**
   * Handle deployment update - simplified approach following AWS sample
   */
  private handleDeploymentUpdate(update: DeploymentUpdate): void {
    console.log(`🔍 Handling deployment update for ${update.deploymentId}:`, update);
    console.log(`🔍 Available listeners:`, Array.from(this.listeners.keys()));
    
    const listeners = this.listeners.get(update.deploymentId);
    console.log(`🔍 Found ${listeners?.size || 0} listeners for deploymentId: ${update.deploymentId}`);
    
    if (listeners) {
      listeners.forEach(callback => {
        try {
          console.log(`📤 Calling deployment update callback`);
          callback(update);
        } catch (error) {
          console.error('Error in deployment update callback:', error);
        }
      });
    }
  }

  /**
   * Handle deployment step update
   */
  private handleDeploymentStepUpdate(update: DeploymentStepUpdate): void {
    console.log(`Handling deployment step update for ${update.deploymentId}:`, update);
    
    const listeners = this.stepListeners.get(update.deploymentId);
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback(update);
        } catch (error) {
          console.error('Error in deployment step update callback:', error);
        }
      });
    }
  }

  /**
   * Handle deletion update
   */
  private handleDeletionUpdate(update: any): void {
    console.log(`Handling deletion update for ${update.workflowId}:`, update);
    
    const listeners = this.deletionListeners.get(update.workflowId);
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback(update);
        } catch (error) {
          console.error('Error in deletion update callback:', error);
        }
      });
    }
  }

  /**
   * Map deletion status to deployment status for DeploymentStatusModal compatibility
   */
  private mapDeletionStatusToDeploymentStatus(deletionStatus: string): 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' {
    switch (deletionStatus) {
      case 'deleting':
      case 'deleting_aws_resources':
      case 'aws_resources_deleted':
      case 'aws_cleanup_failed':
      case 'cleaning_database':
        return 'IN_PROGRESS';
      case 'completed':
        return 'COMPLETED';
      case 'failed':
        return 'FAILED';
      default:
        return 'IN_PROGRESS';
    }
  }

  /**
   * Handle reconnection
   */
  private handleReconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
      
      console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay}ms`);
      
      setTimeout(() => {
        this.connect().catch(error => {
          console.error('Reconnection failed:', error);
        });
      }, delay);
    } else {
      console.error('Max reconnection attempts reached');
    }
  }

  /**
   * Check if WebSocket is connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}

// Singleton instance
let webSocketService: WebSocketService | null = null;

export const getWebSocketService = (): WebSocketService | null => {
  if (!webSocketService) {
    // Get WebSocket URL from environment
    const webSocketUrl = import.meta.env.VITE_WEBSOCKET_URL;
    if (!webSocketUrl) {
      console.error('VITE_WEBSOCKET_URL environment variable not set');
      return null;
    }
    webSocketService = new WebSocketService(webSocketUrl);
    
    // Don't auto-connect here - let the subscription handle connection with proper context
  }
  return webSocketService;
};