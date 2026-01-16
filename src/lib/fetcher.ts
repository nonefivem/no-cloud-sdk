import { API_BASE_URL } from "./constants";
import { withRetry } from "./utils";

interface FetchOptionsBase {
  retries?: number;
  retryDelayMs?: number;
}

interface FetcherOptions extends FetchOptionsBase {
  apiKey: string;
  baseUrl?: string;
}

export type FetchOptions = RequestInit & FetchOptionsBase;

export class Fetcher {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly retryCount: number;
  private readonly retryDelayMs: number;

  constructor(options: FetcherOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl || API_BASE_URL;
    this.retryCount = options.retries ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 1000;

    if (!this.apiKey) {
      throw new Error("API key is required");
    }
  }

  private buildUrl(endpoint: string): string {
    return `${this.baseUrl}/cloud/${endpoint}`;
  }

  fetch(endpoint: string, options: FetchOptions = {}): Promise<Response> {
    const url = this.buildUrl(endpoint);

    return withRetry(
      () =>
        fetch(url, {
          ...options,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            ...(options.headers || {}),
          },
        }),
      options.retries ?? this.retryCount,
      options.retryDelayMs ?? this.retryDelayMs
    );
  }
}
