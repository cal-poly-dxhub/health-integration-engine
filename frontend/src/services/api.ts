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

    // Response interceptor to handle auth errors. On a 401 we force a token
    // refresh via the refresh token and retry the request exactly once. The
    // __isRetry guard prevents an infinite loop if the refreshed token is
    // still rejected (e.g. the session/refresh token itself has expired).
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;
        if (error.response?.status === 401 && originalRequest && !originalRequest.__isRetry) {
          originalRequest.__isRetry = true;
          try {
            const tokens = await authService.refreshTokens();
            originalRequest.headers.Authorization = `Bearer ${tokens.idToken}`;
            return this.client.request(originalRequest);
          } catch (refreshError) {
            // Refresh failed (no/expired refresh token) — sign out and redirect.
            console.error('Token refresh failed:', refreshError);
            await authService.signOut();
            window.location.href = '/signin';
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
    '';
};

export const apiService = new ApiService({
  baseURL: getApiBaseURL(),
  timeout: 30000,
});

export default apiService;