import type { Fetcher, FetchOptions } from "./fetcher";

export class SDKModule {
  constructor(private readonly fetcher: Fetcher) {}

  protected fetch(endpoint: string, options?: FetchOptions): Promise<Response> {
    return this.fetcher.fetch(endpoint, options);
  }
}
