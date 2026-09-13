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

function entry(
  key: string,
  type: FlagConfigEntry["type"],
  value: FlagConfigEntry["value"],
  runtime: FlagConfigEntry["runtime"] = "shared"
): FlagConfigEntry {
  return { key, type, value, runtime };
}

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
      json(config([entry("new-hud", "boolean", true)]), {
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
      json(config([entry("new-hud", "boolean", true)]));
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
          entry("new-hud", "boolean", true),
          entry("maintenance", "boolean", false),
          entry("motd", "string", "Welcome"),
          entry("max-players", "number", 64),
          entry("economy", "json", { payout: 10, tax: 0.2 })
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

describe("runtime", () => {
  beforeEach(() => {
    respond = () =>
      json(
        config([
          entry("new-hud", "boolean", true, "shared"),
          entry("motd", "string", "Welcome", "shared"),
          entry("god-mode", "boolean", true, "server"),
          entry("webhook", "string", "https://hooks.example/secret", "server"),
          entry("payouts", "json", { rate: 2 }, "server"),
          entry("tick-rate", "number", 30, "server")
        ])
      );
  });

  it("hides server-only flags from a read that does not name a runtime", async () => {
    const cloud = createClient();

    expect(await cloud.flags.isEnabled("god-mode")).toBe(false);
    expect(await cloud.flags.getValue("webhook")).toBeUndefined();
    expect(await cloud.flags.getString("webhook")).toBeUndefined();
    expect(await cloud.flags.getJson("payouts")).toBeUndefined();
    expect(await cloud.flags.getNumber("tick-rate")).toBeUndefined();
  });

  it("reads server-only flags for a server runtime", async () => {
    const cloud = createClient();
    const options = { runtime: "server" } as const;

    expect(await cloud.flags.isEnabled("god-mode", false, options)).toBe(true);
    expect(
      await cloud.flags.getString("webhook", undefined, options)
    ).toBe("https://hooks.example/secret");
    expect(await cloud.flags.getNumber("tick-rate", 0, options)).toBe(30);
  });

  it("still reads shared flags for a server runtime", async () => {
    const cloud = createClient();

    expect(
      await cloud.flags.isEnabled("new-hud", false, { runtime: "server" })
    ).toBe(true);
  });

  it("returns the fallback for a flag this runtime may not read", async () => {
    const cloud = createClient();

    expect(await cloud.flags.isEnabled("god-mode", true)).toBe(true);
    expect(await cloud.flags.getString("webhook", "none")).toBe("none");
    expect(await cloud.flags.getNumber("tick-rate", 20)).toBe(20);
  });

  it("gives getAll only what the runtime may read", async () => {
    const cloud = createClient();

    expect(await cloud.flags.getAll()).toEqual({
      "new-hud": true,
      motd: "Welcome"
    });

    expect(Object.keys(await cloud.flags.getAll({ runtime: "server" }))).toEqual(
      ["new-hud", "motd", "god-mode", "webhook", "payouts", "tick-rate"]
    );
  });

  it("gives getFlags only what the runtime may read", async () => {
    const cloud = createClient();

    expect((await cloud.flags.getFlags()).map((flag) => flag.key)).toEqual([
      "new-hud",
      "motd"
    ]);
    expect(await cloud.flags.getFlags({ runtime: "server" })).toHaveLength(6);
  });

  it("leaves the raw config unfiltered, since the server receives every flag", async () => {
    const cloud = createClient();

    expect((await cloud.flags.getConfig()).flags).toHaveLength(6);
  });
});

describe("reading a flag whole", () => {
  beforeEach(() => {
    respond = () =>
      json(
        config([
          entry("max-players", "number", 64, "shared"),
          entry("webhook", "string", "https://hooks.example/secret", "server")
        ])
      );
  });

  it("returns the key, type, value and runtime rather than just the value", async () => {
    const cloud = createClient();

    expect(await cloud.flags.getFlag("max-players")).toEqual({
      key: "max-players",
      type: "number",
      value: 64,
      runtime: "shared"
    });
  });

  it("hides a flag this runtime may not read", async () => {
    const cloud = createClient();

    expect(await cloud.flags.getFlag("webhook")).toBeUndefined();
    expect(
      await cloud.flags.getFlag("webhook", { runtime: "server" })
    ).toEqual({
      key: "webhook",
      type: "string",
      value: "https://hooks.example/secret",
      runtime: "server"
    });
  });

  it("returns undefined for an unknown flag", async () => {
    const cloud = createClient();

    expect(await cloud.flags.getFlag("missing")).toBeUndefined();
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
        ? json(config([entry("new-hud", "boolean", true)]))
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

  it("sends the runtime when one is given", async () => {
    const cloud = createClient();

    respond = () => json({ id: "flag-id" }, { status: 201 });

    await cloud.flags.create({
      key: "webhook",
      name: "Webhook",
      type: "string",
      value: "https://hooks.example/secret",
      runtime: "server"
    });

    expect(JSON.parse(calls[0]?.body ?? "{}").runtime).toBe("server");
  });

  it("omits the runtime when none is given, letting the API default it", async () => {
    const cloud = createClient();

    respond = () => json({ id: "flag-id" }, { status: 201 });

    await cloud.flags.create({
      key: "new-hud",
      name: "New HUD",
      type: "boolean",
      value: true
    });

    expect(JSON.parse(calls[0]?.body ?? "{}")).not.toHaveProperty("runtime");
  });

  it("closes a flag off from clients through update", async () => {
    const cloud = createClient();

    respond = () => json({ id: "flag-id" });

    await cloud.flags.update("flag-id", { runtime: "server" });

    expect(calls[0]?.method).toBe("PATCH");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ runtime: "server" });
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
