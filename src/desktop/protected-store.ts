import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

type Protector = { available: () => Promise<boolean>; encrypt: (plain: string) => Promise<Buffer>; decrypt: (encrypted: Buffer) => Promise<string> };

export function createProtectedStore(file: string, protector: Protector) {
  return {
    async load(): Promise<unknown | null> {
      try {
        if (!await protector.available()) return null;
        const bytes = await readFile(file);
        if (bytes.length > 1024 * 1024) return null;
        return JSON.parse(await protector.decrypt(bytes));
      } catch { return null; }
    },
    async save(value: unknown): Promise<boolean> {
      if (!await protector.available()) return false;
      const encrypted = await protector.encrypt(JSON.stringify(value));
      await mkdir(dirname(file), { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, encrypted, { mode: 0o600 });
        await rename(temporary, file);
      } finally { await rm(temporary, { force: true }); }
      return true;
    },
    async clear() { await rm(file, { force: true }); }
  };
}
