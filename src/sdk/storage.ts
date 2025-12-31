import type { NOCloudAPIError } from "@/lib";
import { SDKModule } from "@/lib/sdk-module";
import { resolveJsonResponse } from "../lib/resolvers";
import type { SignedUrlResponse, UploadResponse } from "../types";

/**
 * Storage module for handling file storage operations.
 */
export class Storage extends SDKModule {
  /**
   * Generates a signed URL for uploading a file.
   * @param fileName - The name of the file to be uploaded.
   * @param contentType - The MIME type of the file.
   * @param checksum - The checksum of the file for integrity verification.
   * @returns {Promise<SignedUrlResponse>} An object containing the signed URL and its expiration time.
   * @throws {NOCloudAPIError} If the API request fails.
   */
  async generateSignedUrl(
    fileName: string,
    contentType: string,
    checksum: string
  ): Promise<SignedUrlResponse> {
    const response = await this.fetch("storage/signed-url", {
      body: JSON.stringify({
        fileName,
        contentType,
        checksum,
      }),
    });

    return resolveJsonResponse<SignedUrlResponse>(response);
  }

  /**
   * Uploads a media file to the storage.
   * @param file The media file to be uploaded.
   * @param metadata Optional metadata associated with the media file.
   * @returns {Promise<UploadResponse>} An object containing the upload ID and URL.
   * @throws {NOCloudAPIError} If the upload fails.
   */
  async upload(
    file: File | Blob | Buffer | Uint8Array | ArrayBuffer | string,
    metadata?: Record<string, string | number | boolean>
  ): Promise<UploadResponse> {
    const formData = new FormData();
    formData.append("file", file);

    if (metadata) {
      formData.append("metadata", JSON.stringify(metadata));
    }

    const response = await this.fetch("storage/upload", {
      method: "POST",
      body: formData,
    });

    return resolveJsonResponse<UploadResponse>(response);
  }

  /**
   * Deletes a media file from the storage.
   * @param mediaId The ID of the media file to be deleted.
   * @returns {Promise<void>} A promise that resolves when the deletion is complete.
   * @throws {NOCloudAPIError} If the deletion fails.
   */
  async delete(mediaId: string): Promise<void> {
    const response = await this.fetch(`storage/${mediaId}`, {
      method: "DELETE",
    });

    return resolveJsonResponse<void>(response);
  }
}
