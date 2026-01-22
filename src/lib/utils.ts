/**
 * Delays execution for a specified number of milliseconds.
 * @param ms - The number of milliseconds to delay.
 * @returns A promise that resolves after the specified delay.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries a given asynchronous function a specified number of times with a delay between attempts.
 * @param fn - The asynchronous function to retry.
 * @param retries - Number of retry attempts. Default is 3.
 * @param delayMs - Delay in milliseconds between retries. Default is 1000ms.
 * @returns The result of the asynchronous function if successful.
 * @throws The last encountered error if all retries fail.
 */
export async function withRetry<T = any>(
  fn: () => Promise<T>,
  retries: number = 3,
  delayMs: number = 1000,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await delay(delayMs);
      }
    }
  }

  throw lastError;
}

/**
 * Base64 magic byte signatures for MIME type detection.
 */
const BASE64_SIGNATURES: Record<string, string> = {
  iVBORw0KGgo: "image/png",
  "/9j/": "image/jpeg",
  R0lGOD: "image/gif",
  UklGR: "image/webp",
  AAAA: "video/mp4",
  JVBERi0: "application/pdf",
  UEsDB: "application/zip",
  PD94bWw: "application/xml",
  PHN2Zw: "image/svg+xml",
};

/**
 * Detects the MIME type from a base64 string.
 * Supports data URLs and raw base64 with magic byte detection.
 * @param str - The base64 string or data URL to detect.
 * @returns The detected MIME type or null if not detected.
 */
export function detectBase64MimeType(str: string): string | null {
  // Check for data URL format: data:image/png;base64,...
  const dataUrlMatch = str.match(/^data:([^;,]+)/);
  if (dataUrlMatch?.[1]) {
    return dataUrlMatch[1];
  }

  // Detect by base64 magic bytes (first few chars of encoded data)
  for (const [prefix, mimeType] of Object.entries(BASE64_SIGNATURES)) {
    if (str.startsWith(prefix)) {
      return mimeType;
    }
  }

  return null;
}

/**
 * Extracts the raw base64 data from a data URL or returns the string as-is.
 * @param str - The data URL or raw base64 string.
 * @returns The raw base64 data without the data URL prefix.
 */
export function extractBase64Data(str: string): string {
  const dataUrlMatch = str.match(/^data:[^;,]+;base64,(.+)$/);
  if (dataUrlMatch?.[1]) {
    return dataUrlMatch[1];
  }
  return str;
}

/**
 * Calculates the decoded size of a base64 string.
 * @param base64 - The raw base64 string (not a data URL).
 * @returns The size in bytes when decoded.
 */
export function getBase64DecodedSize(base64: string): number {
  const padding = (base64.match(/=+$/) || [""])[0].length;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * Decodes a base64 string to a Uint8Array.
 * @param base64 - The raw base64 string (not a data URL).
 * @returns The decoded binary data as Uint8Array.
 */
export function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Normalizes a MIME type by stripping parameters like charset.
 * e.g. "text/plain;charset=utf-8" -> "text/plain"
 * @param mimeType - The MIME type to normalize.
 * @returns The normalized MIME type without parameters.
 */
export function normalizeMimeType(mimeType: string): string {
  return mimeType.split(";")[0]?.trim() ?? mimeType;
}
