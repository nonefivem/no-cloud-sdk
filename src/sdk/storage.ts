import { NoCloudAPIError } from "@/lib";
import { SDKModule } from "@/lib/sdk-module";
import { resolveJsonResponse } from "@/lib/resolvers";
import {
  detectBase64MimeType,
  extractBase64Data,
  getBase64DecodedSize,
} from "@/lib/utils";
import type {
  FileBody,
  FileMetadata,
  SignedUrlResponse,
  UploadResponse,
} from "@/types";

/**
 * Storage module for handling file storage operations.
 */
export class Storage extends SDKModule {
  /**
   * Generates a signed URL for uploading a file.
   * @param contentType - The MIME type of the file.
   * @param size - The size of the file in bytes.
   * @param metadata - Optional metadata associated with the file.
   * @returns {Promise<SignedUrlResponse>} An object containing the signed URL and its expiration time.
   * @throws {NoCloudAPIError} If the API request fails.
   */
  async generateSignedUrl(
    contentType: string,
    size: number,
    metadata?: FileMetadata
  ): Promise<SignedUrlResponse> {
    const response = await this.fetch("storage/signed-url", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contentType,
        size,
        metadata,
      }),
    });

    return resolveJsonResponse<SignedUrlResponse>(response);
  }

  /**
   * Extracts content type and size from the body.
   */
  private getBodyInfo(body: FileBody): { contentType: string; size: number } {
    if (typeof Blob !== "undefined" && body instanceof Blob) {
      return {
        contentType: body.type || "application/octet-stream",
        size: body.size,
      };
    }
    if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) {
      return { contentType: "application/octet-stream", size: body.byteLength };
    }
    if (typeof body === "string") {
      const detectedType = detectBase64MimeType(body);
      if (detectedType) {
        // It's base64 - calculate decoded size
        const rawBase64 = extractBase64Data(body);
        const size = getBase64DecodedSize(rawBase64);
        return { contentType: detectedType, size };
      }
      return {
        contentType: "text/plain",
        size: new TextEncoder().encode(body).length,
      };
    }
    throw new NoCloudAPIError("Unsupported body type", 400);
  }

  /**
   * Uploads a file to R2 storage using S3-compatible API.
   * @param body The file body to upload. Supports File, Blob, ArrayBuffer, or string.
   * @param metadata Optional metadata associated with the file.
   * @returns {Promise<UploadResponse>} An object containing the upload ID and URL.
   * @throws {NoCloudAPIError} If the upload fails.
   */
  async upload(
    body: FileBody,
    metadata?: FileMetadata
  ): Promise<UploadResponse> {
    const { contentType, size } = this.getBodyInfo(body);
    const { url, mediaUrl, mediaId } = await this.generateSignedUrl(
      contentType,
      size,
      metadata
    );

    const uploadResponse = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
        "Content-Length": size.toString(),
      },
      body,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse
        .text()
        .catch(() => uploadResponse.statusText);
      throw new NoCloudAPIError(
        `Failed to upload file to R2: ${errorText}`,
        uploadResponse.status
      );
    }

    return { id: mediaId, url: mediaUrl };
  }

  /**
   * Uploads a ReadableStream to R2 storage using S3-compatible API.
   * @param stream The ReadableStream to upload.
   * @param contentType The MIME type of the content.
   * @param contentLength The size of the content in bytes.
   * @param metadata Optional metadata associated with the file.
   * @returns {Promise<UploadResponse>} An object containing the upload ID and URL.
   * @throws {NoCloudAPIError} If the upload fails.
   */
  async uploadStream(
    stream: ReadableStream,
    contentType: string,
    contentLength: number,
    metadata?: FileMetadata
  ): Promise<UploadResponse> {
    const { url, mediaUrl, mediaId } = await this.generateSignedUrl(
      contentType,
      contentLength,
      metadata
    );

    const uploadResponse = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
        "Content-Length": contentLength.toString(),
      },
      body: stream,
      duplex: "half",
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse
        .text()
        .catch(() => uploadResponse.statusText);
      throw new NoCloudAPIError(
        `Failed to upload stream to R2: ${errorText}`,
        uploadResponse.status
      );
    }

    return { id: mediaId, url: mediaUrl };
  }

  /**
   * Deletes a media file from the storage.
   * @param mediaId The ID of the media file to be deleted.
   * @returns {Promise<void>} A promise that resolves when the deletion is complete.
   * @throws {NoCloudAPIError} If the deletion fails.
   */
  async delete(mediaId: string): Promise<void> {
    const response = await this.fetch(`storage/${mediaId}`, {
      method: "DELETE",
    });

    return resolveJsonResponse<void>(response);
  }
}
