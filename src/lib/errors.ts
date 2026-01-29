export enum NoCloudError {
  INVALID_API_KEY = "INVALID_API_KEY",
  BAD_REQUEST = "BAD_REQUEST",
  RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED",
  RESOURCE_NOT_FOUND = "RESOURCE_NOT_FOUND",
  INTERNAL_SERVER_ERROR = "INTERNAL_SERVER_ERROR",
  UNKNOWN_ERROR = "UNKNOWN_ERROR"
}

export class NoCloudAPIError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: NoCloudError
  ) {
    super(message);
    this.name = "NoCloudAPIError";
    this.code = code;
  }

  /**
   * Checks if the given object is a NoCloudAPIError with an optional specific error code.
   * @param value - The value to check.
   * @param code - Optional specific error code to match.
   * @return True if the value is a NoCloudAPIError (and matches the code if provided), false otherwise.
   */
  static override isError(
    value: unknown,
    code?: NoCloudError
  ): value is NoCloudAPIError {
    if (!(value instanceof NoCloudAPIError)) {
      return false;
    }
    if (code && value.code !== code) {
      return false;
    }
    return true;
  }

  /**
   * Creates a NoCloudAPIError instance based on the provided error code.
   * @param code - The error code.
   * @param message - The error message.
   * @returns A NoCloudAPIError instance corresponding to the error code.
   */
  static fromCode(code: NoCloudError, message: string): NoCloudAPIError {
    switch (code) {
      case NoCloudError.BAD_REQUEST:
        return new NoCloudAPIError(message, 400, code);
      case NoCloudError.INVALID_API_KEY:
        return new NoCloudAPIError(message, 401, code);
      case NoCloudError.RATE_LIMIT_EXCEEDED:
        return new NoCloudAPIError(message, 429, code);
      case NoCloudError.RESOURCE_NOT_FOUND:
        return new NoCloudAPIError(message, 404, code);
      case NoCloudError.INTERNAL_SERVER_ERROR:
      case NoCloudError.UNKNOWN_ERROR:
        return new NoCloudAPIError(message, 500, code);
      default:
        return new NoCloudAPIError(
          message,
          500,
          NoCloudError.INTERNAL_SERVER_ERROR
        );
    }
  }

  /**
   * Creates a NoCloudAPIError instance based on the provided HTTP status code.
   * @param status - The HTTP status code.
   * @param message - The error message.
   * @returns A NoCloudAPIError instance corresponding to the HTTP status code.
   */
  static fromStatus(status: number, message: string): NoCloudAPIError {
    switch (status) {
      case 400:
        return new NoCloudAPIError(message, status, NoCloudError.BAD_REQUEST);
      case 401:
        return new NoCloudAPIError(
          message,
          status,
          NoCloudError.INVALID_API_KEY
        );
      case 429:
        return new NoCloudAPIError(
          message,
          status,
          NoCloudError.RATE_LIMIT_EXCEEDED
        );
      case 404:
        return new NoCloudAPIError(
          message,
          status,
          NoCloudError.RESOURCE_NOT_FOUND
        );
      case 500:
        return new NoCloudAPIError(
          message,
          status,
          NoCloudError.INTERNAL_SERVER_ERROR
        );
      default:
        return new NoCloudAPIError(message, status, NoCloudError.UNKNOWN_ERROR);
    }
  }
}
