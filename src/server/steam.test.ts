import test from "node:test";
import assert from "node:assert/strict";
import { steamLoginPayload, setSteamAuthenticator, setSessionConflictConfirmation, syncSteamInventory } from "./steam.js";
import { demoSnapshot, demoRecipes } from "./demo.js";
import type { CraftData } from "./catalog.js";

const catalog: CraftData = { items: demoSnapshot().entries, recipes: demoRecipes, loadedAt: new Date().toISOString(), source: "live" };

test("Steam companion login payload contains no Warframe password", () => {
  const payload = steamLoginPayload("sample-code", 1700000000000);
  assert.equal(payload.steamCode, "sample-code");
  assert.equal(payload.steamLogin, true);
  assert.equal(payload.time, 1700000000);
  assert.equal(payload.appVersion, "5.3.8.0");
  assert.equal(payload.password, "");
  assert.match(String(payload.date), /^\d{16}$/);
  assert.equal(typeof payload.date, "number");
  assert.equal(Number.isSafeInteger(payload.date), true);
});

test("companion exchange accepts numeric nonces and downloads inventory with GET", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: URL; method: string; body: unknown; headers: Headers }> = [];
  const part = catalog.items.find((entry) => entry.kind === "component")!;
  setSteamAuthenticator(async () => "synthetic-steam-code");
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, method: init?.method ?? "GET", body: init?.body, headers: new Headers(init?.headers) });
    const data = url.pathname.endsWith("login.php") ? { id: "synthetic-account", Nonce: 7 } : url.pathname.endsWith("inventory.php") ? { Recipes: [{ ItemType: part.id, ItemCount: 2 }], XPInfo: [], PendingRecipes: [] } : {};
    return new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
  };
  try {
    const snapshot = await syncSteamInventory(catalog);
    assert.equal(snapshot.entries.find((entry) => entry.id === part.id)?.quantity, 2);
    assert.equal(requests[0].method, "POST");
    assert.equal(requests[0].headers.get("user-agent"), "");
    assert.equal(requests[1].method, "GET");
    assert.equal(requests[1].body, undefined);
    assert.equal(requests[1].url.searchParams.get("nonce"), "7");
    assert.equal(requests[2].url.pathname, "/api/logout.php");
    assert.equal(requests[2].method, "POST");
    assert.deepEqual(JSON.parse(String(requests[2].body)), {});
  } finally { globalThis.fetch = originalFetch; }
});

test("gateway errors name the failed stage without exposing response bodies or login codes", async () => {
  const originalFetch = globalThis.fetch;
  setSteamAuthenticator(async () => "private-login-code");
  globalThis.fetch = async () => new Response("<html>private-gateway-body</html>", { status: 403, headers: { "content-type": "text/html" } });
  try {
    await assert.rejects(syncSteamInventory(catalog), (error: Error) => {
      assert.match(error.message, /login gateway.*HTTP 403, HTML/);
      assert.equal(error.message.includes("private-gateway-body"), false);
      assert.equal(error.message.includes("private-login-code"), false);
      return true;
    });
  } finally { globalThis.fetch = originalFetch; }
});

test("inventory parsing failure still attempts companion logout", async () => {
  const originalFetch = globalThis.fetch;
  const paths: string[] = [];
  setSteamAuthenticator(async () => "synthetic-steam-code");
  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname;
    paths.push(path);
    if (path.endsWith("login.php")) return Response.json({ id: "synthetic-account", Nonce: 9 });
    if (path.endsWith("inventory.php")) return new Response("<html>temporary error</html>", { headers: { "content-type": "text/html" } });
    return Response.json({});
  };
  try {
    await assert.rejects(syncSteamInventory(catalog), /HTML during inventory \(HTTP 200\)/);
    assert.equal(paths.at(-1), "/api/logout.php");
  } finally { globalThis.fetch = originalFetch; }
});

test("plain-text active-session errors are explained without requesting a disconnect", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  setSteamAuthenticator(async () => "synthetic-steam-code");
  globalThis.fetch = async (input) => { requests.push(String(input)); return new Response("Nonce still set", { status: 409 }); };
  try {
    await assert.rejects(syncSteamInventory(catalog), /active session conflict/);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].includes("kick"), false);
  } finally { globalThis.fetch = originalFetch; }
});

test("session override retries once only after explicit confirmation", async () => {
  const originalFetch = globalThis.fetch;
  const payloads: Record<string, unknown>[] = [];
  let confirmations = 0;
  let signIns = 0;
  const part = catalog.items.find((entry) => entry.kind === "component")!;
  setSteamAuthenticator(async () => { signIns++; return "synthetic-steam-code"; });
  setSessionConflictConfirmation(async () => { confirmations++; return true; });
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("login.php")) {
      payloads.push(JSON.parse(String(init?.body)));
      if (payloads.length === 1) return new Response("Nonce still set", { status: 409 });
      return Response.json({ id: "synthetic-account", Nonce: 12 });
    }
    return Response.json(path.endsWith("inventory.php") ? { Recipes: [{ ItemType: part.id, ItemCount: 1 }] } : {});
  };
  try {
    await syncSteamInventory(catalog);
    assert.equal(confirmations, 1);
    assert.equal(signIns, 1);
    assert.equal(payloads[0].kick, undefined);
    assert.equal(payloads[1].kick, 1);
    assert.equal(payloads[1].steamCode, payloads[0].steamCode);
  } finally { globalThis.fetch = originalFetch; setSessionConflictConfirmation(undefined); }
});

test("cancelling the conflict popup sends no override request", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  setSteamAuthenticator(async () => "synthetic-steam-code");
  setSessionConflictConfirmation(async () => false);
  globalThis.fetch = async () => { requests++; return new Response("Nonce still set", { status: 409 }); };
  try {
    await assert.rejects(syncSteamInventory(catalog), /Sync cancelled/);
    assert.equal(requests, 1);
  } finally { globalThis.fetch = originalFetch; setSessionConflictConfirmation(undefined); }
});
