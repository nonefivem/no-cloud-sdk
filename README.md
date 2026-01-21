<div align="center">
  <img src="https://assets.nonefivem.com/logo/dark-bg.png" alt="NoneM Logo" width="200" />
  
  # @no-cloud/sdk
  
  **Official SDK for NoCloud services**
  
  [![npm version](https://img.shields.io/npm/v/@no-cloud/sdk?style=for-the-badge)](https://www.npmjs.com/package/@no-cloud/sdk)
  [![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](https://opensource.org/licenses/MIT)
  
</div>

---

## 🚀 Getting Started

### Installation

```bash
npm install @no-cloud/sdk
# or
bun add @no-cloud/sdk
# or
pnpm add @no-cloud/sdk
```

### Quick Start

```typescript
import { NoCloud } from "@no-cloud/sdk";

const cloud = new NoCloud("your-api-key");

// Upload a file
const file = new File(["hello"], "hello.txt", { type: "text/plain" });
const { id, url } = await cloud.storage.upload(file);

console.log(`Uploaded: ${url}`);

// Delete a file
await cloud.storage.delete(id);
```

---

## 📖 Usage

### Initialize

```typescript
import { NoCloud } from "@no-cloud/sdk";

// Simple
const cloud = new NoCloud("your-api-key");

// With options
const cloud = new NoCloud({
  apiKey: "your-api-key",
  baseUrl: "https://api.nonefivem.com", // optional
  retries: 3, // optional
  retryDelayMs: 1000 // optional
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
const { id, url } = await cloud.storage.uploadStream(stream, "video/mp4", fileSize);
```

#### Delete a File

```typescript
await cloud.storage.delete(mediaId);
```

---

## 📋 Supported Body Types

| Type          | Description          |
| ------------- | -------------------- |
| `File`        | Browser File object  |
| `Blob`        | Binary data          |
| `ArrayBuffer` | Raw binary buffer    |
| `string`      | Base64 or plain text |

Base64 strings with data URLs (`data:image/png;base64,...`) or raw base64 are automatically detected and the mime type is inferred.

---

## ⚠️ Error Handling

```typescript
import { NoCloud, NoCloudAPIError } from "@no-cloud/sdk";

try {
  await cloud.storage.upload(file);
} catch (error) {
  if (error instanceof NoCloudAPIError) {
    console.error(`API Error: ${error.message} (${error.status})`);
  }
}
```

---

## 🔧 Compatibility

Works in both Node.js (>=18) and browser environments. No Node-specific APIs are used.

---

## 📄 License

[MIT](LICENSE) © [NoneM](https://nonefivem.com)
