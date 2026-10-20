import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';

export type StorageConfig = { region: string; bucket: string; accessKeyId: string; secretAccessKey: string };

export type PresignedUpload = { url: string; fields: Record<string, string> };

export interface Storage {
  /** A short-lived form the browser posts the file to directly. S3 enforces the key, type and size. */
  presignUpload(key: string, contentType: string, maxBytes: number): Promise<PresignedUpload>;
  exists(key: string): Promise<boolean>;
  download(key: string): Promise<Uint8Array>;
  /** Server-side upload, for files we create ourselves (the demo's documents). */
  put(key: string, body: Uint8Array | string, contentType: string): Promise<void>;
  remove(key: string): Promise<void>;
}

const UPLOAD_URL_TTL_SECONDS = 300;

export function createS3Storage(config: StorageConfig): Storage {
  const s3 = new S3Client({
    region: config.region,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  const Bucket = config.bucket;

  return {
    async presignUpload(key, contentType, maxBytes) {
      return createPresignedPost(s3, {
        Bucket,
        Key: key,
        Fields: { 'Content-Type': contentType },
        Conditions: [
          ['content-length-range', 1, maxBytes],
          ['eq', '$Content-Type', contentType],
        ],
        Expires: UPLOAD_URL_TTL_SECONDS,
      });
    },

    async exists(key) {
      try {
        await s3.send(new HeadObjectCommand({ Bucket, Key: key }));
        return true;
      } catch (err) {
        // Without s3:ListBucket (least privilege), S3 answers 403 rather than 404 for a missing object.
        const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status === 404 || status === 403) return false;
        throw err;
      }
    },

    async download(key) {
      const res = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
      if (!res.Body) throw new Error(`empty S3 object: ${key}`);
      return res.Body.transformToByteArray();
    },

    async put(key, body, contentType) {
      await s3.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }));
    },

    async remove(key) {
      await s3.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
  };
}
