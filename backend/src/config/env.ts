import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().optional(),
  JWT_SECRET: z.string().min(1),
  JWT_EXPIRES_IN: z.string().default("7d"),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REDIRECT_URI: z.string().url(),
  GOOGLE_OAUTH_SCOPES: z.string().default("openid email profile"),
  AWS_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_PRESIGN_EXPIRES_SECONDS: z.coerce.number().int().min(30).max(60 * 60).default(900),
  AUDIO_PART_RETENTION_HOURS: z.coerce.number().int().min(1).max(24 * 14).default(24),
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .min(1)
    .describe("Base64-encoded 32-byte key (AES-256) used to seal OAuth tokens at rest"),
  AUTH_BYPASS_USER_ID: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
