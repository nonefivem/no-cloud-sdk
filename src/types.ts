/**
 * Upload body types.
 *
 * `File` and `Blob` are streamed.
 * `ArrayBuffer` and `string` are buffered in memory.
 *
 * `string` values (e.g. Base64) are uploaded as-is.
 */
export type FileBody = File | Blob | ArrayBuffer | string;

/**
 * Metadata associated with a file.
 */
export type FileMetadata = Record<string, string | number | boolean>;

/**
 * Response returned after a successful file upload.
 */
export interface UploadResponse {
  /**
   * The unique identifier for the uploaded file.
   */
  id: string;
  /**
   * The public URL where the uploaded file can be accessed.
   */
  url: string;
}

/**
 * Response returned when requesting a signed URL for uploading media.
 */
export interface SignedUrlResponse {
  /**
   * The signed URL for uploading the file.
   */
  url: string;
  /**
   * The expiration time of the signed URL in ISO 8601 format.
   */
  expiresAt: string;
  /**
   * The unique identifier for the media after upload.
   */
  mediaId: string;
  /**
   * The public URL to access the media after upload.
   */
  mediaUrl: string;
}
