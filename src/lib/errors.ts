export class NoCloudAPIError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "NoCloudAPIError";
  }
}
