/**
 * PolyfillDetector - Detects environment and determines polyfill needs
 */
export class PolyfillDetector {
  /**
   * Check if we're running in CloudFront environment
   */
  static isCloudFrontEnvironment(): boolean {
    // Check for CloudFront-specific indicators
    const hostname = window.location.hostname || '';
    
    // CloudFront domains typically use .cloudfront.net
    const isCloudFrontDomain = hostname.includes('cloudfront.net') || hostname.includes('amazonaws.com');
    
    // Additional CloudFront detection
    const hasCloudFrontHeaders = document.querySelector('meta[name="cloudfront"]') !== null;
    
    return isCloudFrontDomain || hasCloudFrontHeaders;
  }

  /**
   * Check if fetch API needs polyfilling
   */
  static needsFetchPolyfill(): boolean {
    return typeof fetch === 'undefined' || 
           typeof Request === 'undefined' || 
           typeof Response === 'undefined' || 
           typeof Headers === 'undefined';
  }

  /**
   * Check if Request constructor is properly implemented
   */
  static needsRequestPolyfill(): boolean {
    if (typeof Request === 'undefined') return true;
    
    try {
      // Test if Request constructor works with destructuring
      const req = new Request('https://example.com', { method: 'GET' });
      const { url, method } = req;
      return !url || !method;
    } catch (error) {
      return true;
    }
  }

  /**
   * Check if Response constructor is properly implemented
   */
  static needsResponsePolyfill(): boolean {
    if (typeof Response === 'undefined') return true;
    
    try {
      // Test if Response constructor works properly
      const res = new Response('test', { status: 200 });
      return !res.ok || typeof res.json !== 'function';
    } catch (error) {
      return true;
    }
  }

  /**
   * Check if Headers constructor is properly implemented
   */
  static needsHeadersPolyfill(): boolean {
    if (typeof Headers === 'undefined') return true;
    
    try {
      // Test if Headers constructor works properly
      const headers = new Headers({ 'Content-Type': 'application/json' });
      return typeof headers.get !== 'function' || headers.get('Content-Type') !== 'application/json';
    } catch (error) {
      return true;
    }
  }

  /**
   * Comprehensive check for all polyfill needs
   */
  static getPolyfillNeeds(): {
    needsFetch: boolean;
    needsRequest: boolean;
    needsResponse: boolean;
    needsHeaders: boolean;
    isCloudFront: boolean;
    needsAggressive: boolean;
  } {
    const isCloudFront = this.isCloudFrontEnvironment();
    const needsFetch = this.needsFetchPolyfill();
    const needsRequest = this.needsRequestPolyfill();
    const needsResponse = this.needsResponsePolyfill();
    const needsHeaders = this.needsHeadersPolyfill();
    
    return {
      needsFetch,
      needsRequest,
      needsResponse,
      needsHeaders,
      isCloudFront,
      needsAggressive: isCloudFront || needsFetch || needsRequest || needsResponse || needsHeaders
    };
  }

  /**
   * Log polyfill detection results
   */
  static logDetectionResults(): void {
    const needs = this.getPolyfillNeeds();
    console.log('Polyfill Detection Results:', {
      environment: needs.isCloudFront ? 'CloudFront' : 'Standard',
      fetch: needs.needsFetch ? 'NEEDS POLYFILL' : 'Native Available',
      request: needs.needsRequest ? 'NEEDS POLYFILL' : 'Native Available',
      response: needs.needsResponse ? 'NEEDS POLYFILL' : 'Native Available',
      headers: needs.needsHeaders ? 'NEEDS POLYFILL' : 'Native Available',
      aggressive: needs.needsAggressive ? 'REQUIRED' : 'Not Needed'
    });
  }
}