import { randomBytes } from "node:crypto";
import type { CraftData } from "./catalog.js";
import { parseCompanionInventory } from "./companion.js";
import type { Snapshot } from "../shared/models.js";

const companionRoot = "https://mobile.warframe.com/api";
const clientType = "CAA";

let desktopAuthenticator: (() => Promise<string>) | undefined;

export function setSteamAuthenticator(authenticator: () => Promise<string>) {
  desktopAuthenticator = authenticator;
}

export function canAuthenticateSteam() {
  return Boolean(desktopAuthenticator);
}

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

export async function syncSteamInventory(catalog: CraftData | Promise<CraftData>): Promise<Snapshot> {
  if (!desktopAuthenticator) throw new Error("Steam sign in is available inside the Sortframe desktop app.");
  const code = await desktopAuthenticator();
  const data = await catalog;
  if (data.source !== "live") throw new Error("Live Prime item data is unavailable. Your saved inventory was kept.");
  const login = await postCompanion("login.php", new URLSearchParams({ ct: clientType }), steamLoginPayload(code));
  const accountId = login.id ?? login.accountId;
  const nonce = login.Nonce ?? login.nonce;
  if (typeof accountId !== "string" || typeof nonce !== "string" || !accountId || !nonce) throw new Error("Warframe did not establish a companion session. Your saved inventory was kept.");
  const session = { accountId, nonce };
  try {
    const raw = await postCompanion("inventory.php", new URLSearchParams({ accountId, nonce, ct: clientType }), {});
    const inventory = (raw.Inventory && typeof raw.Inventory === "object") ? raw.Inventory : raw;
    return parseCompanionInventory(inventory, data);
  } finally {
    try { await postCompanion("logout.php", new URLSearchParams({ accountId, nonce, ct: clientType }), session); } catch { }
  }
}
