// Simple authentication service without AWS SDK
// This avoids the Request destructuring issues in CloudFront

export interface SimpleAuthUser {
  userId: string;
  username: string;
  email: string;
  emailVerified: boolean;
}

export interface SimpleAuthTokens {
  accessToken: string;
  idToken: string;
  refreshToken: string;
}

class SimpleAuthService {
  private config: any = {};
  private currentUser: SimpleAuthUser | null = null;
  private tokens: SimpleAuthTokens | null = null;

  configure(config: any) {
    this.config = config;
    console.log('Simple auth service configured');
  }

  async signUp(userData: any): Promise<any> {
    console.log('Simple auth: Sign up requested');
    // For now, return a mock response
    return {
      userSub: 'mock-user-id',
      codeDeliveryDetails: {
        destination: userData.email,
        deliveryMedium: 'EMAIL'
      }
    };
  }

  async confirmSignUp(username: string, code: string): Promise<void> {
    console.log('Simple auth: Confirm sign up requested');
    // Mock confirmation
  }

  async signIn(email: string, password: string): Promise<SimpleAuthTokens> {
    console.log('Simple auth: Sign in requested');
    
    // Mock tokens for development
    const mockTokens: SimpleAuthTokens = {
      accessToken: 'mock-access-token',
      idToken: 'mock-id-token',
      refreshToken: 'mock-refresh-token'
    };

    this.tokens = mockTokens;
    this.currentUser = {
      userId: 'mock-user-id',
      username: email,
      email: email,
      emailVerified: true
    };

    // Store in localStorage for persistence
    localStorage.setItem('auth-tokens', JSON.stringify(mockTokens));
    localStorage.setItem('auth-user', JSON.stringify(this.currentUser));

    return mockTokens;
  }

  async signOut(): Promise<void> {
    console.log('Simple auth: Sign out requested');
    this.currentUser = null;
    this.tokens = null;
    localStorage.removeItem('auth-tokens');
    localStorage.removeItem('auth-user');
  }

  async getCurrentUser(): Promise<SimpleAuthUser | null> {
    if (this.currentUser) {
      return this.currentUser;
    }

    // Try to restore from localStorage
    const storedUser = localStorage.getItem('auth-user');
    const storedTokens = localStorage.getItem('auth-tokens');

    if (storedUser && storedTokens) {
      this.currentUser = JSON.parse(storedUser);
      this.tokens = JSON.parse(storedTokens);
      return this.currentUser;
    }

    return null;
  }

  async getTokens(): Promise<SimpleAuthTokens | null> {
    return this.tokens;
  }

  async forgotPassword(email: string): Promise<any> {
    console.log('Simple auth: Forgot password requested');
    return { codeDeliveryDetails: { destination: email } };
  }

  async confirmForgotPassword(email: string, code: string, newPassword: string): Promise<void> {
    console.log('Simple auth: Confirm forgot password requested');
  }

  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    console.log('Simple auth: Change password requested');
  }

  async updateUserAttributes(attributes: any): Promise<void> {
    console.log('Simple auth: Update user attributes requested');
  }

  async deleteUser(): Promise<void> {
    console.log('Simple auth: Delete user requested');
    await this.signOut();
  }

  async resendConfirmationCode(username: string): Promise<any> {
    console.log('Simple auth: Resend confirmation code requested');
    return { codeDeliveryDetails: { destination: username } };
  }

  isAuthenticated(): boolean {
    return this.currentUser !== null;
  }
}

export const simpleAuthService = new SimpleAuthService();