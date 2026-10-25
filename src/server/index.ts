import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { SnapshotSchema, SettingsSchema, type Snapshot } from "../shared/models.js";
import { planCollection } from "../shared/craft.js";
import { demoRecipes, demoSnapshot } from "./demo.js";
import { findMarketItem, getCachedQuote, getQuote } from "./market.js";
import { connectMarketAccount, disconnectMarketAccount, getMyMarketOrders, marketAccountStatus, updateMarketOrder, createMarketOrder } from "./market-account.js";
import { loadCraftData } from "./catalog.js";
import { parseCompanionInventory } from "./companion.js";
import { canAuthenticateSteam, syncSteamInventory } from "./steam.js";
import { db, loadSettings, loadSnapshot, saveSettings, saveSnapshot } from "./store.js";
export { setSteamAuthenticator } from "./steam.js";

export const app = Fastify({ logger: false, bodyLimit: 12 * 1024 * 1024, trustProxy: false });
let closing = false;
const marketDrafts = new Map<string, { revision: string; expiry: number; items: Map<string, { maxQuantity: number; orderIds: string[]; updateOrderId: string | null }> }>();
const localHost = (value: string | undefined) => !value || /^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(value);

app.addHook("onRequest", async (request, reply) => {
  if (!localHost(request.headers.host)) return reply.code(403).send({ error: "Sortframe only accepts local connections." });
  if (request.headers.origin) return reply.code(403).send({ error: "Browser requests must use the desktop app." });
});

app.get("/api/health", async () => ({ ok: true, closing }));
app.get("/api/snapshot", async () => loadSnapshot());
app.get("/api/settings", async () => loadSettings());
app.get("/api/market/status", async () => marketAccountStatus());
app.post<{ Body: { email?: string; password?: string } }>("/api/market/connect", async (request, reply) => {
  const { email, password } = request.body ?? {};
  if (typeof email !== "string" || typeof password !== "string") return reply.code(400).send({ error: "Enter your warframe.market email and password." });
  try { return await connectMarketAccount({ email, password }); }
  catch { return reply.code(502).send({ error: "warframe.market sign-in failed. Check the account details, verification status, and connection." }); }
});
app.post("/api/market/disconnect", async () => disconnectMarketAccount());
app.get("/api/market/orders", async (_request, reply) => {
  try { return await getMyMarketOrders(); }
  catch { return reply.code(401).send({ error: "Could not read marketplace orders. Sign in again and retry." }); }
});
app.post<{ Body: { items?: Array<{ itemId?: string; quantity?: number; platinum?: number }> } }>("/api/market/review", async (request, reply) => {
  if (!marketAccountStatus().connected) return reply.code(401).send({ error: "Connect your warframe.market account first." });
  const snapshot = loadSnapshot();
  const selected = request.body?.items;
  if (!Array.isArray(selected) || selected.length < 1 || selected.length > 100) return reply.code(400).send({ error: "Select between 1 and 100 surplus items." });
  if (new Set(selected.map((entry) => entry.itemId)).size !== selected.length) return reply.code(400).send({ error: "Each item can only appear once in a review." });
  const plan = await app.inject({ method: "GET", url: "/api/plan" });
  if (plan.statusCode !== 200) return reply.code(503).send({ error: "The current collection plan is unavailable." });
  const planned = (plan.json() as { items: Array<{ id: string; name: string; recommendation: string; surplus: number }> }).items;
  let orders;
  try { orders = await getMyMarketOrders(); } catch { return reply.code(401).send({ error: "Could not read existing orders. Sign in again and retry." }); }
  const reviewed = [];
  for (const entry of selected) {
    if (typeof entry.itemId !== "string" || entry.itemId.length > 300 || !Number.isInteger(entry.quantity) || entry.quantity! < 1 || entry.quantity! > 9999 || !Number.isInteger(entry.platinum) || entry.platinum! < 1 || entry.platinum! > 900000) return reply.code(400).send({ error: "Listing quantities and prices must be within warframe.market's limits." });
    const item = planned.find((candidate) => candidate.id === entry.itemId);
    if (!item || item.recommendation !== "Sell for platinum" || entry.quantity! > item.surplus) return reply.code(409).send({ error: "A selected item is no longer confirmed surplus. Refresh the collection plan." });
    const marketItem = await findMarketItem(entry.itemId);
    if (!marketItem) return reply.code(409).send({ error: `No exact marketplace item mapping was found for ${item.name}.` });
    const quote = await getQuote({ itemId: entry.itemId, platform: "pc", crossplay: false }, true);
    const existing = orders.filter((order) => order.type === "sell" && order.itemId === marketItem.id);
    const updateOrder = existing[0];
    const maxQuantity = Math.max(0, item.surplus - existing.filter((order) => order.id !== updateOrder?.id).reduce((sum, order) => sum + Math.max(0, order.quantity), 0));
    reviewed.push({ itemId: entry.itemId, marketItemId: marketItem.id, name: item.name, quantity: updateOrder?.quantity ?? entry.quantity, maxQuantity, platinum: entry.platinum, quote, existingOrders: existing, action: existing.length ? "existing" : "create" });
  }
  const now = Date.now();
  for (const [id, draft] of marketDrafts) if (draft.expiry <= now) marketDrafts.delete(id);
  const reviewId = randomUUID();
  marketDrafts.set(reviewId, { revision: snapshot.revision, expiry: now + 10 * 60 * 1000, items: new Map(reviewed.map((item) => [item.itemId, { maxQuantity: item.maxQuantity, orderIds: item.existingOrders.map((order) => order.id), updateOrderId: item.existingOrders[0]?.id ?? null }])) });
  return { reviewId, revision: snapshot.revision, reviewedAt: new Date().toISOString(), verified: marketAccountStatus().verified, items: reviewed };
});
app.post<{ Body: { reviewId?: string; revision?: string; items?: Array<{ itemId?: string; marketItemId?: string; quantity?: number; platinum?: number; action?: string; orderId?: string }> } }>("/api/market/publish", async (request, reply) => {
  const account = marketAccountStatus();
  if (!account.connected) return reply.code(401).send({ error: "Connect your warframe.market account first." });
  if (!account.verified) return reply.code(403).send({ error: "Verify your warframe.market account before publishing." });
  const snapshot = loadSnapshot();
  const entries = request.body?.items;
  const draft = request.body?.reviewId ? marketDrafts.get(request.body.reviewId) : undefined;
  if (!draft || draft.expiry <= Date.now()) return reply.code(409).send({ error: "This review expired or was already submitted. Prepare a fresh review before publishing." });
  if (!request.body?.revision || request.body.revision !== snapshot.revision || draft.revision !== snapshot.revision) return reply.code(409).send({ error: "Inventory changed after review. Refresh the review before publishing." });
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 100) return reply.code(400).send({ error: "Select between 1 and 100 reviewed items." });
  if (new Set(entries.map((entry) => entry.itemId)).size !== entries.length) return reply.code(400).send({ error: "Each reviewed item can only be submitted once." });
  if (entries.some((entry) => !entry.itemId || !draft.items.has(entry.itemId))) return reply.code(409).send({ error: "This batch contains an item that was not included in the review." });
  marketDrafts.delete(request.body.reviewId!);
  const planResponse = await app.inject({ method: "GET", url: "/api/plan" });
  if (planResponse.statusCode !== 200) return reply.code(503).send({ error: "The current collection plan is unavailable." });
  const plan = planResponse.json() as { items: Array<{ id: string; recommendation: string; surplus: number }> };
  let orders;
  try { orders = await getMyMarketOrders(); } catch { return reply.code(401).send({ error: "Could not reconcile existing listings. Sign in again." }); }
  const results = [];
  for (const entry of entries) {
    const reviewedItem = typeof entry.itemId === "string" ? draft.items.get(entry.itemId) : undefined;
    if (typeof entry.itemId !== "string" || typeof entry.marketItemId !== "string" || !Number.isInteger(entry.quantity) || entry.quantity! < 1 || entry.quantity! > reviewedItem!.maxQuantity || entry.quantity! > 9999 || !Number.isInteger(entry.platinum) || entry.platinum! < 1 || entry.platinum! > 900000 || !["create", "update"].includes(entry.action ?? "")) {
      results.push({ itemId: entry.itemId ?? null, status: "rejected", reason: "Listing details were invalid." });
      continue;
    }
    const item = plan.items.find((candidate) => candidate.id === entry.itemId);
    const marketItem = await findMarketItem(entry.itemId);
    if (!item || item.recommendation !== "Sell for platinum" || entry.quantity! > item.surplus || marketItem?.id !== entry.marketItemId) {
      results.push({ itemId: entry.itemId, status: "rejected", reason: "The item is no longer confirmed surplus or its marketplace mapping changed." });
      continue;
    }
    await getQuote({ itemId: entry.itemId, platform: "pc", crossplay: false }, true);
    const existing = orders.filter((order) => order.type === "sell" && order.itemId === marketItem.id);
    if (entry.action === "update" && (reviewedItem!.maxQuantity < 1 || reviewedItem!.updateOrderId !== entry.orderId || !reviewedItem!.orderIds.includes(entry.orderId ?? ""))) {
      results.push({ itemId: entry.itemId, status: "rejected", reason: "The selected existing order was not part of this review." });
      continue;
    }
    const chosen = existing.find((order) => order.id === entry.orderId);
    if (entry.action === "update" && !chosen) {
      results.push({ itemId: entry.itemId, status: "rejected", reason: "The reviewed existing order changed. Review again before editing." });
      continue;
    }
    if (entry.action === "create" && existing.length) {
      results.push({ itemId: entry.itemId, status: "rejected", reason: "An existing sell order now uses this surplus. Review it before publishing another." });
      continue;
    }
    if (!marketAccountStatus().verified) {
      results.push({ itemId: entry.itemId, status: "rejected", reason: "The marketplace account is not verified." });
      continue;
    }
    try {
      const result = entry.action === "update" && chosen
        ? await updateMarketOrder(chosen.id, { platinum: entry.platinum!, quantity: entry.quantity! })
        : await createMarketOrder({ itemId: marketItem.id, platinum: entry.platinum!, quantity: entry.quantity!, visible: true });
      orders = await getMyMarketOrders();
      const verifiedOrder = orders.find((order) => order.id === result.id);
      results.push({ itemId: entry.itemId, status: verifiedOrder ? "published" : "uncertain", orderId: result.id });
    } catch {
      try {
        orders = await getMyMarketOrders();
        const match = orders.find((order) => order.type === "sell" && order.itemId === marketItem.id && order.platinum === entry.platinum && order.quantity === entry.quantity);
        results.push({ itemId: entry.itemId, status: match ? "reconciled" : "uncertain", orderId: match?.id ?? null });
      } catch { results.push({ itemId: entry.itemId, status: "uncertain", orderId: null }); }
    }
  }
  return { revision: snapshot.revision, results };
});
app.get("/api/plan", async () => {
  const snapshot = loadSnapshot();
  const priced = { ...snapshot, entries: snapshot.entries.map((entry) => ({ ...entry, platinumAsk: getCachedQuote(entry.id)?.lowestAsk ?? entry.platinumAsk })) };
  const data = snapshot.source === "demo" ? { items: snapshot.entries, recipes: demoRecipes, source: "demo" as const } : await loadCraftData(demoSnapshot().entries, demoRecipes);
  if (snapshot.source !== "demo" && data.source !== "live") return {
    items: snapshot.entries.map((entry) => ({ ...entry, reserved: entry.quantity, surplus: 0, pendingQuantity: 0, recommendation: "Check" as const, reasons: ["Live Prime recipes are unavailable; item was held for review."] })),
    recipeAllocations: [], revision: snapshot.revision
  };
  return planCollection(priced, data.recipes, loadSettings(), data.items);
});
app.get("/api/catalog/status", async () => {
  const data = await loadCraftData(demoSnapshot().entries, demoRecipes);
  return { source: data.source, loadedAt: data.loadedAt, itemCount: data.items.length, recipeCount: data.recipes.length };
});
app.post("/api/catalog/refresh", async () => {
  const data = await loadCraftData(demoSnapshot().entries, demoRecipes, true);
  return { source: data.source, loadedAt: data.loadedAt, itemCount: data.items.length, recipeCount: data.recipes.length };
});
app.get<{ Querystring: { itemId?: string; platform?: string; crossplay?: string } }>("/api/quote", async (request, reply) => {
  const { itemId, platform = "pc", crossplay = "false" } = request.query;
  if (!itemId || itemId.length > 300 || !["pc", "ps4", "xbox", "switch", "mobile"].includes(platform) || !["true", "false"].includes(crossplay)) return reply.code(400).send({ error: "Quote request is invalid." });
  try { return await getQuote({ itemId, platform: platform as "pc" | "ps4" | "xbox" | "switch" | "mobile", crossplay: crossplay === "true" }); }
  catch { return reply.code(502).send({ error: "Could not refresh the public market quote. Try again later." }); }
});
app.get<{ Querystring: { itemIds?: string; platform?: string; crossplay?: string } }>("/api/quotes", async (request, reply) => {
  const { itemIds = "", platform = "pc", crossplay = "false" } = request.query;
  const ids = [...new Set(itemIds.split(",").filter(Boolean))];
  if (!ids.length || ids.length > 40 || ids.some((id) => id.length > 300) || !["pc", "ps4", "xbox", "switch", "mobile"].includes(platform) || !["true", "false"].includes(crossplay)) return reply.code(400).send({ error: "Quote request is invalid." });
  const quotes = [];
  for (const itemId of ids) {
    try { quotes.push({ itemId, quote: await getQuote({ itemId, platform: platform as "pc" | "ps4" | "xbox" | "switch" | "mobile", crossplay: crossplay === "true" }) }); }
    catch { quotes.push({ itemId, quote: null }); }
  }
  return { platform, crossplay: crossplay === "true", quotes };
});
app.put("/api/settings", async (request, reply) => {
  const parsed = SettingsSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Settings are invalid." });
  return saveSettings(parsed.data);
});
app.put("/api/snapshot", async (request, reply) => {
  const parsed = SnapshotSchema.safeParse(request.body);
  if (!parsed.success || parsed.data.entries.length === 0) return reply.code(400).send({ error: "Snapshot is empty or invalid. Your saved inventory was kept." });
  return saveSnapshot(parsed.data);
});
app.post("/api/import", async (request, reply) => {
  const parsed = SnapshotSchema.safeParse(request.body);
  if (!parsed.success || parsed.data.entries.length === 0) return reply.code(400).send({ error: "Import is empty or invalid. Your saved inventory was kept." });
  return saveSnapshot({ ...parsed.data, source: "import", revision: randomUUID() });
});
app.post("/api/import-companion", async (request, reply) => {
  try {
    const data = await loadCraftData(demoSnapshot().entries, demoRecipes);
    if (data.source !== "live") return reply.code(503).send({ error: "Live Prime item data is unavailable. Your saved inventory was left unchanged." });
    return saveSnapshot(parseCompanionInventory(request.body, data));
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : "Companion inventory could not be imported." });
  }
});
app.post("/api/warframe/steam/sync", async (_request, reply) => {
  if (!canAuthenticateSteam()) return reply.code(503).send({ error: "Steam sign in is available inside the Sortframe desktop app." });
  try {
    const data = loadCraftData(demoSnapshot().entries, demoRecipes);
    const snapshot = await syncSteamInventory(data);
    if (!snapshot.entries.length) return reply.code(400).send({ error: "Warframe returned an empty inventory. Your saved inventory was left unchanged." });
    return saveSnapshot(snapshot);
  } catch (error) {
    return reply.code(502).send({ error: error instanceof Error ? error.message : "Warframe companion sync failed. Your saved inventory was left unchanged." });
  }
});
app.post("/api/demo/reset", async () => saveSnapshot(demoSnapshot()));
app.get("/api/export", async (_request, reply) => {
  reply.header("content-type", "application/json; charset=utf-8");
  reply.header("content-disposition", "attachment; filename=sortframe-snapshot.json");
  return loadSnapshot();
});
app.post("/api/quit", async (_request, reply) => {
  return reply.send({ ok: true });
});

export async function closeBackend() {
  if (closing) return;
  closing = true;
  try { await app.close(); } finally { db.close(); }
}
