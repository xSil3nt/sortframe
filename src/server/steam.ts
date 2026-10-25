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
  const randomDate = BigInt("0x" + randomBytes(8).toString("hex")) % 8000000000000000n + 1000000000000000n;
  return {
    email: "",
    password: "",
    date: Number(randomDate),
    appVersion: "5.3.8.0",
    steamCode: code,
    steamLogin: true,
    os: "android",
    ClientType: clientType,
    time: Math.floor(now / 1000)
  };
}

async function companionRequest(endpoint: "login.php" | "inventory.php" | "logout.php", query: URLSearchParams, payload?: unknown) {
  const stage = endpoint.replace(".php", "");
  const response = await fetch(`${companionRoot}/${endpoint}?${query}`, {
    method: payload === undefined ? "GET" : "POST",
    headers: { "content-type": "application/octet-stream", accept: "application/json", "user-agent": "" },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    redirect: "manual",
    signal: AbortSignal.timeout(45000)
  });
  const text = (await response.text()).replace(/^\uFEFF/, "");
  const format = /text\/html/i.test(response.headers.get("content-type") ?? "") || /^\s*<!?(?:doctype|html)/i.test(text) ? "HTML" : "non-JSON";
  const classify = (detail: string) => {
    if (/nonce still set|active session|already.*session|another.*login/i.test(detail)) return "Warframe reports an active session conflict. Close the game normally and retry; Sortframe did not disconnect it.";
    if (/captcha required|verify.*human/i.test(detail)) return "Warframe requires human verification before companion sign-in. Your saved inventory was kept.";
    if (/new hardware detected|new country detected/i.test(detail)) return "Warframe requires an emailed security code for this device. That verification step is not connected yet; your saved inventory was kept.";
    return null;
  };
  const knownFailure = classify(text);
  if (!response.ok) {
    if (knownFailure) throw new Error(knownFailure);
    if (response.status === 403) throw new Error(`Warframe's ${stage} gateway denied the request (HTTP 403, ${format}). Your saved inventory was kept.`);
    if (response.status >= 300 && response.status < 400) throw new Error(`Warframe redirected the ${stage} request (HTTP ${response.status}). Sign in again; your saved inventory was kept.`);
    throw new Error(`Warframe rejected the ${stage} request (HTTP ${response.status}). Your saved inventory was kept.`);
  }
  let value: unknown;
  try { value = JSON.parse(text); } catch {
    if (knownFailure) throw new Error(knownFailure);
    throw new Error(`Warframe returned ${format} during ${stage} (HTTP ${response.status}). Your saved inventory was kept.`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Warframe returned an invalid ${stage} response (HTTP ${response.status}). Your saved inventory was kept.`);
  const detail = (value as Record<string, unknown>).Error ?? (value as Record<string, unknown>).error ?? (value as Record<string, unknown>).message;
  if (typeof detail === "string" && classify(detail)) throw new Error(classify(detail)!);
  if ((value as Record<string, unknown>).Error || (value as Record<string, unknown>).error || Number((value as Record<string, unknown>).status ?? 200) >= 400) throw new Error(`Warframe rejected ${stage}. Sign in again; your saved inventory was kept.`);
  return value as Record<string, unknown>;
}

export async function syncSteamInventory(catalog: CraftData | Promise<CraftData>): Promise<Snapshot> {
  if (!desktopAuthenticator) throw new Error("Steam sign in is available inside the Sortframe desktop app.");
  const code = await desktopAuthenticator();
  const data = await catalog;
  if (data.source !== "live") throw new Error("Live Prime item data is unavailable. Your saved inventory was kept.");
  const login = await companionRequest("login.php", new URLSearchParams({ ct: clientType }), steamLoginPayload(code));
  const accountId = login.id ?? login.accountId;
  const rawNonce = login.Nonce ?? login.nonce;
  if (typeof accountId !== "string" || !accountId || !(typeof rawNonce === "string" && rawNonce.length > 0 || typeof rawNonce === "number" && Number.isFinite(rawNonce))) throw new Error("Warframe did not establish a companion session. Your saved inventory was kept.");
  const nonce = String(rawNonce);
  try {
    if (login.CrossSaveAccountId && login.CrossSaveAccountId !== accountId) throw new Error("Warframe requires linked-account resolution for this cross-save account. Your saved inventory was kept.");
    const raw = await companionRequest("inventory.php", new URLSearchParams({ accountId, nonce, ct: clientType }));
    const inventory = (raw.Inventory && typeof raw.Inventory === "object") ? raw.Inventory : raw;
    return parseCompanionInventory(inventory, data);
  } finally {
    try { await companionRequest("logout.php", new URLSearchParams({ accountId, nonce, ct: clientType }), {}); } catch { }
  }
}
