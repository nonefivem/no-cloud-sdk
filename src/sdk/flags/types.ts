/**
 * Feature flag types.
 *
 * These mirror the wire format served by the NoCloud API. Keep them in sync with
 * `@no-cloud/common/flags` - the SDK is a published package and cannot import
 * from the API monorepo, so the contract is duplicated here on purpose.
 */

export type JsonPrimitive = string | number | boolean | null;

/**
 * JSON with a bounded nesting depth.
 *
 * The API caps flag value nesting and rejects anything deeper, so spelling the
 * levels out matches the runtime contract exactly and keeps the generated
 * declaration file free of a recursive alias.
 */
type JsonDepth1 =
  | JsonPrimitive
  | JsonPrimitive[]
  | { [key: string]: JsonPrimitive };
type JsonDepth2 = JsonDepth1 | JsonDepth1[] | { [key: string]: JsonDepth1 };
type JsonDepth3 = JsonDepth2 | JsonDepth2[] | { [key: string]: JsonDepth2 };

export type JsonValue =
  | JsonDepth3
  | JsonDepth3[]
  | { [key: string]: JsonDepth3 };

/**
 * A JSON object whose values are full JsonValues. Audit diffs are always
 * objects, never bare primitives.
 */
export type JsonRecord = { [key: string]: JsonValue };

/**
 * The kind of value a flag holds. A flag is a named, typed value - you read it
 * and decide what to do with it.
 */
export type FeatureFlagType = "boolean" | "string" | "number" | "json";

/**
 * Where a flag may be read.
 *
 * Your server always receives every flag - it is the trusted side, and the one
 * holding the API key. The runtime says whether the value may also reach
 * players' clients, which your server is what relays.
 *
 * There is no client-only runtime: a value the client can read is one the
 * server has already been sent.
 */
export type FeatureFlagRuntime = "server" | "shared";

/**
 * A flag's type paired with a value that matches it.
 *
 * Written as a union so the compiler rejects a `number` flag holding a string,
 * which is the same pairing the API validates on write.
 */
export type FlagValuePair =
  | { type: "boolean"; value: boolean }
  | { type: "string"; value: string }
  | { type: "number"; value: number }
  | { type: "json"; value: JsonValue };

/* -------------------------------------------------------------------------- */
/*                                   Config                                   */
/* -------------------------------------------------------------------------- */

/**
 * One flag as it appears in the config payload.
 */
export interface FlagConfigEntry {
  key: string;
  type: FeatureFlagType;
  value: JsonValue;
  /**
   * Whether this flag may be relayed to clients. Every flag reaches your
   * server, so your server is what enforces this - a `server` flag must never
   * be forwarded to a player.
   */
  runtime: FeatureFlagRuntime;
}

/**
 * The full payload served by the config endpoint.
 *
 * `etag` is a hash of the flags it contains, so an unchanged set of flags always
 * produces the same one and a repeat request is answered with a 304.
 */
export interface FlagConfigPayload {
  etag: string;
  generatedAt: string;
  /**
   * Seconds the API suggests waiting before asking again.
   *
   * The SDK does not poll - this is advisory, and useful if you want to drive
   * your own refresh loop.
   */
  pollIntervalSeconds: number;
  flags: FlagConfigEntry[];
}

/* -------------------------------------------------------------------------- */
/*                              Management types                              */
/* -------------------------------------------------------------------------- */

/**
 * A page of results from a list endpoint.
 */
export interface PaginatedResult<T> {
  total: number;
  page: number;
  totalPages: number;
  results: T[];
}

export interface FeatureFlag {
  id: string;
  key: string;
  name: string;
  description: string | null;
  type: FeatureFlagType;
  value: JsonValue;
  runtime: FeatureFlagRuntime;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  /**
   * True when this flag sits beyond the organization's current allowance, which
   * happens after a subscription lapses.
   *
   * Locked flags keep serving their published values so a billing lapse never
   * changes behaviour on a live server, but they cannot be edited until the
   * organization subscribes again or removes enough flags to get back under the
   * limit.
   */
  locked: boolean;
}

/**
 * An organization's feature flag allowance.
 */
export interface FeatureFlagQuota {
  /** Flags allowed at the current subscription level. */
  max: number;
  /** Flags currently defined, archived ones included. */
  used: number;
  /** Whether the organization has any active subscription. */
  subscribed: boolean;
  /** Flags beyond `max`, frozen until the organization subscribes again. */
  locked: number;
}

export interface FeatureFlagListResponse extends PaginatedResult<FeatureFlag> {
  quota: FeatureFlagQuota;
}

export type FeatureFlagActorType = "session" | "apiKey" | "system";

export interface FeatureFlagAuditEntry {
  id: string;
  flagId: string | null;
  flagKey: string | null;
  actorType: FeatureFlagActorType;
  actorId: string | null;
  action: string;
  before: JsonRecord | null;
  after: JsonRecord | null;
  createdAt: string;
}

/* -------------------------------------------------------------------------- */
/*                                  Payloads                                  */
/* -------------------------------------------------------------------------- */

/**
 * A new flag: an identity, and the typed value it starts with.
 */
export type CreateFlagPayload = {
  /** Lowercase slug you read the flag by in code, e.g. "max-players". */
  key: string;
  name: string;
  description?: string;
  /**
   * Whether the value may reach players' clients.
   *
   * Defaults to `shared`, so a flag is client-readable unless it says
   * otherwise - anything holding a secret must be created as `server`.
   */
  runtime?: FeatureFlagRuntime;
} & FlagValuePair;

/**
 * Changes to an existing flag.
 *
 * Keys are immutable - servers reference a flag by key, so renaming one would
 * silently orphan every server reading it.
 *
 * The runtime is not immutable: a flag made client-readable by mistake has to be
 * closable without recreating it under a new key.
 *
 * Changing the value means restating the type. The pair is what servers parse,
 * and passing them together is what keeps a number flag from ending up holding
 * a string.
 */
export type UpdateFlagPayload = {
  name?: string;
  description?: string | null;
  archived?: boolean;
  runtime?: FeatureFlagRuntime;
} & (FlagValuePair | { type?: never; value?: never });

/**
 * Which runtime a read is made on behalf of.
 */
export interface FlagReadOptions {
  /**
   * The runtime reading the flag.
   *
   * `shared` - the default - sees only flags that may reach clients, so a value
   * you are about to relay to a player can never be a server-only one by
   * accident. `server` sees every flag, because your server is the trusted side.
   *
   * A flag the runtime may not read behaves exactly like one that does not
   * exist.
   */
  runtime?: FeatureFlagRuntime;
}

export interface ListFlagsOptions {
  page?: number;
  limit?: number;
  search?: string;
  includeArchived?: boolean;
}

export interface AuditLogOptions {
  page?: number;
  limit?: number;
  flagId?: string;
}
