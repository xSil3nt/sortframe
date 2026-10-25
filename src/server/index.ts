import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SnapshotSchema, SettingsSchema, type Snapshot } from "../shared/models.js";
import { planCollection } from "../shared/craft.js";
import { demoRecipes, demoSnapshot } from "./demo.js";
import { getCachedQuote, getQuote } from "./market.js";
import { db, loadSettings, loadSnapshot, saveSettings, saveSnapshot } from "./store.js";

const app = Fastify({ logger: false, bodyLimit: 12 * 1024 * 1024, trustProxy: false });
let closing = false;
let boundPort = Number(process.env.SORTFRAME_PORT ?? 4175);
const localHost = (value: string | undefined) => !value || /^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(value);

app.addHook("onRequest", async (request, reply) => {
  if (!localHost(request.headers.host)) return reply.code(403).send({ error: "Sortframe only accepts local connections." });
  const origin = request.headers.origin;
  if (origin && !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(origin)) return reply.code(403).send({ error: "Request origin is not allowed." });
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method) && origin) {
    const allowed = new Set([`http://127.0.0.1:${boundPort}`, `http://localhost:${boundPort}`]);
    if (process.env.NODE_ENV !== "production") allowed.add("http://127.0.0.1:5173");
    if (!allowed.has(origin)) return reply.code(403).send({ error: "Request origin does not match Sortframe." });
  }
});

app.get("/api/health", async () => ({ ok: true, closing }));
app.get("/api/snapshot", async () => loadSnapshot());
app.get("/api/settings", async () => loadSettings());
app.get("/api/plan", async () => {
  const snapshot = loadSnapshot();
  const priced = { ...snapshot, entries: snapshot.entries.map((entry) => ({ ...entry, platinumAsk: getCachedQuote(entry.id)?.lowestAsk ?? entry.platinumAsk })) };
  return planCollection(priced, demoRecipes, loadSettings());
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
app.post("/api/demo/reset", async () => saveSnapshot(demoSnapshot()));
app.get("/api/export", async (_request, reply) => {
  reply.header("content-type", "application/json; charset=utf-8");
  reply.header("content-disposition", "attachment; filename=sortframe-snapshot.json");
  return loadSnapshot();
});
app.post("/api/quit", async (_request, reply) => {
  reply.send({ ok: true });
  setTimeout(async () => {
    closing = true;
    try { await app.close(); } finally { db.close(); }
  }, 100);
});

if (process.env.NODE_ENV === "production") {
  const here = dirname(fileURLToPath(import.meta.url));
  await app.register(fastifyStatic, { root: resolve(here, "../web"), prefix: "/" });
  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith("/api/")) return reply.code(404).send({ error: "Not found" });
    return reply.sendFile("index.html");
  });
}

const preferredPort = Number(process.env.SORTFRAME_PORT ?? 4175);
let port = preferredPort;
for (; port < preferredPort + 10; port++) {
  boundPort = port;
  try {
    await app.listen({ host: "127.0.0.1", port });
    break;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
  }
}
if (port === preferredPort + 10) throw new Error("No available local port was found.");
if (process.env.SORTFRAME_READY_FILE) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(process.env.SORTFRAME_READY_FILE, String(port), { encoding: "utf8" });
}
process.on("SIGINT", async () => { if (!closing) await app.close(); db.close(); process.exit(0); });
process.on("SIGTERM", async () => { if (!closing) await app.close(); db.close(); process.exit(0); });
