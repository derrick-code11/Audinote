import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

import { env } from "../config/env";

const VERSION = 1;
const ALGO = "aes-256-gcm";

function getKeyBuffer(): Buffer {
  const key = Buffer.from(env.TOKEN_ENCRYPTION_KEY, "base64");
  if (key.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be base64 for 32 bytes (256 bits)");
  }
  return key;
}

export function sealSecret(plaintext: string): string {
  const key = getKeyBuffer();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext, "utf8")), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v${VERSION}:${Buffer.concat([iv, tag, ciphertext]).toString("base64url")}`;
}

export function unsealSecret(sealed: string): string {
  if (!sealed.startsWith("v1:")) {
    // Backwards compatibility: treat as plaintext (pre-encryption data).
    return sealed;
  }
  const key = getKeyBuffer();
  const raw = Buffer.from(sealed.slice("v1:".length), "base64url");
  if (raw.length < 12 + 16 + 1) {
    throw new Error("Invalid sealed secret payload");
  }
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  return plaintext;
}
