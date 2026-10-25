import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rmdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProtectedStore } from "./protected-store.js";

test("remembered sessions are stored as ciphertext and corrupted data is rejected", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sortframe-vault-"));
  const file = join(directory, "session.enc");
  const key = randomBytes(32);
  const store = createProtectedStore(file, {
    available: async () => true,
    encrypt: async (plain) => {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    },
    decrypt: async (encrypted) => {
      const decipher = createDecipheriv("aes-256-gcm", key, encrypted.subarray(0, 12));
      decipher.setAuthTag(encrypted.subarray(12, 28));
      return Buffer.concat([decipher.update(encrypted.subarray(28)), decipher.final()]).toString("utf8");
    }
  });
  try {
    assert.equal(await store.save({ token: "synthetic-private-session" }), true);
    assert.equal((await readFile(file)).includes(Buffer.from("synthetic-private-session")), false);
    assert.deepEqual(await store.load(), { token: "synthetic-private-session" });
    await writeFile(file, "broken ciphertext");
    assert.equal(await store.load(), null);
    await store.clear();
    assert.equal(await store.load(), null);
  } finally { await store.clear(); await rmdir(directory); }
});

test("unavailable protection never falls back to writing an unencrypted session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sortframe-no-vault-"));
  const file = join(directory, "session.enc");
  const store = createProtectedStore(file, { available: async () => false, encrypt: async () => { throw new Error("Must not encrypt"); }, decrypt: async () => { throw new Error("Must not decrypt"); } });
  try {
    assert.equal(await store.save({ token: "synthetic-private-session" }), false);
    await assert.rejects(readFile(file), { code: "ENOENT" });
    assert.equal(await store.load(), null);
  } finally { await rmdir(directory); }
});
