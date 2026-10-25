import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import type { CraftData } from "./catalog.js";
import { parseCompanionInventory } from "./companion.js";
import type { Snapshot } from "../shared/models.js";

const companionRoot = "https://mobile.warframe.com/api";
const clientType = "CAA";

type AuthResult = { code: string | null; cancelled: boolean };

export function steamLoginPayload(code: string, now = Date.now()): Record<string, unknown> {
  const randomDate = BigInt("0x" + randomBytes(8).toString("hex")) % 10000000000000000n;
  return {
    email: "",
    password: "",
    date: randomDate.toString().padStart(16, "0"),
    appVersion: "5.3.8.0",
    steamCode: code,
    steamLogin: true,
    os: "android",
    ClientType: clientType,
    time: Math.floor(now / 1000)
  };
}

async function acquireSteamCode(launcherPath: string): Promise<string> {
  const pipeName = `Sortframe-${randomBytes(16).toString("hex")}`;
  const pipePath = `\\\\.\\pipe\\${pipeName}`;
  const server = createServer();
  let child: ReturnType<typeof spawn> | undefined;
  const auth = new Promise<AuthResult>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Steam sign in timed out.")), 180000);
    server.once("connection", (socket) => {
      const chunks: Buffer[] = [];
      let size = 0;
      socket.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 4096) socket.destroy(new Error("Steam sign in handoff was too large."));
        else chunks.push(chunk);
      });
      socket.once("end", () => {
        clearTimeout(timer);
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as AuthResult); }
        catch { reject(new Error("Steam sign in handoff was invalid.")); }
      });
      socket.once("error", (error) => { clearTimeout(timer); reject(error); });
      socket.setTimeout(180000, () => { clearTimeout(timer); socket.destroy(new Error("Steam sign in timed out.")); });
    });
    server.once("error", (error) => { clearTimeout(timer); reject(error); });
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.listen(pipePath, resolve);
      server.once("error", reject);
    });
    child = spawn(launcherPath, ["--steam-auth", pipeName], { windowsHide: true, stdio: "ignore" });
    child.once("error", () => server.close());
    const result = await auth;
    if (result.cancelled || !result.code) throw new Error("Steam sign in was cancelled.");
    if (result.code.length > 512 || !/^[A-Za-z0-9._~-]+$/.test(result.code)) throw new Error("Steam returned an invalid authorization code.");
    return result.code;
  } finally {
    child?.kill();
    server.close();
  }
}

async function postCompanion(endpoint: string, query: URLSearchParams, payload: unknown) {
  const response = await fetch(`${companionRoot}/${endpoint}?${query}`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream", accept: "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(45000)
  });
  const text = await response.text();
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("Warframe returned an unreadable companion response."); }
  if (!response.ok || !value || typeof value !== "object" || Array.isArray(value)) throw new Error("Warframe companion sign in or inventory request failed.");
  const detail = (value as Record<string, unknown>).Error ?? (value as Record<string, unknown>).error ?? (value as Record<string, unknown>).message;
  if (typeof detail === "string" && /active|already.*session|another.*login/i.test(detail)) throw new Error("Warframe reports an active session conflict. Sortframe did not disconnect the game; close it normally and retry.");
  return value as Record<string, unknown>;
}

export async function syncSteamInventory(launcherPath: string, catalog: CraftData): Promise<Snapshot> {
  const code = await acquireSteamCode(launcherPath);
  const login = await postCompanion("login.php", new URLSearchParams({ ct: clientType }), steamLoginPayload(code));
  const accountId = login.id ?? login.accountId;
  const nonce = login.Nonce ?? login.nonce;
  if (typeof accountId !== "string" || typeof nonce !== "string" || !accountId || !nonce) throw new Error("Warframe did not establish a companion session. Your saved inventory was kept.");
  const session = { accountId, nonce };
  try {
    const raw = await postCompanion("inventory.php", new URLSearchParams({ accountId, nonce, ct: clientType }), {});
    const inventory = (raw.Inventory && typeof raw.Inventory === "object") ? raw.Inventory : raw;
    return parseCompanionInventory(inventory, catalog);
  } finally {
    try { await postCompanion("logout.php", new URLSearchParams({ accountId, nonce, ct: clientType }), session); } catch { }
  }
}
