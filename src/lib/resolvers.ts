import { NoCloudAPIError } from "./errors";

/**
 * Resolves a JSON response, throwing an error if the response is not ok.
 * @param response The fetch Response object
 * @returns The parsed JSON data
 * @throws {NoCloudAPIError} If the response is not ok
 */
export async function resolveJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    try {
      const err = (await response.json()) as { message?: string };

      throw new NoCloudAPIError(err.message || "API Error", response.status);
    } catch (e) {
      throw new NoCloudAPIError("Unknown error", response.status);
    }
  }

  return (await response.json()) as T;
}
