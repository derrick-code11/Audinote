import { S3Client } from "@aws-sdk/client-s3";

import { env } from "./env";

const globalForS3 = globalThis as unknown as {
  s3?: S3Client;
};

export const s3Client =
  globalForS3.s3 ??
  new S3Client({
    region: env.AWS_REGION,
  });

if (process.env.NODE_ENV !== "production") {
  globalForS3.s3 = s3Client;
}
