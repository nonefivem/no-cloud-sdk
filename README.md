<div align="center">
  <img src="https://assets.nonefivem.com/logo/dark-bg.png" alt="NoneM Logo" width="200" />
  
  # @nocloud/sdk
  
  **Official SDK for NoCloud services**
  
  [![npm version](https://img.shields.io/npm/v/@nocloud/sdk?style=for-the-badge)](https://www.npmjs.com/package/@nocloud/sdk)
  [![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](https://opensource.org/licenses/MIT)
  
</div>

---

## 🚀 Getting Started

### Installation

```bash
npm install @nocloud/sdk
# or
bun add @nocloud/sdk
# or
pnpm add @nocloud/sdk
```

### Quick Start

```typescript
import { NoCloud } from "@nocloud/sdk";

const cloud = new NoCloud("your-api-key");

// Upload a file
const file = new File(["hello"], "hello.txt", { type: "text/plain" });
const { id, url } = await cloud.storage.upload(file);

console.log(`Uploaded: ${url}`);

// Delete a file
await cloud.storage.delete(id);

// Read a feature flag
if (await cloud.flags.isEnabled("new-hud")) {
  console.log("New HUD is on");
}
```

---

## 📖 Usage

### Initialize

```typescript
import { NoCloud } from "@nocloud/sdk";

// Simple
const cloud = new NoCloud("your-api-key");

// With options
const cloud = new NoCloud({
  apiKey: "your-api-key",
  baseUrl: "https://api.nonefivem.com", // optional
  retries: 3, // optional
  retryDelayMs: 1000, // optional
  flagsCacheTtlSeconds: 10 // optional, feature flag cache window
});
```

### 📦 Storage

#### Upload a File

```typescript
// From File/Blob
const file = new File(["content"], "file.txt", { type: "text/plain" });
const { id, url } = await cloud.storage.upload(file);

// From ArrayBuffer
const buffer = new ArrayBuffer(8);
const { id, url } = await cloud.storage.upload(buffer);

// From base64 string (auto-detects mime type)
const base64 = "iVBORw0KGgo..."; // PNG base64
const { id, url } = await cloud.storage.upload(base64);

// With metadata
const { id, url } = await cloud.storage.upload(file, {
  userId: "123",
  category: "avatars"
});
```

#### Upload a Stream

```typescript
const stream = getReadableStream();
const { id, url } = await cloud.storage.uploadStream(
  stream,
  "video/mp4",
  fileSize
);
```

#### Delete a File

```typescript
await cloud.storage.delete(mediaId);
```

#### Supported Body Types

| Type          | Description          |
| ------------- | -------------------- |
| `File`        | Browser File object  |
| `Blob`        | Binary data          |
| `ArrayBuffer` | Raw binary buffer    |
| `string`      | Base64 or plain text |

Base64 strings with data URLs (`data:image/png;base64,...`) or raw base64 are automatically detected and the mime type is inferred.

### 🚩 Feature Flags

A feature flag is a **named, typed value**. You read it and decide what to do
with it.

| Type      | Holds                     |
| --------- | ------------------------- |
| `boolean` | `true` / `false`          |
| `string`  | Any string                |
| `number`  | Any finite number         |
| `json`    | An arbitrary JSON value   |

#### Reading Flags

```typescript
// Booleans
if (await cloud.flags.isEnabled("new-hud")) {
  showNewHud();
}

// Typed readers, with an optional fallback
const motd = await cloud.flags.getString("motd", "Welcome");
const maxPlayers = await cloud.flags.getNumber("max-players", 32);
const economy = await cloud.flags.getJson<EconomyConfig>("economy");

// Raw value, whatever the type
const value = await cloud.flags.getValue("max-players");

// Everything at once
const all = await cloud.flags.getAll(); // { "new-hud": true, "motd": "Welcome", ... }
```

A flag that does not exist — or that holds a different type than you asked for —
reads as the fallback, or `undefined` when you did not pass one. `isEnabled`
defaults to `false`. Deleting a flag in the dashboard can never throw on a
running server.

#### Caching

Reads are served from memory. The first read fetches the configuration, and
every read within the cache window is free; the first read after it goes back to
the API. The SDK does **not** poll in the background.

```typescript
const cloud = new NoCloud({
  apiKey: "your-api-key",
  flagsCacheTtlSeconds: 30 // default: 10
});
```

Refreshes revalidate with an `ETag`, so an unchanged configuration costs a `304`
and no transfer. Concurrent reads share a single request.

If the API is unreachable the last known configuration keeps being served — a
blip never changes the values a running server reads — and the cache window
restarts, so an outage costs one request per window rather than one per read.

```typescript
await cloud.flags.refresh(); // force a fetch; throws if the API is unreachable
cloud.flags.getCachedConfig(); // what is held right now, no request
cloud.flags.clearCache(); // next read goes back to the API
```

#### Managing Flags

```typescript
// Create a flag with its starting value
const flag = await cloud.flags.create({
  key: "max-players",
  name: "Max players",
  type: "number",
  value: 64
});

// Change the value — the type comes with it
await cloud.flags.update(flag.id, { type: "number", value: 128 });

// Rename or archive (no type needed)
await cloud.flags.update(flag.id, { name: "Player cap", archived: true });

await cloud.flags.list({ search: "player", includeArchived: true });
await cloud.flags.get(flag.id);
await cloud.flags.delete(flag.id);
```

Keys are immutable — servers reference a flag by key, so renaming one would
orphan every server reading it.

#### Quota & Audit Log

```typescript
const quota = await cloud.flags.getQuota();
// { max: 50, used: 12, subscribed: true, locked: 0 }

const audit = await cloud.flags.getAuditLog({ flagId: flag.id });
```

---

## ⚠️ Error Handling

The SDK provides detailed error handling through `NoCloudAPIError` and `NoCloudError` enum.

### Basic Error Handling

```typescript
import { NoCloud, NoCloudAPIError } from "@nocloud/sdk";

try {
  await cloud.storage.upload(file);
} catch (error) {
  if (error instanceof NoCloudAPIError) {
    console.error(`API Error: ${error.message}`);
    console.error(`Status: ${error.status}`);
    console.error(`Code: ${error.code}`);
  }
}
```

### Check for Specific Errors

```typescript
import { NoCloudAPIError, NoCloudError } from "@nocloud/sdk";

try {
  await cloud.storage.upload(file);
} catch (error) {
  // Using the static isError method
  if (NoCloudAPIError.isError(error, NoCloudError.RATE_LIMIT_EXCEEDED)) {
    console.log("Rate limited, retry later");
  } else if (NoCloudAPIError.isError(error, NoCloudError.INVALID_API_KEY)) {
    console.log("Check your API key");
  } else if (NoCloudAPIError.isError(error)) {
    console.log(`Other API error: ${error.code}`);
  }
}
```

---

## 🔧 Compatibility

Works in both Node.js (>=18) and browser environments. No Node-specific APIs are used.

---

## 📄 License

[MIT](LICENSE) © [NoneM](https://nonefivem.com)
