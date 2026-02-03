import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { authService } from './auth';

// Force Axios to use XHR adapter instead of fetch to avoid polyfill issues
axios.defaults.adapter = 'xhr';

interface ApiConfig {
  baseURL: string;
  timeout?: number;
}

class ApiService {
  private client: AxiosInstance;
  private config: ApiConfig;

  constructor(config: ApiConfig) {
    this.config = config;
    this.client = axios.create({
      baseURL: config.baseURL,
      timeout: config.timeout || 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.setupInterceptors();
  }

  /**
   * Setup request and response interceptors
   */
  private setupInterceptors() {
    // Request interceptor to add auth token
    this.client.interceptors.request.use(
      async (config) => {
        try {
          const tokens = await authService.getTokens();
          if (tokens.idToken) {
            config.headers.Authorization = `Bearer ${tokens.idToken}`;
          }
        } catch (error) {
          console.warn('Failed to get auth token for API request:', error);
        }
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    // Response interceptor to handle auth errors
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error.response?.status === 401) {
          // Token might be expired, try to refresh
          try {
            await authService.getTokens(); // This will refresh tokens if needed
            // Retry the original request
            const originalRequest = error.config;
            const tokens = await authService.getTokens();
            originalRequest.headers.Authorization = `Bearer ${tokens.idToken}`;
            return this.client.request(originalRequest);
          } catch (refreshError) {
            // Refresh failed, redirect to login
            console.error('Token refresh failed:', refreshError);
            authService.signOut();
            window.location.href = '/login';
          }
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * Generic GET request
   */
  async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.get<T>(url, config);
    return response.data;
  }

  /**
   * Generic POST request
   */
  async post<T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.post<T>(url, data, config);
    return response.data;
  }

  /**
   * Generic PUT request
   */
  async put<T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.put<T>(url, data, config);
    return response.data;
  }

  /**
   * Generic DELETE request
   */
  async delete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.delete<T>(url, config);
    return response.data;
  }

  /**
   * Generic PATCH request
   */
  async patch<T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.patch<T>(url, data, config);
    return response.data;
  }

  /**
   * Update base URL (useful for environment changes)
   */
  updateBaseURL(baseURL: string) {
    this.config.baseURL = baseURL;
    this.client.defaults.baseURL = baseURL;
  }

  /**
   * Get current configuration
   */
  getConfig(): ApiConfig {
    return { ...this.config };
  }
}

// Create API service instance with environment configuration
const getApiBaseURL = (): string => {
  return (import.meta as any).env.VITE_API_BASE_URL ||
    (import.meta as any).env.VITE_API_GATEWAY_URL ||
    'https://vqrp7icb97.execute-api.us-east-1.amazonaws.com/v1';
};

export const apiService = new ApiService({
  baseURL: getApiBaseURL(),
  timeout: 30000,
});

export default apiService;