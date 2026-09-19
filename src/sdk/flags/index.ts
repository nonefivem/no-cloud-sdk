import type { Fetcher } from "@/lib/fetcher";
import { resolveJsonResponse } from "@/lib/resolvers";
import { SDKModule } from "@/lib/sdk-module";
import { buildQueryString } from "@/lib/utils";
import type {
  AuditLogOptions,
  CreateFlagPayload,
  FeatureFlag,
  FeatureFlagAuditEntry,
  FeatureFlagListResponse,
  FeatureFlagQuota,
  FeatureFlagRuntime,
  FlagConfigEntry,
  FlagConfigPayload,
  FlagReadOptions,
  JsonValue,
  ListFlagsOptions,
  PaginatedResult,
  UpdateFlagPayload
} from "./types";

export * from "./types";

const JSON_HEADERS = { "Content-Type": "application/json" };

/**
 * How long a fetched config is served from memory before the next read goes back
 * to the API.
 */
export const DEFAULT_FLAGS_CACHE_TTL_SECONDS = 10;

/**
 * Runtime a read is made on behalf of when the caller does not state one.
 *
 * `shared` is the safe default: a read never hands back a server-only value to
 * code that may be about to relay it to a player.
 */
export const DEFAULT_FLAG_RUNTIME: FeatureFlagRuntime = "shared";

/**
 * Whether a runtime lets players' clients read the flag.
 *
 * The single place the rule lives, so a runtime added later has to make a
 * deliberate choice here rather than falling on whichever side of a comparison
 * some call site happened to write.
 *
 * @param runtime - The flag's runtime.
 */
export function isClientReadable(runtime: FeatureFlagRuntime): boolean {
  return runtime !== "server";
}

/**
 * A config payload held locally, with what is needed to revalidate it cheaply.
 */
interface CachedConfig {
  payload: FlagConfigPayload;
  /** ETag from the response, replayed as `If-None-Match` on the next request. */
  etag: string | null;
  fetchedAt: number;
}

/**
 * Feature flags module.
 *
 * A flag is a named, typed value. Reading one serves the configuration from
 * memory when it was fetched within the cache window, and goes to the API
 * otherwise - so a read is usually free, and never more than one request per
 * window no matter how often you call it.
 *
 * The SDK does not poll in the background; the refresh happens on the read that
 * finds the cache stale.
 *
 * @example
 * ```ts
 * const cloud = new NoCloud({ apiKey: "your-api-key", flagsCacheTtlSeconds: 30 });
 *
 * if (await cloud.flags.isEnabled("new-hud")) {
 *   showNewHud();
 * }
 *
 * const maxPlayers = await cloud.flags.getNumber("max-players", 32);
 * ```
 */
export class Flags extends SDKModule {
  private readonly cacheTtlMs: number;

  private cached?: CachedConfig;
  /** Shared by concurrent reads so a cold cache costs one request, not many. */
  private inFlight?: Promise<FlagConfigPayload>;

  constructor(
    fetcher: Fetcher,
    cacheTtlSeconds: number = DEFAULT_FLAGS_CACHE_TTL_SECONDS
  ) {
    super(fetcher);
    this.cacheTtlMs = Math.max(0, cacheTtlSeconds) * 1000;
  }

  /* -------------------------------- Config -------------------------------- */

  /**
   * Requests the config, replaying the cached ETag so an unchanged config comes
   * back as a 304 with no body.
   */
  private async requestConfig(): Promise<FlagConfigPayload> {
    const cached = this.cached;

    const response = await this.fetch("flags/config", {
      headers: cached?.etag ? { "If-None-Match": cached.etag } : undefined
    });

    // Nothing changed - keep what we already hold and restart its cache window.
    if (response.status === 304 && cached) {
      cached.fetchedAt = Date.now();
      return cached.payload;
    }

    const payload = await resolveJsonResponse<FlagConfigPayload>(response);

    this.cached = {
      payload,
      etag: response.headers.get("ETag"),
      fetchedAt: Date.now()
    };

    return payload;
  }

  /**
   * Fetches the config, collapsing concurrent callers onto one request.
   */
  private fetchConfig(): Promise<FlagConfigPayload> {
    if (!this.inFlight) {
      this.inFlight = this.requestConfig().finally(() => {
        this.inFlight = undefined;
      });
    }

    return this.inFlight;
  }

  private isFresh(cached: CachedConfig): boolean {
    return Date.now() - cached.fetchedAt < this.cacheTtlMs;
  }

  /**
   * Returns the flag configuration, from memory when it is still within the
   * cache window and from the API otherwise.
   *
   * If the request fails while a previous config is held, that config is
   * returned rather than throwing - an API blip must never change the values a
   * running server reads. The cache window restarts in that case too, so an
   * outage costs one request per window instead of one per read. Use
   * {@link refresh} when you need the failure to surface.
   *
   * @returns {Promise<FlagConfigPayload>} The flag configuration.
   * @throws {NoCloudAPIError} If the request fails and no config is held yet.
   */
  async getConfig(): Promise<FlagConfigPayload> {
    const cached = this.cached;

    if (cached && this.isFresh(cached)) {
      return cached.payload;
    }

    try {
      return await this.fetchConfig();
    } catch (error) {
      if (!cached) throw error;

      cached.fetchedAt = Date.now();

      return cached.payload;
    }
  }

  /**
   * Fetches the flag configuration from the API, ignoring the cache window.
   *
   * Unlike {@link getConfig} this always surfaces a failure, so it is the right
   * call when you want to know whether the API is reachable.
   *
   * @returns {Promise<FlagConfigPayload>} The current flag configuration.
   * @throws {NoCloudAPIError} If the API request fails.
   */
  async refresh(): Promise<FlagConfigPayload> {
    return this.fetchConfig();
  }

  /**
   * Returns the config currently held in memory without contacting the API.
   * @returns {FlagConfigPayload | null} The cached config, or null if none has
   * been fetched yet.
   */
  getCachedConfig(): FlagConfigPayload | null {
    return this.cached?.payload ?? null;
  }

  /**
   * Discards the cached config so the next read goes back to the API.
   */
  clearCache(): void {
    this.cached = undefined;
  }

  /* --------------------------------- Values -------------------------------- */

  /**
   * Whether a read made on behalf of `runtime` is allowed to see this flag.
   *
   * The server is the trusted side and sees everything; a shared read sees only
   * what may reach a client.
   */
  private static visible(
    entry: FlagConfigEntry,
    runtime: FeatureFlagRuntime
  ): boolean {
    return runtime === "server" || isClientReadable(entry.runtime);
  }

  /**
   * Looks up one flag, treating a flag the runtime may not read as absent.
   */
  private async entry(
    key: string,
    options?: FlagReadOptions
  ): Promise<FlagConfigEntry | undefined> {
    const runtime = options?.runtime ?? DEFAULT_FLAG_RUNTIME;
    const config = await this.getConfig();
    const entry = config.flags.find((flag) => flag.key === key);

    return entry && Flags.visible(entry, runtime) ? entry : undefined;
  }

  /**
   * Reads a flag whole - its key, type, value and runtime - rather than just the
   * value.
   *
   * @param key - The flag's key.
   * @param options - The runtime reading the flag. Defaults to `shared`.
   * @returns {Promise<FlagConfigEntry | undefined>} The flag, or undefined if no
   * such flag exists or this runtime may not read it.
   * @throws {NoCloudAPIError} If the config cannot be fetched and none is held.
   */
  async getFlag(
    key: string,
    options?: FlagReadOptions
  ): Promise<FlagConfigEntry | undefined> {
    return this.entry(key, options);
  }

  /**
   * Reads every flag whole, in the order the API returned them.
   *
   * With the default `shared` runtime this is exactly the set that is safe to
   * relay to a player.
   *
   * @param options - The runtime reading the flags. Defaults to `shared`.
   * @returns {Promise<FlagConfigEntry[]>} The flags this runtime may read.
   * @throws {NoCloudAPIError} If the config cannot be fetched and none is held.
   */
  async getFlags(options?: FlagReadOptions): Promise<FlagConfigEntry[]> {
    const runtime = options?.runtime ?? DEFAULT_FLAG_RUNTIME;
    const config = await this.getConfig();

    return config.flags.filter((flag) => Flags.visible(flag, runtime));
  }

  /**
   * Reads a flag's raw value, whatever its type.
   * @param key - The flag's key.
   * @param options - The runtime reading the flag. Defaults to `shared`.
   * @returns {Promise<JsonValue | undefined>} The value, or undefined if no such
   * flag exists or this runtime may not read it.
   * @throws {NoCloudAPIError} If the config cannot be fetched and none is held.
   */
  async getValue(
    key: string,
    options?: FlagReadOptions
  ): Promise<JsonValue | undefined> {
    return (await this.entry(key, options))?.value;
  }

  /**
   * Reads the flags this runtime may see as a plain key/value object.
   * @param options - The runtime reading the flags. Defaults to `shared`.
   * @returns {Promise<Record<string, JsonValue>>} Each flag's key and value.
   * @throws {NoCloudAPIError} If the config cannot be fetched and none is held.
   */
  async getAll(options?: FlagReadOptions): Promise<Record<string, JsonValue>> {
    const values: Record<string, JsonValue> = {};

    for (const flag of await this.getFlags(options)) {
      values[flag.key] = flag.value;
    }

    return values;
  }

  /**
   * Reads a boolean flag.
   * @param key - The flag's key.
   */
  async getBoolean(key: string): Promise<boolean | undefined>;
  /**
   * Reads a boolean flag, falling back when it is missing, holds another type,
   * or may not be read by this runtime.
   * @param key - The flag's key.
   * @param fallback - Returned when the flag is not a readable boolean flag.
   * @param options - The runtime reading the flag. Defaults to `shared`.
   */
  async getBoolean(
    key: string,
    fallback: boolean,
    options?: FlagReadOptions
  ): Promise<boolean>;
  /**
   * Reads a boolean flag on behalf of a runtime, with no fallback.
   * @param key - The flag's key.
   * @param fallback - Pass undefined to read without a fallback.
   * @param options - The runtime reading the flag.
   */
  async getBoolean(
    key: string,
    fallback: undefined,
    options: FlagReadOptions
  ): Promise<boolean | undefined>;
  async getBoolean(
    key: string,
    fallback?: boolean,
    options?: FlagReadOptions
  ): Promise<boolean | undefined> {
    const entry = await this.entry(key, options);

    return entry?.type === "boolean" && typeof entry.value === "boolean"
      ? entry.value
      : fallback;
  }

  /**
   * Reads a string flag.
   * @param key - The flag's key.
   */
  async getString(key: string): Promise<string | undefined>;
  /**
   * Reads a string flag, falling back when it is missing, holds another type, or
   * may not be read by this runtime.
   * @param key - The flag's key.
   * @param fallback - Returned when the flag is not a readable string flag.
   * @param options - The runtime reading the flag. Defaults to `shared`.
   */
  async getString(
    key: string,
    fallback: string,
    options?: FlagReadOptions
  ): Promise<string>;
  /**
   * Reads a string flag on behalf of a runtime, with no fallback.
   * @param key - The flag's key.
   * @param fallback - Pass undefined to read without a fallback.
   * @param options - The runtime reading the flag.
   */
  async getString(
    key: string,
    fallback: undefined,
    options: FlagReadOptions
  ): Promise<string | undefined>;
  async getString(
    key: string,
    fallback?: string,
    options?: FlagReadOptions
  ): Promise<string | undefined> {
    const entry = await this.entry(key, options);

    return entry?.type === "string" && typeof entry.value === "string"
      ? entry.value
      : fallback;
  }

  /**
   * Reads a number flag.
   * @param key - The flag's key.
   */
  async getNumber(key: string): Promise<number | undefined>;
  /**
   * Reads a number flag, falling back when it is missing, holds another type, or
   * may not be read by this runtime.
   * @param key - The flag's key.
   * @param fallback - Returned when the flag is not a readable number flag.
   * @param options - The runtime reading the flag. Defaults to `shared`.
   */
  async getNumber(
    key: string,
    fallback: number,
    options?: FlagReadOptions
  ): Promise<number>;
  /**
   * Reads a number flag on behalf of a runtime, with no fallback.
   * @param key - The flag's key.
   * @param fallback - Pass undefined to read without a fallback.
   * @param options - The runtime reading the flag.
   */
  async getNumber(
    key: string,
    fallback: undefined,
    options: FlagReadOptions
  ): Promise<number | undefined>;
  async getNumber(
    key: string,
    fallback?: number,
    options?: FlagReadOptions
  ): Promise<number | undefined> {
    const entry = await this.entry(key, options);

    return entry?.type === "number" && typeof entry.value === "number"
      ? entry.value
      : fallback;
  }

  /**
   * Reads a JSON flag.
   * @param key - The flag's key.
   */
  async getJson<T = JsonValue>(key: string): Promise<T | undefined>;
  /**
   * Reads a JSON flag, falling back when it is missing, holds another type, or
   * may not be read by this runtime.
   * @param key - The flag's key.
   * @param fallback - Returned when the flag is not a readable JSON flag.
   * @param options - The runtime reading the flag. Defaults to `shared`.
   */
  async getJson<T = JsonValue>(
    key: string,
    fallback: T,
    options?: FlagReadOptions
  ): Promise<T>;
  /**
   * Reads a JSON flag on behalf of a runtime, with no fallback.
   * @param key - The flag's key.
   * @param fallback - Pass undefined to read without a fallback.
   * @param options - The runtime reading the flag.
   */
  async getJson<T = JsonValue>(
    key: string,
    fallback: undefined,
    options: FlagReadOptions
  ): Promise<T | undefined>;
  async getJson<T = JsonValue>(
    key: string,
    fallback?: T,
    options?: FlagReadOptions
  ): Promise<T | undefined> {
    const entry = await this.entry(key, options);

    return entry?.type === "json" ? (entry.value as T) : fallback;
  }

  /**
   * Checks whether a boolean flag is on.
   *
   * A missing flag, one holding a non-boolean value, or one this runtime may not
   * read, reads as `fallback` - so deleting a flag can never throw in
   * production, and a server-only flag never leaks through a shared read.
   *
   * @param key - The flag's key.
   * @param fallback - Returned when the flag is not a readable boolean flag.
   * Defaults to false.
   * @param options - The runtime reading the flag. Defaults to `shared`.
   * @returns {Promise<boolean>} Whether the flag is on.
   * @throws {NoCloudAPIError} If the config cannot be fetched and none is held.
   */
  async isEnabled(
    key: string,
    fallback = false,
    options?: FlagReadOptions
  ): Promise<boolean> {
    return this.getBoolean(key, fallback, options);
  }

  /* ------------------------------ Management ------------------------------ */

  /**
   * Lists the organization's flags.
   * @param options - Pagination, search, and whether to include archived flags.
   * @returns {Promise<FeatureFlagListResponse>} A page of flags, plus the
   * organization's flag allowance.
   * @throws {NoCloudAPIError} If the API request fails.
   */
  async list(options?: ListFlagsOptions): Promise<FeatureFlagListResponse> {
    const query = buildQueryString({
      page: options?.page,
      limit: options?.limit,
      search: options?.search,
      includeArchived: options?.includeArchived
    });

    const response = await this.fetch(`flags${query}`);

    return resolveJsonResponse<FeatureFlagListResponse>(response);
  }

  /**
   * Creates a flag.
   * @param options - The flag's key, name, and the typed value it starts with.
   * @returns {Promise<FeatureFlag>} The created flag.
   * @throws {NoCloudAPIError} If the API request fails, including when the
   * organization is at its flag allowance or the key is already taken.
   */
  async create(options: CreateFlagPayload): Promise<FeatureFlag> {
    const response = await this.fetch("flags", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(options)
    });

    const flag = await resolveJsonResponse<FeatureFlag>(response);

    this.clearCache();

    return flag;
  }

  /**
   * Fetches a single flag by its ID.
   *
   * To read a flag's *value* by key, use {@link getValue} and the typed readers -
   * they serve from the cached config instead of making a request per flag.
   *
   * @param flagId - The ID of the flag.
   * @returns {Promise<FeatureFlag>} The flag.
   * @throws {NoCloudAPIError} If the API request fails.
   */
  async get(flagId: string): Promise<FeatureFlag> {
    const response = await this.fetch(`flags/${flagId}`);

    return resolveJsonResponse<FeatureFlag>(response);
  }

  /**
   * Renames, archives, or sets a flag's value - the change servers pick up.
   *
   * Changing the value means passing its type alongside it.
   *
   * @param flagId - The ID of the flag.
   * @param options - The fields to change.
   * @returns {Promise<FeatureFlag>} The updated flag.
   * @throws {NoCloudAPIError} If the API request fails, including when the flag
   * is locked by the organization's allowance.
   */
  async update(
    flagId: string,
    options: UpdateFlagPayload
  ): Promise<FeatureFlag> {
    const response = await this.fetch(`flags/${flagId}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify(options)
    });

    const flag = await resolveJsonResponse<FeatureFlag>(response);

    this.clearCache();

    return flag;
  }

  /**
   * Deletes a flag.
   * @param flagId - The ID of the flag to delete.
   * @returns {Promise<void>} Resolves once the flag is deleted.
   * @throws {NoCloudAPIError} If the API request fails.
   */
  async delete(flagId: string): Promise<void> {
    const response = await this.fetch(`flags/${flagId}`, { method: "DELETE" });

    await resolveJsonResponse<{ message: string }>(response);

    this.clearCache();
  }

  /* --------------------------- Quota & audit log -------------------------- */

  /**
   * Fetches the organization's flag allowance.
   * @returns {Promise<FeatureFlagQuota>} How many flags are allowed, used and
   * locked at the current subscription level.
   * @throws {NoCloudAPIError} If the API request fails.
   */
  async getQuota(): Promise<FeatureFlagQuota> {
    const response = await this.fetch("flags/quota");

    return resolveJsonResponse<FeatureFlagQuota>(response);
  }

  /**
   * Fetches the flag audit log - who changed what, and when.
   * @param options - Pagination and an optional flag filter.
   * @returns {Promise<PaginatedResult<FeatureFlagAuditEntry>>} A page of entries,
   * newest first.
   * @throws {NoCloudAPIError} If the API request fails.
   */
  async getAuditLog(
    options?: AuditLogOptions
  ): Promise<PaginatedResult<FeatureFlagAuditEntry>> {
    const query = buildQueryString({
      page: options?.page,
      limit: options?.limit,
      flagId: options?.flagId
    });

    const response = await this.fetch(`flags/audit${query}`);

    return resolveJsonResponse<PaginatedResult<FeatureFlagAuditEntry>>(response);
  }
}
