import type { Quote } from "../shared/models.js";
import { readCache, writeCache } from "./store.js";

type MarketItem = { id: string; slug: string; gameRef: string };
type MarketOrder = { type?: string; platinum?: number; quantity?: number; visible?: boolean; user?: { status?: string; lastSeen?: string; platform?: string; crossplay?: boolean } };
type Envelope<T> = { data?: T; error?: unknown };
type QuoteOptions = { itemId: string; platform: Quote["platform"]; crossplay: boolean };

const origin = "https://api.warframe.market/v2";
const itemsTtl = 24 * 60 * 60 * 1000;
const quoteTtl = 5 * 60 * 1000;
let itemIndex: { expiry: number; items: MarketItem[] } | undefined;
let nextRequestAt = 0;
const quoteCache = new Map<string, { expiry: number; quote: Quote | null }>();

async function pace() {
  const wait = Math.max(0, nextRequestAt - Date.now());
  nextRequestAt = Math.max(Date.now(), nextRequestAt) + 500;
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
}

async function get<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  await pace();
  let response: Response;
  for (let attempt = 0; ; attempt++) {
    response = await fetch(url, { headers: { "User-Agent": "Sortframe/0.1 (+https://github.com/xSil3nt/sortframe)", "Language": "en", ...headers }, signal: AbortSignal.timeout(15000) });
    if (response.status !== 429 || attempt >= 2) break;
    const retryAfter = Number(response.headers.get("retry-after")) || 2 ** (attempt + 1);
    await new Promise((resolve) => setTimeout(resolve, Math.min(retryAfter, 30) * 1000));
    await pace();
  }
  if (!response.ok) throw new Error(`warframe.market returned HTTP ${response.status}.`);
  const envelope = await response.json() as Envelope<T>;
  if (envelope.error || envelope.data === undefined || envelope.data === null) throw new Error("warframe.market returned an incomplete response.");
  return envelope.data;
}

async function listItems(): Promise<MarketItem[]> {
  if (itemIndex && itemIndex.expiry > Date.now()) return itemIndex.items;
  const data = await get<Array<Partial<MarketItem>>>(`${origin}/items`);
  if (!Array.isArray(data)) throw new Error("warframe.market item catalog was invalid.");
  const items = data.filter((item): item is MarketItem => typeof item.id === "string" && typeof item.slug === "string" && typeof item.gameRef === "string");
  itemIndex = { expiry: Date.now() + itemsTtl, items };
  return items;
}

export function summarizeOrders(orders: MarketOrder[], now = Date.now()) {
  const fresh = orders.filter((order) => {
    if (!Number.isFinite(order.platinum) || order.platinum! <= 0 || !Number.isFinite(order.quantity) || order.quantity! <= 0 || order.visible === false) return false;
    if (!order.user || !["ingame", "online"].includes((order.user.status ?? "").toLowerCase())) return false;
    if (order.user.lastSeen && now - Date.parse(order.user.lastSeen) > 24 * 60 * 60 * 1000) return false;
    return true;
  });
  const asks = fresh.filter((order) => order.type === "sell").map((order) => order.platinum!).sort((a, b) => a - b);
  const bids = fresh.filter((order) => order.type === "buy").map((order) => order.platinum!).sort((a, b) => b - a);
  const lowFive = asks.slice(0, 5);
  const median = lowFive.length ? lowFive[Math.floor(lowFive.length / 2)] : null;
  return { lowestAsk: asks[0] ?? null, highestBid: bids[0] ?? null, medianFiveAsks: median };
}

export async function getQuote(options: QuoteOptions): Promise<Quote | null> {
  const key = `${options.platform}|${options.crossplay}|${options.itemId}`;
  const cached = quoteCache.get(key);
  if (cached && cached.expiry > Date.now()) return cached.quote;
  const persisted = readCache<{ expiry: number; quote: Quote | null }>(`quote:${key}`);
  if (persisted && persisted.expiry > Date.now()) {
    quoteCache.set(key, persisted);
    return persisted.quote;
  }
  const items = await listItems();
  const exact = items.find((item) => item.gameRef === options.itemId);
  if (!exact) {
    quoteCache.set(key, { expiry: Date.now() + quoteTtl, quote: null });
    writeCache(`quote:${key}`, quoteCache.get(key));
    return null;
  }
  const headers = { Platform: options.platform, Crossplay: String(options.crossplay) };
  const data = await get<MarketOrder[]>(`${origin}/orders/itemId/${encodeURIComponent(exact.id)}`, headers);
  if (!Array.isArray(data)) throw new Error("warframe.market order book was invalid.");
  const quote = {
    itemId: options.itemId,
    platform: options.platform,
    crossplay: options.crossplay,
    ...summarizeOrders(data),
    observedAt: new Date().toISOString(),
    source: "warframe.market" as const
  };
  quoteCache.set(key, { expiry: Date.now() + quoteTtl, quote });
  writeCache(`quote:${key}`, quoteCache.get(key));
  return quote;
}

export function getCachedQuote(itemId: string): Quote | null {
  const key = `pc|false|${itemId}`;
  const cached = quoteCache.get(key) ?? readCache<{ expiry: number; quote: Quote | null }>(`quote:${key}`);
  if (!cached || cached.expiry <= Date.now()) return null;
  return cached.quote;
}
