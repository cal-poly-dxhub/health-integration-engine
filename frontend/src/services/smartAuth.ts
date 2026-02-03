// Smart authentication service that chooses the right auth method based on environment
// Local dev: Uses AWS SDK auth (works perfectly)
// CloudFront: Falls back to simple auth (avoids Request destructuring issues)

import { simpleAuthService } from './simpleAuth';

// Types that match the existing auth service
export interface AuthUser {
  userId: string;
  username: string;
  email: string;
  emailVerified: boolean;
  userRole?: string;
  organization?: string;
  registrationDate?: string;
  accountStatus?: string;
}

export interface AuthTokens {
  accessToken: string;
  idToken: string;
  refreshToken: string;
}

export interface SignUpData {
  email: string;
  password: string;
  givenName?: string;
  familyName?: string;
  userRole?: string;
  organization?: string;
}

export interface SignInData {
  email: string;
  password: string;
}

class SmartAuthService {
  private useSimpleAuth = false;
  private awsAuthService: any = null;
  private config: any = {};

  constructor() {
    this.detectEnvironment();
  }

  private detectEnvironment() {
    // Check if we're in a problematic environment (CloudFront, etc.)
    const isCloudFront = location.hostname.includes('cloudfront.net') || 
                        location.hostname.includes('amazonaws.com');
    
    // Check if we're in local development
    const isLocalDev = location.hostname === 'localhost' || 
                      location.hostname === '127.0.0.1' ||
                      location.port !== '';

    if (isLocalDev) {
      console.log('🏠 Local development detected - using AWS SDK auth');
      this.useSimpleAuth = false;
      this.initializeAwsAuth();
    } else if (isCloudFront) {
      console.log('☁️ CloudFront environment detected - using simple auth');
      this.useSimpleAuth = true;
    } else {
      console.log('🌐 Unknown environment - trying AWS SDK auth with fallback');
      this.useSimpleAuth = false;
      this.initializeAwsAuth();
    }
  }

  private async initializeAwsAuth() {
    try {
      // Only try to load AWS auth in local development
      if (location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.port !== '') {
        // Dynamically import AWS auth service only when needed
        const { authService } = await import('./auth');
        this.awsAuthService = authService;
        console.log('✅ AWS SDK auth service loaded for local development');
      } else {
        console.log('🌐 Production environment - skipping AWS SDK auth, using simple auth');
        this.useSimpleAuth = true;
      }
    } catch (error) {
      console.warn('⚠️ AWS SDK auth failed to load, falling back to simple auth:', error);
      this.useSimpleAuth = true;
    }
  }

  configure(config: any) {
    this.config = config;
    
    if (this.useSimpleAuth) {
      simpleAuthService.configure(config);
    } else if (this.awsAuthService) {
      this.awsAuthService.configure(config);
    }
  }

  async signUp(userData: SignUpData): Promise<any> {
    if (this.useSimpleAuth) {
      return simpleAuthService.signUp(userData);
    }
    
    try {
      if (!this.awsAuthService) await this.initializeAwsAuth();
      return await this.awsAuthService.signUp(userData);
    } catch (error) {
      console.warn('AWS auth failed, falling back to simple auth:', error);
      this.useSimpleAuth = true;
      return simpleAuthService.signUp(userData);
    }
  }

  async confirmSignUp(username: string, code: string): Promise<void> {
    if (this.useSimpleAuth) {
      return simpleAuthService.confirmSignUp(username, code);
    }
    
    try {
      if (!this.awsAuthService) await this.initializeAwsAuth();
      return await this.awsAuthService.confirmSignUp(username, code);
    } catch (error) {
      console.warn('AWS auth failed, falling back to simple auth:', error);
      this.useSimpleAuth = true;
      return simpleAuthService.confirmSignUp(username, code);
    }
  }

  async signIn(credentials: SignInData): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    if (this.useSimpleAuth) {
      const tokens = await simpleAuthService.signIn(credentials.email, credentials.password);
      const user = await simpleAuthService.getCurrentUser();
      return { user: user!, tokens };
    }
    
    try {
      if (!this.awsAuthService) await this.initializeAwsAuth();
      return await this.awsAuthService.signIn(credentials);
    } catch (error) {
      console.warn('AWS auth failed, falling back to simple auth:', error);
      this.useSimpleAuth = true;
      const tokens = await simpleAuthService.signIn(credentials.email, credentials.password);
      const user = await simpleAuthService.getCurrentUser();
      return { user: user!, tokens };
    }
  }

  async signOut(): Promise<void> {
    if (this.useSimpleAuth) {
      return simpleAuthService.signOut();
    }
    
    try {
      if (!this.awsAuthService) await this.initializeAwsAuth();
      return await this.awsAuthService.signOut();
    } catch (error) {
      console.warn('AWS auth failed, falling back to simple auth:', error);
      this.useSimpleAuth = true;
      return simpleAuthService.signOut();
    }
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    if (this.useSimpleAuth) {
      return simpleAuthService.getCurrentUser();
    }
    
    try {
      if (!this.awsAuthService) await this.initializeAwsAuth();
      return await this.awsAuthService.getCurrentUser();
    } catch (error) {
      console.warn('AWS auth failed, falling back to simple auth:', error);
      this.useSimpleAuth = true;
      return simpleAuthService.getCurrentUser();
    }
  }

  async getTokens(): Promise<AuthTokens | null> {
    if (this.useSimpleAuth) {
      return simpleAuthService.getTokens();
    }
    
    try {
      if (!this.awsAuthService) await this.initializeAwsAuth();
      return await this.awsAuthService.getTokens();
    } catch (error) {
      console.warn('AWS auth failed, falling back to simple auth:', error);
      this.useSimpleAuth = true;
      return simpleAuthService.getTokens();
    }
  }

  async forgotPassword(email: string): Promise<any> {
    if (this.useSimpleAuth) {
      return simpleAuthService.forgotPassword(email);
    }
    
    try {
      if (!this.awsAuthService) await this.initializeAwsAuth();
      return await this.awsAuthService.forgotPassword(email);
    } catch (error) {
      console.warn('AWS auth failed, falling back to simple auth:', error);
      this.useSimpleAuth = true;
      return simpleAuthService.forgotPassword(email);
    }
  }

  async confirmForgotPassword(email: string, code: string, newPassword: string): Promise<void> {
    if (this.useSimpleAuth) {
      return simpleAuthService.confirmForgotPassword(email, code, newPassword);
    }
    
    try {
      if (!this.awsAuthService) await this.initializeAwsAuth();
      return await this.awsAuthService.confirmForgotPassword(email, code, newPassword);
    } catch (error) {
      console.warn('AWS auth failed, falling back to simple auth:', error);
      this.useSimpleAuth = true;
      return simpleAuthService.confirmForgotPassword(email, code, newPassword);
    }
  }

  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    if (this.useSimpleAuth) {
      return simpleAuthService.changePassword(oldPassword, newPassword);
    }
    
    try {
      if (!this.awsAuthService) await this.initializeAwsAuth();
      return await this.awsAuthService.changePassword(oldPassword, newPassword);
    } catch (error) {
      console.warn('AWS auth failed, falling back to simple auth:', error);
      this.useSimpleAuth = true;
      return simpleAuthService.changePassword(oldPassword, newPassword);
    }
  }

  async updateUserAttributes(attributes: any): Promise<void> {
    if (this.useSimpleAuth) {
      return simpleAuthService.updateUserAttributes(attributes);
    }
    
    try {
      if (!this.awsAuthService) await this.initializeAwsAuth();
      return await this.awsAuthService.updateUserAttributes(attributes);
    } catch (error) {
      console.warn('AWS auth failed, falling back to simple auth:', error);
      this.useSimpleAuth = true;
      return simpleAuthService.updateUserAttributes(attributes);
    }
  }

  async deleteUser(): Promise<void> {
    if (this.useSimpleAuth) {
      return simpleAuthService.deleteUser();
    }
    
    try {
      if (!this.awsAuthService) await this.initializeAwsAuth();
      return await this.awsAuthService.deleteUser();
    } catch (error) {
      console.warn('AWS auth failed, falling back to simple auth:', error);
      this.useSimpleAuth = true;
      return simpleAuthService.deleteUser();
    }
  }

  async resendConfirmationCode(username: string): Promise<any> {
    if (this.useSimpleAuth) {
      return simpleAuthService.resendConfirmationCode(username);
    }
    
    try {
      if (!this.awsAuthService) await this.initializeAwsAuth();
      return await this.awsAuthService.resendConfirmationCode(username);
    } catch (error) {
      console.warn('AWS auth failed, falling back to simple auth:', error);
      this.useSimpleAuth = true;
      return simpleAuthService.resendConfirmationCode(username);
    }
  }

  isAuthenticated(): boolean {
    if (this.useSimpleAuth) {
      return simpleAuthService.isAuthenticated();
    }
    
    try {
      return this.awsAuthService ? this.awsAuthService.isAuthenticated() : false;
    } catch (error) {
      console.warn('AWS auth check failed, falling back to simple auth:', error);
      this.useSimpleAuth = true;
      return simpleAuthService.isAuthenticated();
    }
  }
}

export const smartAuthService = new SmartAuthService();