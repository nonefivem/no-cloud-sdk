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
  delayMs: number = 1000
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
