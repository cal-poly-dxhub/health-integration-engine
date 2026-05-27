import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  ConfirmSignUpCommand,
  ResendConfirmationCodeCommand,
  InitiateAuthCommand,
  GetUserCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
  ChangePasswordCommand,
  UpdateUserAttributesCommand,
  DeleteUserCommand,
  AuthFlowType,
} from '@aws-sdk/client-cognito-identity-provider';

// Types for authentication
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

export interface UserProfile {
  email: string;
  givenName?: string;
  familyName?: string;
  userRole?: string;
  organization?: string;
}

class AuthService {
  private client: CognitoIdentityProviderClient | null = null;
  private config: {
    userPoolId: string;
    userPoolClientId: string;
    identityPoolId: string;
    region: string;
    domain?: string;
  } | null = null;
  private currentTokens: AuthTokens | null = null;
  private readonly TOKEN_STORAGE_KEY = 'auth_tokens';

  /**
   * Configure AWS SDK with Cognito settings
   */
  configure(config: {
    userPoolId: string;
    userPoolClientId: string;
    identityPoolId: string;
    region: string;
    domain?: string;
  }) {
    if (this.client) {
      return;
    }

    try {
      this.config = config;
      this.client = new CognitoIdentityProviderClient({
        region: config.region,
      });

      this.loadStoredTokens();
    } catch (error) {
      console.error('Failed to configure AWS SDK:', error);
      throw error;
    }
  }

  /**
   * Sign up a new user
   */
  async signUp(userData: SignUpData): Promise<{ userId: string; nextStep: any }> {
    if (!this.client || !this.config) {
      throw new Error('Auth service not configured');
    }

    try {
      const userAttributes = [
        { Name: 'email', Value: userData.email },
        ...(userData.givenName ? [{ Name: 'given_name', Value: userData.givenName }] : []),
        ...(userData.familyName ? [{ Name: 'family_name', Value: userData.familyName }] : []),
        ...(userData.userRole ? [{ Name: 'custom:user_role', Value: userData.userRole }] : []),
        ...(userData.organization ? [{ Name: 'custom:organization', Value: userData.organization }] : []),
      ];

      const command = new SignUpCommand({
        ClientId: this.config.userPoolClientId,
        Username: userData.email,
        Password: userData.password,
        UserAttributes: userAttributes,
      });

      const result = await this.client.send(command);
      
      return {
        userId: result.UserSub || '',
        nextStep: result,
      };
    } catch (error) {
      console.error('Sign up error:', error);
      throw this.handleAuthError(error);
    }
  }

  /**
   * Confirm sign up with verification code
   */
  async confirmSignUp(data: { username: string; confirmationCode: string }): Promise<void> {
    if (!this.client || !this.config) {
      throw new Error('Auth service not configured');
    }

    try {
      const command = new ConfirmSignUpCommand({
        ClientId: this.config.userPoolClientId,
        Username: data.username,
        ConfirmationCode: data.confirmationCode,
      });

      await this.client.send(command);
    } catch (error) {
      console.error('Confirm sign up error:', error);
      throw this.handleAuthError(error);
    }
  }

  /**
   * Resend sign up verification code
   */
  async resendSignUpCode(username: string): Promise<void> {
    if (!this.client || !this.config) {
      throw new Error('Auth service not configured');
    }

    try {
      const command = new ResendConfirmationCodeCommand({
        ClientId: this.config.userPoolClientId,
        Username: username,
      });

      await this.client.send(command);
    } catch (error) {
      console.error('Resend sign up code error:', error);
      throw this.handleAuthError(error);
    }
  }

  /**
   * Sign in user
   */
  async signIn(credentials: SignInData): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    if (!this.client || !this.config) {
      throw new Error('Auth service not configured');
    }

    try {
      const command = new InitiateAuthCommand({
        ClientId: this.config.userPoolClientId,
        AuthFlow: AuthFlowType.USER_PASSWORD_AUTH,
        AuthParameters: {
          USERNAME: credentials.email,
          PASSWORD: credentials.password,
        },
      });

      const result = await this.client.send(command);
      
      if (result.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
        throw new Error('Password change required');
      }

      if (!result.AuthenticationResult) {
        throw new Error('Authentication failed');
      }

      // Store tokens
      this.currentTokens = {
        accessToken: result.AuthenticationResult.AccessToken || '',
        idToken: result.AuthenticationResult.IdToken || '',
        refreshToken: result.AuthenticationResult.RefreshToken || '',
      };

      // Persist tokens to localStorage
      this.storeTokens(this.currentTokens);

      // Get user details
      const user = await this.getCurrentUser();

      return { user, tokens: this.currentTokens };
    } catch (error) {
      console.error('Sign in error:', error);
      throw this.handleAuthError(error);
    }
  }

  /**
   * Sign out user
   */
  async signOut(): Promise<void> {
    try {
      // Clear stored tokens
      this.currentTokens = null;
      this.clearStoredTokens();
      
      // In a full implementation, you might want to call GlobalSignOut
      // but for now, just clearing local tokens is sufficient
      console.log('User signed out successfully');
    } catch (error) {
      console.error('Sign out error:', error);
      throw this.handleAuthError(error);
    }
  }

  /**
   * Get current authenticated user
   */
  async getCurrentUser(): Promise<AuthUser> {
    if (!this.client || !this.currentTokens) {
      throw new Error('User not authenticated');
    }

    try {
      const command = new GetUserCommand({
        AccessToken: this.currentTokens.accessToken,
      });

      const result = await this.client.send(command);
      
      const attributes: Record<string, string> = {};
      result.UserAttributes?.forEach(attr => {
        if (attr.Name && attr.Value) {
          attributes[attr.Name] = attr.Value;
        }
      });

      return {
        userId: result.Username || '',
        username: result.Username || '',
        email: attributes.email || '',
        emailVerified: attributes.email_verified === 'true',
        userRole: attributes['custom:user_role'],
        organization: attributes['custom:organization'],
        registrationDate: attributes['custom:registration_date'],
        accountStatus: attributes['custom:account_status'],
      };
    } catch (error) {
      console.error('Get current user error:', error);
      throw this.handleAuthError(error);
    }
  }

  /**
   * Get authentication tokens
   */
  async getTokens(): Promise<AuthTokens> {
    if (!this.currentTokens) {
      throw new Error('No tokens available');
    }

    return this.currentTokens;
  }

  /**
   * Check if user is authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    try {
      if (!this.currentTokens) {
        return false;
      }
      
      // Try to get current user to verify token is still valid
      await this.getCurrentUser();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Reset password
   */
  async resetPassword(username: string): Promise<void> {
    if (!this.client || !this.config) {
      throw new Error('Auth service not configured');
    }

    try {
      const command = new ForgotPasswordCommand({
        ClientId: this.config.userPoolClientId,
        Username: username,
      });

      await this.client.send(command);
    } catch (error) {
      console.error('Reset password error:', error);
      throw this.handleAuthError(error);
    }
  }

  /**
   * Confirm password reset
   */
  async confirmResetPassword(data: { username: string; confirmationCode: string; newPassword: string }): Promise<void> {
    if (!this.client || !this.config) {
      throw new Error('Auth service not configured');
    }

    try {
      const command = new ConfirmForgotPasswordCommand({
        ClientId: this.config.userPoolClientId,
        Username: data.username,
        ConfirmationCode: data.confirmationCode,
        Password: data.newPassword,
      });

      await this.client.send(command);
    } catch (error) {
      console.error('Confirm reset password error:', error);
      throw this.handleAuthError(error);
    }
  }

  /**
   * Update user password
   */
  async updatePassword(oldPassword: string, newPassword: string): Promise<void> {
    if (!this.client || !this.currentTokens) {
      throw new Error('User not authenticated');
    }

    try {
      const command = new ChangePasswordCommand({
        AccessToken: this.currentTokens.accessToken,
        PreviousPassword: oldPassword,
        ProposedPassword: newPassword,
      });

      await this.client.send(command);
    } catch (error) {
      console.error('Update password error:', error);
      throw this.handleAuthError(error);
    }
  }

  /**
   * Update user profile
   */
  async updateUserProfile(profile: Partial<UserProfile>): Promise<void> {
    if (!this.client || !this.currentTokens) {
      throw new Error('User not authenticated');
    }

    try {
      const userAttributes = [];
      
      if (profile.email) userAttributes.push({ Name: 'email', Value: profile.email });
      if (profile.givenName) userAttributes.push({ Name: 'given_name', Value: profile.givenName });
      if (profile.familyName) userAttributes.push({ Name: 'family_name', Value: profile.familyName });
      if (profile.userRole) userAttributes.push({ Name: 'custom:user_role', Value: profile.userRole });
      if (profile.organization) userAttributes.push({ Name: 'custom:organization', Value: profile.organization });

      const command = new UpdateUserAttributesCommand({
        AccessToken: this.currentTokens.accessToken,
        UserAttributes: userAttributes,
      });

      await this.client.send(command);
    } catch (error) {
      console.error('Update user profile error:', error);
      throw this.handleAuthError(error);
    }
  }

  /**
   * Delete user account
   */
  async deleteAccount(): Promise<void> {
    if (!this.client || !this.currentTokens) {
      throw new Error('User not authenticated');
    }

    try {
      const command = new DeleteUserCommand({
        AccessToken: this.currentTokens.accessToken,
      });

      await this.client.send(command);
      this.currentTokens = null;
    } catch (error) {
      console.error('Delete account error:', error);
      throw this.handleAuthError(error);
    }
  }

  /**
   * Store tokens in localStorage
   */
  private storeTokens(tokens: AuthTokens): void {
    try {
      localStorage.setItem(this.TOKEN_STORAGE_KEY, JSON.stringify(tokens));
    } catch (error) {
      console.warn('Failed to store tokens in localStorage:', error);
    }
  }

  /**
   * Load tokens from localStorage
   */
  private loadStoredTokens(): void {
    try {
      const storedTokens = localStorage.getItem(this.TOKEN_STORAGE_KEY);
      if (storedTokens) {
        this.currentTokens = JSON.parse(storedTokens);
        console.log('Loaded stored authentication tokens');
      }
    } catch (error) {
      console.warn('Failed to load stored tokens:', error);
      this.clearStoredTokens();
    }
  }

  /**
   * Clear stored tokens from localStorage
   */
  private clearStoredTokens(): void {
    try {
      localStorage.removeItem(this.TOKEN_STORAGE_KEY);
    } catch (error) {
      console.warn('Failed to clear stored tokens:', error);
    }
  }

  /**
   * Handle authentication errors
   */
  private handleAuthError(error: any): Error {
    const code = error.code || error.name;
    if (code === 'UserNotConfirmedException') {
      return new Error('Please confirm your email address');
    }
    if (code === 'NotAuthorizedException') {
      return new Error('Incorrect username or password');
    }
    if (code === 'UserNotFoundException') {
      return new Error('Incorrect username or password');
    }
    if (code === 'UsernameExistsException') {
      return new Error('An account with this email already exists');
    }
    if (code === 'InvalidPasswordException') {
      return new Error('Password does not meet requirements');
    }
    if (code === 'LimitExceededException') {
      return new Error('Too many attempts. Please try again later');
    }
    if (code === 'CodeMismatchException') {
      return new Error('Invalid verification code');
    }
    if (code === 'ExpiredCodeException') {
      return new Error('Verification code has expired');
    }

    return error instanceof Error ? error : new Error('Authentication error occurred');
  }
}

// Export singleton instance
export const authService = new AuthService();
export default authService;