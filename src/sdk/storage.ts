import { NoCloudAPIError } from "@/lib";
import { resolveJsonResponse } from "@/lib/resolvers";
import { SDKModule } from "@/lib/sdk-module";
import {
  decodeBase64,
  detectBase64MimeType,
  extractBase64Data,
  normalizeMimeType,
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
    metadata?: FileMetadata,
  ): Promise<SignedUrlResponse> {
    const queryParams = new URLSearchParams();
    queryParams.append("contentType", contentType);
    queryParams.append("size", size.toString());
    const response = await this.fetch(
      `storage/signed-url?${queryParams.toString()}`,
    );

    return resolveJsonResponse<SignedUrlResponse>(response);
  }

  /**
   * Extracts content type, size, and normalized body from the input.
   * For base64 strings, this decodes them to binary.
   */
  private getBodyInfo(body: FileBody): {
    contentType: string;
    size: number;
    normalizedBody: Blob | ArrayBuffer | Uint8Array;
  } {
    if (typeof Blob !== "undefined" && body instanceof Blob) {
      return {
        contentType: normalizeMimeType(body.type) || "application/octet-stream",
        size: body.size,
        normalizedBody: body,
      };
    }
    if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) {
      return {
        contentType: "application/octet-stream",
        size: body.byteLength,
        normalizedBody: body,
      };
    }
    if (typeof body === "string") {
      const detectedType = detectBase64MimeType(body);
      if (detectedType) {
        // It's base64 - decode to binary
        const rawBase64 = extractBase64Data(body);
        const decoded = decodeBase64(rawBase64);
        return {
          contentType: detectedType,
          size: decoded.byteLength,
          normalizedBody: decoded,
        };
      }
      const encoded = new TextEncoder().encode(body);
      return {
        contentType: "text/plain",
        size: encoded.length,
        normalizedBody: encoded,
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
    metadata?: FileMetadata,
  ): Promise<UploadResponse> {
    const { contentType, size, normalizedBody } = this.getBodyInfo(body);
    const { url, mediaUrl, mediaId } = await this.generateSignedUrl(
      contentType,
      size,
      metadata,
    );

    const uploadResponse = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Length": size.toString(),
      },
      body: normalizedBody,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse
        .text()
        .catch(() => uploadResponse.statusText);
      throw new NoCloudAPIError(
        `Failed to upload file to R2: ${errorText}`,
        uploadResponse.status,
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
    metadata?: FileMetadata,
  ): Promise<UploadResponse> {
    const { url, mediaUrl, mediaId } = await this.generateSignedUrl(
      contentType,
      contentLength,
      metadata,
    );

    const uploadResponse = await fetch(url, {
      method: "PUT",
      headers: {
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
        uploadResponse.status,
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

    await resolveJsonResponse<void>(response);
  }
}
