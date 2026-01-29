import { NoCloudAPIError } from "./errors";

/**
 * Resolves a JSON response, throwing an error if the response is not ok.
 * @param response The fetch Response object
 * @returns The parsed JSON data
 * @throws {NoCloudAPIError} If the response is not ok
 */
export async function resolveJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as {
      message?: string;
    };
    throw NoCloudAPIError.fromStatus(
      response.status,
      err.message || "Unknown error"
    );
  }

  return (await response.json()) as T;
}
