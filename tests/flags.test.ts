import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NoCloud, NoCloudAPIError, NoCloudError } from "../src";
import type { FlagConfigEntry, FlagConfigPayload } from "../src";

/**
 * These tests drive the flags module against a stubbed `fetch` rather than the
 * live API: the behaviour worth pinning down here is local - the cache window,
 * ETag revalidation, and what values a read returns when the API is unreachable.
 */

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

const realFetch = globalThis.fetch;

let calls: Call[];
let respond: (call: Call) => Response;

function config(flags: FlagConfigEntry[] = []): FlagConfigPayload {
  return {
    etag: "abc123",
    generatedAt: new Date().toISOString(),
    pollIntervalSeconds: 20,
    flags
  };
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers }
  });
}

/** A client with retries off, so a failing request fails immediately. */
function createClient(options: { flagsCacheTtlSeconds?: number } = {}): NoCloud {
  return new NoCloud({
    apiKey: "test-key",
    baseUrl: "https://api.test",
    retries: 0,
    ...options
  });
}

beforeEach(() => {
  calls = [];
  respond = () => json(config());

  globalThis.fetch = (async (
    input: Parameters<typeof fetch>[0],
    init?: RequestInit
  ) => {
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>)
    );
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body: init?.body as string | undefined
    };

    calls.push(call);
    return respond(call);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("getConfig", () => {
  it("fetches the config from the cloud flags endpoint", async () => {
    const cloud = createClient();
    const payload = await cloud.flags.getConfig();

    expect(payload.etag).toBe("abc123");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.test/cloud/flags/config");
    expect(calls[0]?.headers.Authorization).toBe("Bearer test-key");
  });

  it("serves the cached config inside the cache window", async () => {
    const cloud = createClient();

    await cloud.flags.getConfig();
    await cloud.flags.getConfig();
    await cloud.flags.getConfig();

    expect(calls).toHaveLength(1);
  });

  it("goes back to the API once the cache window has passed", async () => {
    const cloud = createClient({ flagsCacheTtlSeconds: 0.02 });

    await cloud.flags.getConfig();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await cloud.flags.getConfig();

    expect(calls).toHaveLength(2);
  });

  it("collapses concurrent reads onto a single request", async () => {
    const cloud = createClient();

    await Promise.all([
      cloud.flags.getConfig(),
      cloud.flags.getConfig(),
      cloud.flags.isEnabled("new-hud"),
      cloud.flags.getValue("max-players")
    ]);

    expect(calls).toHaveLength(1);
  });

  it("revalidates with If-None-Match and keeps the payload on a 304", async () => {
    const cloud = createClient({ flagsCacheTtlSeconds: 0 });

    respond = () =>
      json(config([{ key: "new-hud", type: "boolean", value: true }]), {
        headers: { ETag: 'W/"abc123"' }
      });
    const first = await cloud.flags.getConfig();

    respond = () => new Response(null, { status: 304 });
    const second = await cloud.flags.getConfig();

    expect(calls).toHaveLength(2);
    expect(calls[1]?.headers["If-None-Match"]).toBe('W/"abc123"');
    expect(second).toEqual(first);
  });

  it("picks up a new payload when the flags have changed", async () => {
    const cloud = createClient({ flagsCacheTtlSeconds: 0 });

    await cloud.flags.getConfig();

    respond = () =>
      json(config([{ key: "new-hud", type: "boolean", value: true }]));
    const updated = await cloud.flags.getConfig();

    expect(updated.flags).toHaveLength(1);
  });

  it("keeps serving the last known config when the API fails", async () => {
    const cloud = createClient({ flagsCacheTtlSeconds: 0 });

    const first = await cloud.flags.getConfig();

    respond = () => json({ message: "Service unavailable" }, { status: 503 });
    const second = await cloud.flags.getConfig();

    expect(second).toEqual(first);
  });

  it("does not retry on every read while the API is down", async () => {
    const cloud = createClient({ flagsCacheTtlSeconds: 0.05 });

    await cloud.flags.getConfig();
    await new Promise((resolve) => setTimeout(resolve, 60));

    respond = () => json({ message: "Service unavailable" }, { status: 503 });

    // One failed attempt restarts the cache window, so the reads behind it are
    // served from memory rather than each making a request of their own.
    await cloud.flags.getConfig();
    await cloud.flags.getConfig();
    await cloud.flags.getConfig();

    expect(calls).toHaveLength(2);
  });

  it("throws when the API fails and no config has been fetched", async () => {
    const cloud = createClient();

    respond = () => json({ message: "Invalid API key" }, { status: 401 });

    expect(cloud.flags.getConfig()).rejects.toThrow(NoCloudAPIError);
  });

  it("maps API failures onto NoCloudError codes", async () => {
    const cloud = createClient();

    respond = () => json({ message: "Slow down" }, { status: 429 });

    try {
      await cloud.flags.getConfig();
      throw new Error("Expected getConfig to throw");
    } catch (error) {
      expect(
        NoCloudAPIError.isError(error, NoCloudError.RATE_LIMIT_EXCEEDED)
      ).toBe(true);
    }
  });
});

describe("refresh", () => {
  it("surfaces the failure instead of falling back to the cached config", async () => {
    const cloud = createClient();

    await cloud.flags.getConfig();

    respond = () => json({ message: "Service unavailable" }, { status: 503 });

    expect(cloud.flags.refresh()).rejects.toThrow(NoCloudAPIError);
  });

  it("always contacts the API, even inside the cache window", async () => {
    const cloud = createClient();

    await cloud.flags.getConfig();
    await cloud.flags.refresh();

    expect(calls).toHaveLength(2);
  });
});

describe("reading values", () => {
  beforeEach(() => {
    respond = () =>
      json(
        config([
          { key: "new-hud", type: "boolean", value: true },
          { key: "maintenance", type: "boolean", value: false },
          { key: "motd", type: "string", value: "Welcome" },
          { key: "max-players", type: "number", value: 64 },
          { key: "economy", type: "json", value: { payout: 10, tax: 0.2 } }
        ])
      );
  });

  it("fetches the config on the first read", async () => {
    const cloud = createClient();

    expect(await cloud.flags.isEnabled("new-hud")).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("reads each type through its typed reader", async () => {
    const cloud = createClient();

    expect(await cloud.flags.getBoolean("new-hud")).toBe(true);
    expect(await cloud.flags.getString("motd")).toBe("Welcome");
    expect(await cloud.flags.getNumber("max-players")).toBe(64);
    expect(
      await cloud.flags.getJson<{ payout: number; tax: number }>("economy")
    ).toEqual({ payout: 10, tax: 0.2 });
  });

  it("reads a raw value regardless of type", async () => {
    const cloud = createClient();

    expect(await cloud.flags.getValue("max-players")).toBe(64);
    expect(await cloud.flags.getValue("motd")).toBe("Welcome");
  });

  it("reads every flag as a key/value object", async () => {
    const cloud = createClient();

    expect(await cloud.flags.getAll()).toEqual({
      "new-hud": true,
      maintenance: false,
      motd: "Welcome",
      "max-players": 64,
      economy: { payout: 10, tax: 0.2 }
    });
  });

  it("reports a disabled boolean flag as off", async () => {
    const cloud = createClient();

    expect(await cloud.flags.isEnabled("maintenance")).toBe(false);
  });

  it("treats an unknown flag as off rather than throwing", async () => {
    const cloud = createClient();

    expect(await cloud.flags.isEnabled("missing")).toBe(false);
    expect(await cloud.flags.getValue("missing")).toBeUndefined();
    expect(await cloud.flags.getString("missing")).toBeUndefined();
  });

  it("returns the fallback for an unknown flag", async () => {
    const cloud = createClient();

    expect(await cloud.flags.isEnabled("missing", true)).toBe(true);
    expect(await cloud.flags.getString("missing", "default")).toBe("default");
    expect(await cloud.flags.getNumber("missing", 32)).toBe(32);
    expect(await cloud.flags.getJson("missing", { a: 1 })).toEqual({ a: 1 });
  });

  it("falls back rather than coercing a flag of another type", async () => {
    const cloud = createClient();

    expect(await cloud.flags.getNumber("motd", 32)).toBe(32);
    expect(await cloud.flags.getString("max-players", "none")).toBe("none");
    expect(await cloud.flags.getBoolean("motd", false)).toBe(false);
    expect(await cloud.flags.isEnabled("max-players")).toBe(false);
  });

  it("serves later reads from the cached config", async () => {
    const cloud = createClient();

    await cloud.flags.isEnabled("new-hud");
    await cloud.flags.getString("motd");
    await cloud.flags.getNumber("max-players");

    expect(calls).toHaveLength(1);
  });
});

describe("cache control", () => {
  it("exposes the cached config without contacting the API", async () => {
    const cloud = createClient();

    expect(cloud.flags.getCachedConfig()).toBeNull();

    await cloud.flags.getConfig();

    expect(cloud.flags.getCachedConfig()?.etag).toBe("abc123");
    expect(calls).toHaveLength(1);
  });

  it("refetches after the cache is cleared", async () => {
    const cloud = createClient();

    await cloud.flags.getConfig();
    cloud.flags.clearCache();
    await cloud.flags.getConfig();

    expect(calls).toHaveLength(2);
  });

  it("refetches after a flag is changed through the SDK", async () => {
    const cloud = createClient();

    await cloud.flags.getConfig();

    respond = (call) =>
      call.url.endsWith("/config")
        ? json(config([{ key: "new-hud", type: "boolean", value: true }]))
        : json({ id: "flag-id" });

    await cloud.flags.update("flag-id", { type: "boolean", value: true });

    expect(await cloud.flags.isEnabled("new-hud")).toBe(true);
  });
});

describe("management", () => {
  it("lists flags with pagination and search", async () => {
    const cloud = createClient();

    respond = () =>
      json({ total: 0, page: 1, totalPages: 0, results: [], quota: {} });

    await cloud.flags.list({ page: 2, limit: 10, search: "hud" });

    expect(calls[0]?.url).toBe(
      "https://api.test/cloud/flags?page=2&limit=10&search=hud"
    );
  });

  it("omits list options that were not provided", async () => {
    const cloud = createClient();

    respond = () =>
      json({ total: 0, page: 1, totalPages: 0, results: [], quota: {} });

    await cloud.flags.list();

    expect(calls[0]?.url).toBe("https://api.test/cloud/flags");
  });

  it("creates a flag with its typed value", async () => {
    const cloud = createClient();

    respond = () => json({ id: "flag-id", key: "max-players" }, { status: 201 });

    await cloud.flags.create({
      key: "max-players",
      name: "Max players",
      type: "number",
      value: 64
    });

    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe("https://api.test/cloud/flags");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      key: "max-players",
      name: "Max players",
      type: "number",
      value: 64
    });
  });

  it("fetches a single flag by id", async () => {
    const cloud = createClient();

    respond = () => json({ id: "flag-id" });

    await cloud.flags.get("flag-id");

    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toBe("https://api.test/cloud/flags/flag-id");
  });

  it("updates a flag with PATCH", async () => {
    const cloud = createClient();

    respond = () => json({ id: "flag-id" });

    await cloud.flags.update("flag-id", { archived: true });

    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.url).toBe("https://api.test/cloud/flags/flag-id");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ archived: true });
  });

  it("sends type alongside value when setting a flag's value", async () => {
    const cloud = createClient();

    respond = () => json({ id: "flag-id" });

    await cloud.flags.update("flag-id", { type: "string", value: "Closed" });

    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      type: "string",
      value: "Closed"
    });
  });

  it("deletes a flag", async () => {
    const cloud = createClient();

    respond = () => json({ message: "Feature flag deleted successfully" });

    await cloud.flags.delete("flag-id");

    expect(calls[0]?.method).toBe("DELETE");
    expect(calls[0]?.url).toBe("https://api.test/cloud/flags/flag-id");
  });

  it("fetches the flag quota", async () => {
    const cloud = createClient();

    respond = () => json({ max: 5, used: 2, subscribed: false, locked: 0 });

    const quota = await cloud.flags.getQuota();

    expect(calls[0]?.url).toBe("https://api.test/cloud/flags/quota");
    expect(quota.max).toBe(5);
  });

  it("fetches the audit log with filters", async () => {
    const cloud = createClient();

    respond = () => json({ total: 0, page: 1, totalPages: 0, results: [] });

    await cloud.flags.getAuditLog({ flagId: "flag-id", limit: 5 });

    expect(calls[0]?.url).toBe(
      "https://api.test/cloud/flags/audit?limit=5&flagId=flag-id"
    );
  });
});
