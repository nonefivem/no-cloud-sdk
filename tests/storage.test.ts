import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { NoCloud } from "../src";

describe("Storage API (Stage)", () => {
  let cloud: NoCloud;
  let uploadedMediaIds: string[] = [];

  beforeAll(() => {
    const apiKey = process.env.NOCLOUD_API_KEY;
    if (!apiKey) {
      throw new Error(
        "NOCLOUD_API_KEY environment variable is required. Set it before running tests."
      );
    }

    cloud = new NoCloud({
      apiKey,
      baseUrl: process.env.NOCLOUD_API_URL
    });
  });

  afterAll(async () => {
    try {
      await cloud.storage.delete(uploadedMediaIds);
    } catch (e) {
      console.error("Error cleaning up uploaded media:", e);
    }
  });

  describe("generateSignedUrl", () => {
    it("should generate a preallocated signed URL for file upload", async () => {
      const response = await cloud.storage.generateSignedUrl({
        contentType: "image/png",
        size: 1024,
        metadata: { test: true }
      });

      expect(response).toBeDefined();
      expect(response.url).toBeString();
      expect(response.mediaId).toBeString();
      expect(response.mediaUrl).toBeString();
      expect(response.expiresAt).toBeString();
    });

    it("should generate non preallocated signed URL for file upload", async () => {
      const response = await cloud.storage.generateSignedUrl();

      expect(response).toBeDefined();
      expect(response.url).toBeString();
      expect(response.expiresAt).toBeString();
    });
  });

  describe("uploadToSignedUrl", () => {
    it("should upload a file to a non preallocated signed URL", async () => {
      const content = "File content for signed URL upload";
      const blob = new Blob([content], { type: "text/plain" });
      const signedUrlResponse = await cloud.storage.generateSignedUrl();

      expect(signedUrlResponse).toBeDefined();
      expect(signedUrlResponse.url).toBeString();

      const body = new FormData();
      body.append("file", blob, "test.txt");

      const uploadResponse = await fetch(signedUrlResponse.url, {
        method: "POST",
        body
      });

      expect(uploadResponse.ok).toBe(true); // No response expected for successful upload

      const uploadedMedia = await uploadResponse.json();

      expect(uploadedMedia).toBeDefined();
      expect(uploadedMedia.id).toBeString();
      expect(uploadedMedia.url).toBeString();
      uploadedMediaIds.push(uploadedMedia.id);
    });

    it("should fail when trying to upload to a preallocated signed URL with invalid size", async () => {
      const content = "File content for preallocated signed URL upload";
      const blob = new Blob([content], { type: "text/plain" });
      const signedUrlResponse = await cloud.storage.generateSignedUrl({
        contentType: "text/plain",
        size: blob.size,
        metadata: { test: true }
      });

      expect(signedUrlResponse).toBeDefined();
      expect(signedUrlResponse.url).toBeString();

      const body = new FormData();
      body.append(
        "file",
        new Blob(["invalid content"], { type: "text/plain" }),
        "test.txt"
      );

      const uploadResponse = await fetch(signedUrlResponse.url, {
        method: "POST",
        body
      });

      expect(uploadResponse.ok).toBe(false); // Should fail for preallocated URLs
    });
  });

  describe("upload", () => {
    it("should upload a text file", async () => {
      const content = "Hello, NoCloud!";
      const blob = new Blob([content], { type: "text/plain" });
      const response = await cloud.storage.upload(blob);

      expect(response).toBeDefined();
      expect(response.id).toBeString();
      expect(response.url).toBeString();
      uploadedMediaIds.push(response.id);
    });

    it("should upload a file with metadata", async () => {
      const content = "Test file with metadata";
      const blob = new Blob([content], { type: "text/plain" });
      const response = await cloud.storage.upload(blob, {
        fileName: "test.txt",
        testRun: true
      });

      expect(response).toBeDefined();
      expect(response.id).toBeString();
      expect(response.url).toBeString();
      uploadedMediaIds.push(response.id);
    });

    it("should upload an ArrayBuffer", async () => {
      const buffer = new TextEncoder().encode("ArrayBuffer content").buffer;
      const response = await cloud.storage.upload(buffer);

      expect(response).toBeDefined();
      expect(response.id).toBeString();
      expect(response.url).toBeString();
      uploadedMediaIds.push(response.id);
    });

    it("should upload a base64 encoded image", async () => {
      // Small 1x1 red PNG
      const base64Image =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
      const response = await cloud.storage.upload(base64Image);

      expect(response).toBeDefined();
      expect(response.id).toBeString();
      expect(response.url).toBeString();
      uploadedMediaIds.push(response.id);
    });
  });

  describe("delete", () => {
    it("should delete an uploaded file", async () => {
      // First upload a file
      const blob = new Blob(["File to delete"], { type: "text/plain" });
      const uploadResponse = await cloud.storage.upload(blob);

      expect(uploadResponse.id).toBeString();

      // Then delete it
      expect(cloud.storage.delete(uploadResponse.id)).resolves.toBeUndefined();
    });

    it("should throw error when deleting non-existent file", async () => {
      expect(cloud.storage.delete("non-existent-media-id")).rejects.toThrow();
    });
  });

  describe("uploadStream", () => {
    it("should upload a ReadableStream", async () => {
      const content = "Stream content for upload";
      const encoder = new TextEncoder();
      const encoded = encoder.encode(content);
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoded);
          controller.close();
        }
      });
      const response = await cloud.storage.uploadStream(
        stream,
        "text/plain",
        encoded.byteLength
      );

      expect(response).toBeDefined();
      expect(response.id).toBeString();
      expect(response.url).toBeString();
      uploadedMediaIds.push(response.id);
    });
  });
});
