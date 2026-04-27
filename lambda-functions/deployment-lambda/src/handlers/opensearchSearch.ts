import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

interface SearchRequest {
  collectionEndpoint: string;
  indexName: string;
  query: {
    searchText?: string;
    dataPartnerName?: string;
    messageType?: string;
    messageControlId?: string;
    fillerOrderNumber?: string;
  };
  searchConfig?: {
    dateRangeField?: string;
    dateRangeDays?: number;
  };
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Content-Type': 'application/json',
};

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('OpenSearch search request:', JSON.stringify(event, null, 2));

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const request: SearchRequest = JSON.parse(event.body || '{}');
    
    if (!request.collectionEndpoint || !request.indexName) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'collectionEndpoint and indexName are required' }),
      };
    }

    const { STS } = await import('@aws-sdk/client-sts');
    const { SignatureV4 } = await import('@smithy/signature-v4');
    const { Sha256 } = await import('@aws-crypto/sha256-js');
    const { fromEnv } = await import('@aws-sdk/credential-providers');

    const endpoint = request.collectionEndpoint.replace(/\/$/, '');
    const url = new URL(`${endpoint}/${request.indexName}/_search`);
    
    // Build search query
    const query = buildSearchQuery(request.query, request.searchConfig);
    const body = JSON.stringify(query);

    // Sign the request
    const credentials = await fromEnv()();
    const signer = new SignatureV4({
      service: 'aoss',
      region: process.env.AWS_REGION!,
      credentials,
      sha256: Sha256,
    });

    const signedRequest = await signer.sign({
      method: 'POST',
      hostname: url.hostname,
      path: url.pathname,
      protocol: url.protocol,
      headers: {
        'Content-Type': 'application/json',
        host: url.hostname,
      },
      body,
    });

    // Make the request
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: signedRequest.headers as Record<string, string>,
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenSearch error:', errorText);
      return {
        statusCode: response.status,
        headers: corsHeaders,
        body: JSON.stringify({ error: `OpenSearch error: ${errorText}` }),
      };
    }

    const result = await response.json() as { hits?: { total?: { value?: number }; hits?: Array<{ _source: any }> } };
    const hits = result.hits || {};

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        total: hits.total?.value || 0,
        results: (hits.hits || []).map((hit: any) => hit._source),
      }),
    };
  } catch (error) {
    console.error('Search error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Search failed' 
      }),
    };
  }
};

function buildSearchQuery(params: SearchRequest['query'], config?: SearchRequest['searchConfig']) {
  const mustClauses: any[] = [];
  const filterClauses: any[] = [];

  if (params.searchText) {
    mustClauses.push({ multi_match: { query: params.searchText, fields: ['*'], fuzziness: 'AUTO' } });
  }
  if (params.dataPartnerName) {
    mustClauses.push({ match: { dataPartnerName: { query: params.dataPartnerName, fuzziness: 'AUTO' } } });
  }
  if (params.messageType) {
    mustClauses.push({ match: { messageType: { query: params.messageType, fuzziness: 'AUTO' } } });
  }
  if (params.messageControlId) {
    mustClauses.push({ match: { messageControlId: { query: params.messageControlId, fuzziness: 'AUTO' } } });
  }
  if (params.fillerOrderNumber) {
    mustClauses.push({ match: { fillerOrderNumber: { query: params.fillerOrderNumber, fuzziness: 'AUTO' } } });
  }

  const dateField = config?.dateRangeField || 'ingestedAt';
  const dateDays = config?.dateRangeDays || 2;
  filterClauses.push({
    range: { [dateField]: { gte: `now-${dateDays}d`, lte: 'now' } },
  });

  return {
    query: {
      bool: {
        must: mustClauses.length > 0 ? mustClauses : [{ match_all: {} }],
        filter: filterClauses,
      },
    },
    size: 100,
  };
}
