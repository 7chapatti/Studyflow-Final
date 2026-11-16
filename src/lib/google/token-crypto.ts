// Encrypts the Google refresh token before it is stored.
//
// A refresh token is a long-lived credential: whoever holds it can keep
// minting access to that user's Duecourse calendar until it is revoked. It
// lives in Postgres, so it is encrypted at rest with a key that is only in
// the server's environment (GOOGLE_TOKEN_ENCRYPTION_KEY). A leaked database
// backup or an over-broad query on its own then yields nothing usable.
//
// AES-256-GCM: a fresh random 12-byte IV per token, and the auth tag is
// checked on decrypt, so a tampered value fails loudly instead of
// decrypting to garbage.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

function loadKey(): Buffer {
  const raw = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY is not set");

  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  }
  return key;
}

export function encryptToken(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", loadKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptToken(stored: string): string {
  const [version, ivPart, tagPart, dataPart] = stored.split(".");
  if (version !== VERSION || !ivPart || !tagPart || !dataPart) {
    throw new Error("Unrecognised encrypted token format");
  }

  const decipher = createDecipheriv("aes-256-gcm", loadKey(), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
