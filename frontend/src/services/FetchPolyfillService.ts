import 'cross-fetch/polyfill';
import { PolyfillDetector } from './PolyfillDetector';

/**
 * FetchPolyfillService - Provides comprehensive fetch API polyfills
 * Compatible with AWS SDK destructuring requirements
 */
export class FetchPolyfillService {
    private static installed = false;

    /**
     * Install comprehensive fetch polyfills
     */
    static install(aggressive = false): void {
        if (this.installed && !aggressive) {
            console.log('Polyfills already installed, skipping...');
            return;
        }

        console.log('Installing fetch polyfills...');

        const needs = PolyfillDetector.getPolyfillNeeds();

        if (needs.needsAggressive || aggressive) {
            this.installAggressivePolyfills();
        } else {
            this.installStandardPolyfills();
        }

        this.installed = true;
        console.log('Fetch polyfills installed successfully');
    }

    /**
     * Install standard polyfills using cross-fetch
     */
    private static installStandardPolyfills(): void {
        // cross-fetch is already imported as polyfill above
        // Just ensure it's properly attached to global contexts

        const contexts = this.getGlobalContexts();

        contexts.forEach(context => {
            if (!context.fetch && typeof fetch !== 'undefined') {
                context.fetch = fetch;
            }
            if (!context.Request && typeof Request !== 'undefined') {
                context.Request = Request;
            }
            if (!context.Response && typeof Response !== 'undefined') {
                context.Response = Response;
            }
            if (!context.Headers && typeof Headers !== 'undefined') {
                context.Headers = Headers;
            }
        });
    }

    /**
     * Install aggressive polyfills for CloudFront compatibility
     */
    private static installAggressivePolyfills(): void {
        console.log('Installing aggressive polyfills for CloudFront compatibility...');

        const contexts = this.getGlobalContexts();

        contexts.forEach(context => {
            // Install comprehensive fetch polyfill
            if (!context.fetch) {
                context.fetch = this.createFetchPolyfill();
            }

            // Install Request constructor with proper destructuring support
            if (!context.Request) {
                context.Request = this.createRequestConstructor();
            }

            // Install Response constructor
            if (!context.Response) {
                context.Response = this.createResponseConstructor();
            }

            // Install Headers constructor
            if (!context.Headers) {
                context.Headers = this.createHeadersConstructor();
            }

            // Ensure fetch has proper static properties for AWS SDK compatibility
            if (context.fetch) {
                context.fetch.Request = context.Request;
                context.fetch.Response = context.Response;
                context.fetch.Headers = context.Headers;
            }
        });
    }

    /**
     * Get all possible global contexts
     */
    private static getGlobalContexts(): any[] {
        const contexts: any[] = [window];

        if (typeof globalThis !== 'undefined') contexts.push(globalThis as any);
        if (typeof self !== 'undefined') contexts.push(self);
        if (typeof global !== 'undefined') contexts.push(global as any);

        return contexts;
    }

    /**
     * Create AWS SDK compatible fetch polyfill
     */
    private static createFetchPolyfill() {
        return function (input: any, init: any = {}) {
            // Handle Request object as input
            let url: string;
            let options: any = { ...init };

            if (typeof input === 'string') {
                url = input;
            } else if (input && typeof input === 'object') {
                // Handle Request object
                url = input.url || input;
                options = {
                    method: input.method || options.method || 'GET',
                    headers: input.headers || options.headers || {},
                    body: input.body || options.body,
                    mode: input.mode || options.mode || 'cors',
                    credentials: input.credentials || options.credentials || 'same-origin',
                    cache: input.cache || options.cache || 'default',
                    redirect: input.redirect || options.redirect || 'follow',
                    ...options
                };
            } else {
                url = String(input);
            }

            return new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open(options.method || 'GET', url);

                // Set headers
                if (options.headers) {
                    if (options.headers instanceof Headers) {
                        options.headers.forEach((value: string, key: string) => {
                            xhr.setRequestHeader(key, value);
                        });
                    } else if (typeof options.headers === 'object') {
                        Object.keys(options.headers).forEach(key => {
                            xhr.setRequestHeader(key, options.headers[key]);
                        });
                    }
                }

                xhr.onload = () => {
                    const response = {
                        ok: xhr.status >= 200 && xhr.status < 300,
                        status: xhr.status,
                        statusText: xhr.statusText,
                        url: url,
                        headers: new (FetchPolyfillService.createHeadersConstructor() as any)(),
                        type: 'basic',
                        redirected: false,

                        // Response body methods
                        json: () => {
                            try {
                                return Promise.resolve(JSON.parse(xhr.responseText));
                            } catch (e) {
                                return Promise.reject(new Error('Invalid JSON'));
                            }
                        },
                        text: () => Promise.resolve(xhr.responseText),
                        blob: () => Promise.resolve(new Blob([xhr.responseText])),
                        arrayBuffer: () => {
                            const buffer = new ArrayBuffer(xhr.responseText.length);
                            const view = new Uint8Array(buffer);
                            for (let i = 0; i < xhr.responseText.length; i++) {
                                view[i] = xhr.responseText.charCodeAt(i);
                            }
                            return Promise.resolve(buffer);
                        },

                        // Clone method for AWS SDK compatibility
                        clone: function () {
                            return { ...this };
                        }
                    };

                    resolve(response);
                };

                xhr.onerror = () => reject(new Error('Network error'));
                xhr.ontimeout = () => reject(new Error('Request timeout'));

                // Send request
                xhr.send(options.body);
            });
        };
    }

    /**
     * Create AWS SDK compatible Request constructor
     */
    private static createRequestConstructor() {
        return function (this: any, input: any, init: any = {}) {
            // Support destructuring by making properties enumerable
            Object.defineProperty(this, 'url', {
                value: typeof input === 'string' ? input : input.url,
                enumerable: true,
                configurable: true
            });

            Object.defineProperty(this, 'method', {
                value: init.method || (input && input.method) || 'GET',
                enumerable: true,
                configurable: true
            });

            Object.defineProperty(this, 'headers', {
                value: init.headers || (input && input.headers) || {},
                enumerable: true,
                configurable: true
            });

            Object.defineProperty(this, 'body', {
                value: init.body || (input && input.body),
                enumerable: true,
                configurable: true
            });

            Object.defineProperty(this, 'mode', {
                value: init.mode || (input && input.mode) || 'cors',
                enumerable: true,
                configurable: true
            });

            Object.defineProperty(this, 'credentials', {
                value: init.credentials || (input && input.credentials) || 'same-origin',
                enumerable: true,
                configurable: true
            });

            Object.defineProperty(this, 'cache', {
                value: init.cache || (input && input.cache) || 'default',
                enumerable: true,
                configurable: true
            });

            Object.defineProperty(this, 'redirect', {
                value: init.redirect || (input && input.redirect) || 'follow',
                enumerable: true,
                configurable: true
            });
        };
    }

    /**
     * Create Response constructor
     */
    private static createResponseConstructor() {
        return function (this: any, body: any, init: any = {}) {
            this.body = body;
            this.status = init.status || 200;
            this.statusText = init.statusText || 'OK';
            this.ok = this.status >= 200 && this.status < 300;
            this.headers = new (FetchPolyfillService.createHeadersConstructor() as any)(init.headers);
            this.url = init.url || '';
            this.type = init.type || 'default';
            this.redirected = init.redirected || false;

            this.json = () => Promise.resolve(JSON.parse(body));
            this.text = () => Promise.resolve(String(body));
            this.blob = () => Promise.resolve(new Blob([body]));
            this.arrayBuffer = () => Promise.resolve(new ArrayBuffer(0));
            this.clone = () => ({ ...this });
        };
    }

    /**
     * Create Headers constructor
     */
    private static createHeadersConstructor() {
        return function (this: any, init?: any) {
            this._headers = new Map();

            if (init) {
                if (init instanceof Headers) {
                    init.forEach((value: string, key: string) => {
                        this._headers.set(key.toLowerCase(), value);
                    });
                } else if (Array.isArray(init)) {
                    init.forEach(([key, value]) => {
                        this._headers.set(key.toLowerCase(), value);
                    });
                } else if (typeof init === 'object') {
                    Object.keys(init).forEach(key => {
                        this._headers.set(key.toLowerCase(), init[key]);
                    });
                }
            }

            this.append = (name: string, value: string) => {
                this._headers.set(name.toLowerCase(), value);
            };

            this.delete = (name: string) => {
                this._headers.delete(name.toLowerCase());
            };

            this.get = (name: string) => {
                return this._headers.get(name.toLowerCase()) || null;
            };

            this.has = (name: string) => {
                return this._headers.has(name.toLowerCase());
            };

            this.set = (name: string, value: string) => {
                this._headers.set(name.toLowerCase(), value);
            };

            this.forEach = (callback: (value: string, key: string) => void) => {
                this._headers.forEach(callback);
            };
        };
    }

    /**
     * Validate that polyfills are working correctly
     */
    static validate(): boolean {
        try {
            // Test fetch
            if (typeof fetch === 'undefined') return false;

            // Test Request with destructuring
            const req = new Request('https://example.com', { method: 'GET' });
            const { url, method } = req;
            if (!url || !method) return false;

            // Test Response
            const res = new Response('test', { status: 200 });
            if (!res.ok || typeof res.json !== 'function') return false;

            // Test Headers
            const headers = new Headers({ 'Content-Type': 'application/json' });
            if (typeof headers.get !== 'function') return false;

            return true;
        } catch (error) {
            console.error('Polyfill validation failed:', error);
            return false;
        }
    }
}