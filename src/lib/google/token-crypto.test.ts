import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptToken, decryptToken } from "./token-crypto";

const ORIGINAL_KEY = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;

describe("token-crypto", () => {
  beforeEach(() => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
    else process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = ORIGINAL_KEY;
  });

  it("round-trips a token", () => {
    const token = "1//example-refresh-token-value";
    expect(decryptToken(encryptToken(token))).toBe(token);
  });

  it("never stores the token in readable form", () => {
    const token = "1//example-refresh-token-value";
    expect(encryptToken(token)).not.toContain(token);
  });

  it("produces a different ciphertext each time (fresh IV)", () => {
    const token = "same-token";
    expect(encryptToken(token)).not.toBe(encryptToken(token));
  });

  it("rejects a tampered value instead of decrypting it", () => {
    const stored = encryptToken("a-refresh-token");
    const parts = stored.split(".");
    const data = Buffer.from(parts[3], "base64url");
    data[0] ^= 0xff;
    parts[3] = data.toString("base64url");

    expect(() => decryptToken(parts.join("."))).toThrow();
  });

  it("can't be decrypted with a different key", () => {
    const stored = encryptToken("a-refresh-token");
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");

    expect(() => decryptToken(stored)).toThrow();
  });

  it("refuses to run without a key, or with one of the wrong length", () => {
    delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
    expect(() => encryptToken("x")).toThrow(/not set/);

    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = Buffer.from("too-short").toString("base64");
    expect(() => encryptToken("x")).toThrow(/32 bytes/);
  });

  it("rejects values that aren't in the expected format", () => {
    expect(() => decryptToken("not-an-encrypted-token")).toThrow(/format/);
  });
});
