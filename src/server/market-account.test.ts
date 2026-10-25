import test from "node:test";
import assert from "node:assert/strict";
import { clearMarketAccount, connectMarketAccount, createMarketOrder, disconnectMarketAccount, getMyMarketOrders } from "./market-account.js";

test("market login reads the JWT response header and keeps it out of account status", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; headers: Headers; body: string }> = [];
  globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    const body = String(init?.body ?? "");
    const url = String(input);
    requests.push({ url, headers, body });
    if (url.endsWith("/v1/auth/signin")) return new Response(JSON.stringify({ payload: { user: { id: "user-1", ingame_name: "Tester" } } }), { status: 200, headers: { Authorization: "JWT secret-session-token" } });
    if (url.endsWith("/v2/me")) return new Response(JSON.stringify({ data: { id: "user-1", ingameName: "Tester", verification: true } }), { status: 200 });
    if (url.endsWith("/v2/orders/my")) return new Response(JSON.stringify({ data: [] }), { status: 200 });
    if (url.endsWith("/v2/order")) return new Response(JSON.stringify({ data: { id: "created-1" } }), { status: 200 });
    throw new Error("Unexpected market request");
  };
  try {
    const status = await connectMarketAccount({ email: "user@example.com", password: "temporary-test-password" });
    assert.deepEqual(status, { connected: true, verified: true, accountName: "Tester" });
    assert.equal(JSON.stringify(status).includes("secret-session-token"), false);
    assert.equal(requests[0].headers.get("authorization"), "JWT");
    assert.equal(JSON.parse(requests[0].body).password, "temporary-test-password");
    assert.equal(requests[1].headers.get("authorization"), "Bearer secret-session-token");
    await getMyMarketOrders();
    assert.deepEqual(await createMarketOrder({ itemId: "prime-part", platinum: 24, quantity: 1, visible: true }), { id: "created-1" });
    assert.deepEqual(JSON.parse(requests[3].body), { itemId: "prime-part", platinum: 24, quantity: 1, visible: true, type: "sell" });
    await disconnectMarketAccount();
  } finally {
    clearMarketAccount();
    globalThis.fetch = originalFetch;
  }
});

test("unverified market accounts cannot create orders", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (String(input).endsWith("/v1/auth/signin")) return new Response(JSON.stringify({ payload: {} }), { status: 200, headers: { Authorization: "JWT test-token" } });
    if (String(input).endsWith("/v2/me")) return new Response(JSON.stringify({ data: { id: "user-2", ingameName: "Unverified", verification: false } }), { status: 200 });
    throw new Error("Unexpected market request");
  };
  try {
    await connectMarketAccount({ email: "user@example.com", password: "temporary-test-password" });
    await assert.rejects(createMarketOrder({ itemId: "prime-part", platinum: 24, quantity: 1, visible: true }), /Verify your warframe\.market account/);
  } finally {
    clearMarketAccount();
    globalThis.fetch = originalFetch;
  }
});
