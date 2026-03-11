import { describe, test, expect } from "bun:test";
import { encrypt, decrypt } from "./crypto";

describe("crypto", () => {
  test("round-trips plaintext", () => {
    process.env["ENCRYPTION_KEY"] = "a".repeat(64); // 32-byte hex
    const plaintext = "sk-test-key-12345";
    expect(decrypt(encrypt(plaintext))).toBe(plaintext);
  });

  test("produces different ciphertext each call (random IV)", () => {
    process.env["ENCRYPTION_KEY"] = "a".repeat(64);
    const c1 = encrypt("same");
    const c2 = encrypt("same");
    expect(c1).not.toBe(c2);
  });
});
