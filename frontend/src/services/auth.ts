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
  givenName?: string;
  familyName?: string;
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
}

export interface SignInData {
  email: string;
  password: string;
}

export interface UserProfile {
  email: string;
  givenName?: string;
  familyName?: string;
}

// Refresh the access/ID tokens this many seconds before they actually expire,
// so a request never goes out with an about-to-expire token.
const TOKEN_REFRESH_SKEW_SECONDS = 120;

/**
 * Decode the `exp` (expiry, seconds since epoch) claim from a JWT without
 * verifying its signature. Returns null if the token is missing or malformed.
 * Used only to decide when to proactively refresh — never for trust.
 */
export function decodeJwtExp(token: string | undefined | null): number | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    // base64url -> base64, then decode and parse.
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(payload);
    const claims = JSON.parse(json);
    return typeof claims.exp === 'number' ? claims.exp : null;
  } catch {
    return null;
  }
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
  // Single in-flight refresh shared by all callers, so a burst of parallel
  // 401s / proactive checks triggers exactly one REFRESH_TOKEN_AUTH call.
  private refreshPromise: Promise<AuthTokens> | null = null;

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
      this.refreshPromise = null;
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
      // Refresh first if the access token is expiring/expired. On app reload
      // after the 15-min access-token lifetime, the cached token is stale but
      // the refresh token may still be valid — refresh rather than fail, so
      // the session survives until the (24h) refresh token actually expires.
      const tokens = await this.getTokens();
      const command = new GetUserCommand({
        AccessToken: tokens.accessToken,
      });

      const result = await this.client.send(command);
      
      const attributes: Record<string, string> = {};
      result.UserAttributes?.forEach(attr => {
        if (attr.Name && attr.Value) {
          attributes[attr.Name] = attr.Value;
        }
      });

      return {
        userId: attributes.sub || result.Username || '',
        username: result.Username || '',
        email: attributes.email || '',
        emailVerified: attributes.email_verified === 'true',
        givenName: attributes.given_name,
        familyName: attributes.family_name,
      };
    } catch (error) {
      console.error('Get current user error:', error);
      throw this.handleAuthError(error);
    }
  }

  /**
   * Get valid authentication tokens, refreshing proactively when the access
   * token is at/near expiry. Callers (e.g. the API request interceptor) can
   * rely on the returned tokens being fresh enough to make a request.
   */
  async getTokens(): Promise<AuthTokens> {
    if (!this.currentTokens) {
      throw new Error('No tokens available');
    }

    if (this.isAccessTokenExpiring(this.currentTokens.accessToken)) {
      return this.refreshTokens();
    }

    return this.currentTokens;
  }

  /**
   * Exchange the stored refresh token for fresh access/ID tokens via Cognito's
   * REFRESH_TOKEN_AUTH flow. Cognito does NOT reissue the refresh token, so we
   * preserve the existing one. Concurrent callers share a single in-flight
   * request.
   */
  async refreshTokens(): Promise<AuthTokens> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.doRefresh().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  private async doRefresh(): Promise<AuthTokens> {
    if (!this.client || !this.config) {
      throw new Error('Auth service not configured');
    }
    const refreshToken = this.currentTokens?.refreshToken;
    if (!refreshToken) {
      throw new Error('No refresh token available');
    }

    const command = new InitiateAuthCommand({
      ClientId: this.config.userPoolClientId,
      AuthFlow: AuthFlowType.REFRESH_TOKEN_AUTH,
      AuthParameters: {
        REFRESH_TOKEN: refreshToken,
      },
    });

    const result = await this.client.send(command);
    if (!result.AuthenticationResult) {
      throw new Error('Token refresh failed');
    }

    // REFRESH_TOKEN_AUTH returns new access/ID tokens but not a new refresh
    // token — keep the existing one for the remainder of the session window.
    this.currentTokens = {
      accessToken: result.AuthenticationResult.AccessToken || '',
      idToken: result.AuthenticationResult.IdToken || '',
      refreshToken: result.AuthenticationResult.RefreshToken || refreshToken,
    };
    this.storeTokens(this.currentTokens);

    return this.currentTokens;
  }

  /**
   * True when the access token is missing, unparseable, or within the refresh
   * skew window of its expiry. Decodes the JWT `exp` claim (seconds since
   * epoch) without verifying the signature — that's the server's job; here we
   * only need the expiry to decide when to refresh.
   */
  private isAccessTokenExpiring(accessToken: string): boolean {
    const exp = decodeJwtExp(accessToken);
    if (exp === null) return true;
    const nowSeconds = Date.now() / 1000;
    return exp - nowSeconds <= TOKEN_REFRESH_SKEW_SECONDS;
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