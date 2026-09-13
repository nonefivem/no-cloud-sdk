import { Fetcher } from "@/lib";
import { Flags } from "./flags";
import { Storage } from "./storage";

export * from "./flags";

export interface NoCloudOptions {
  /**
   * Your API key for authenticating requests.
   */
  apiKey: string;
  /**
   * Optional base URL for the API.
   * @default "https://api.nonefivem.com"
   */
  baseUrl?: string;
  /**
   * Optional base path for API endpoints.
   * @default "/cloud"
   */
  basePath?: string;
  /**
   * Number of retry attempts for failed requests.
   * @default 3
   */
  retries?: number;
  /**
   * Delay in milliseconds between retry attempts.
   * @default 1000
   */
  retryDelayMs?: number;
  /**
   * How long a fetched feature flag configuration is served from memory before
   * the next read goes back to the API.
   * @default 10
   */
  flagsCacheTtlSeconds?: number;
}

/**
 * Main SDK class for interacting with NoCloud services.
 * @example
 * ```ts
 * // Using a string API key
 * const cloud = new NoCloud("your-api-key");
 *
 * // Using an options object
 * const cloud = new NoCloud({
 *   apiKey: "your-api-key",
 *   baseUrl: "https://api.nonefivem.com",
 *   retries: 5,
 *   retryDelayMs: 2000,
 * });
 * ```
 */
export class NoCloud {
  private readonly fetcher;
  private readonly flagsCacheTtlSeconds?: number;

  /**
   * Creates an instance of the NoCloud SDK.
   * @param options - Your API key or an options object.
   * @example
   * ```ts
   * // Using a string API key
   * const cloud = new NoCloud("your-api-key");
   *
   * // Using an options object
   * const cloud = new NoCloud({
   *   apiKey: "your-api-key",
   *   baseUrl: "https://api.nonefivem.com",
   *   retries: 5,
   *   retryDelayMs: 1000,
   * });
   * ```
   */
  constructor(options: string | NoCloudOptions) {
    if (typeof options === "string") {
      options = { apiKey: options };
    }

    this.fetcher = new Fetcher({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      basePath: options.basePath,
      retries: options.retries,
      retryDelayMs: options.retryDelayMs,
    });
    this.flagsCacheTtlSeconds = options.flagsCacheTtlSeconds;
  }

  private _storage?: Storage;
  /**
   * Storage module for handling file storage operations.
   */
  get storage(): Storage {
    return (this._storage ??= new Storage(this.fetcher));
  }

  private _flags?: Flags;
  /**
   * Feature flags module for reading and managing feature flags.
   */
  get flags(): Flags {
    return (this._flags ??= new Flags(this.fetcher, this.flagsCacheTtlSeconds));
  }
}
