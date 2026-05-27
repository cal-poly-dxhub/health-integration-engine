import { APIGatewayRequestAuthorizerEvent, APIGatewayAuthorizerResult } from 'aws-lambda';

const USER_POOL_ID = process.env.USER_POOL_ID!;
const USER_POOL_CLIENT_ID = process.env.USER_POOL_CLIENT_ID!;
const AWS_REGION = process.env.AWS_REGION!;

/**
 * WebSocket $connect authorizer.
 * Validates the Cognito JWT token passed as a query string parameter.
 * WebSocket APIs cannot use Authorization headers, so the token is sent via ?token=<jwt>.
 */
export const handler = async (
  event: APIGatewayRequestAuthorizerEvent
): Promise<APIGatewayAuthorizerResult> => {
  const token = event.queryStringParameters?.token;

  if (!token) {
    console.log('No token provided in query parameters');
    throw new Error('Unauthorized');
  }

  try {
    const payload = await verifyToken(token);
    const principalId = payload.sub || 'user';

    return generatePolicy(principalId, 'Allow', event.methodArn, {
      userId: payload.sub,
      email: payload.email || '',
    });
  } catch (error) {
    console.error('Token verification failed:', error);
    throw new Error('Unauthorized');
  }
};

/**
 * Verify Cognito JWT token by checking signature against JWKS
 */
async function verifyToken(token: string): Promise<Record<string, any>> {
  // Decode header to get kid
  const [headerB64, payloadB64] = token.split('.');
  if (!headerB64 || !payloadB64) {
    throw new Error('Invalid token format');
  }

  const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());

  // Validate claims
  const issuer = `https://cognito-idp.${AWS_REGION}.amazonaws.com/${USER_POOL_ID}`;
  if (payload.iss !== issuer) {
    throw new Error('Invalid issuer');
  }

  if (payload.token_use !== 'access' && payload.token_use !== 'id') {
    throw new Error('Invalid token_use');
  }

  if (payload.token_use === 'id' && payload.aud !== USER_POOL_CLIENT_ID) {
    throw new Error('Invalid audience');
  }

  if (payload.client_id && payload.client_id !== USER_POOL_CLIENT_ID) {
    throw new Error('Invalid client_id');
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    throw new Error('Token expired');
  }

  // Verify signature against Cognito JWKS
  const jwksUrl = `${issuer}/.well-known/jwks.json`;
  const jwks = await fetchJwks(jwksUrl);
  const key = jwks.keys.find((k: any) => k.kid === header.kid);
  if (!key) {
    throw new Error('Signing key not found');
  }

  const crypto = await import('crypto');
  const publicKey = crypto.createPublicKey({ key, format: 'jwk' });
  const signatureValid = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${headerB64}.${payloadB64}`),
    publicKey,
    Buffer.from(token.split('.')[2], 'base64url')
  );

  if (!signatureValid) {
    throw new Error('Invalid signature');
  }

  return payload;
}

let cachedJwks: any = null;

async function fetchJwks(url: string): Promise<any> {
  if (cachedJwks) return cachedJwks;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch JWKS: ${response.status}`);
  }
  cachedJwks = await response.json();
  return cachedJwks;
}

function generatePolicy(
  principalId: string,
  effect: 'Allow' | 'Deny',
  resource: string,
  context?: Record<string, string>
): APIGatewayAuthorizerResult {
  return {
    principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: effect,
          Resource: resource,
        },
      ],
    },
    context,
  };
}
