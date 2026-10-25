import type { Quote } from "../shared/models.js";
import { readCache, writeCache } from "./store.js";

type MarketItem = { id: string; slug: string; gameRef: string };
type MarketOrder = { type?: string; platinum?: number; quantity?: number; visible?: boolean; user?: { id?: string; status?: string; lastSeen?: string; platform?: string; crossplay?: boolean } };
type Envelope<T> = { data?: T; payload?: T; error?: unknown };
type QuoteOptions = { itemId: string; platform: Quote["platform"]; crossplay: boolean };

const origin = "https://api.warframe.market/v2";
const originV1 = "https://api.warframe.market/v1";
const itemsTtl = 24 * 60 * 60 * 1000;
const quoteTtl = 5 * 60 * 1000;
let itemIndex: { expiry: number; items: MarketItem[] } | undefined;
let nextRequestAt = 0;
let ownMarketUserId: string | null = null;
const quoteCache = new Map<string, { expiry: number; quote: Quote | null }>();

async function pace() {
  const wait = Math.max(0, nextRequestAt - Date.now());
  nextRequestAt = Math.max(Date.now(), nextRequestAt) + 500;
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
}

export async function marketRequest<T>(path: string, options: { method?: string; headers?: Record<string, string>; body?: unknown; authenticated?: boolean; legacy?: boolean; onResponseHeaders?: (headers: Headers) => void } = {}): Promise<T> {
  await pace();
  let response: Response;
  for (let attempt = 0; ; attempt++) {
    const headers: Record<string, string> = { "User-Agent": "Sortframe/0.1.0 (+https://github.com/xSil3nt/sortframe)", "Language": "en", Accept: "application/json", ...options.headers };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    response = await fetch(`${options.legacy ? originV1 : origin}${path}`, {
      method: options.method ?? "GET",
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: AbortSignal.timeout(15000)
    });
    options.onResponseHeaders?.(response.headers);
    if (response.status !== 429 || attempt >= 2) break;
    const retryAfter = Number(response.headers.get("retry-after")) || 2 ** (attempt + 1);
    await new Promise((resolve) => setTimeout(resolve, Math.min(retryAfter, 30) * 1000));
    await pace();
  }
  const envelope = await response.json().catch(() => null) as Envelope<T> | null;
  const data = options.legacy ? envelope?.payload ?? envelope?.data : envelope?.data;
  if (!response.ok || !envelope || envelope.error || data === undefined || data === null) {
    const error = new Error(`warframe.market request failed (${response.status}).`);
    Object.assign(error, { status: response.status, details: envelope?.error });
    throw error;
  }
  return data;
}

async function get<T>(path: string, headers: Record<string, string> = {}): Promise<T> {
  return marketRequest<T>(path, { headers });
}

export async function findMarketItem(gameRef: string): Promise<MarketItem | undefined> {
  return (await listItems()).find((item) => item.gameRef === gameRef);
}

export async function getMarketItemById(id: string): Promise<MarketItem | undefined> {
  return (await listItems()).find((item) => item.id === id);
}

async function listItems(): Promise<MarketItem[]> {
  if (itemIndex && itemIndex.expiry > Date.now()) return itemIndex.items;
  const data = await get<Array<Partial<MarketItem>>>("/items");
  if (!Array.isArray(data)) throw new Error("warframe.market item catalog was invalid.");
  const items = data.filter((item): item is MarketItem => typeof item.id === "string" && typeof item.slug === "string" && typeof item.gameRef === "string");
  itemIndex = { expiry: Date.now() + itemsTtl, items };
  return items;
}

export function setMarketAccountId(id: string | null) {
  ownMarketUserId = id;
}

export function summarizeOrders(orders: MarketOrder[], now = Date.now(), ownUserId = ownMarketUserId) {
  const fresh = orders.filter((order) => {
    if (!Number.isFinite(order.platinum) || order.platinum! <= 0 || !Number.isFinite(order.quantity) || order.quantity! <= 0 || order.visible === false) return false;
    if (!order.user || !["ingame", "online"].includes((order.user.status ?? "").toLowerCase())) return false;
    if (order.user.lastSeen && now - Date.parse(order.user.lastSeen) > 24 * 60 * 60 * 1000) return false;
    if (ownUserId && order.user.id === ownUserId) return false;
    return true;
  });
  const asks = fresh.filter((order) => order.type === "sell").map((order) => order.platinum!).sort((a, b) => a - b);
  const bids = fresh.filter((order) => order.type === "buy").map((order) => order.platinum!).sort((a, b) => b - a);
  const lowFive = asks.slice(0, 5);
  const median = lowFive.length ? lowFive[Math.floor(lowFive.length / 2)] : null;
  return { lowestAsk: asks[0] ?? null, highestBid: bids[0] ?? null, medianFiveAsks: median };
}

export async function getQuote(options: QuoteOptions, force = false): Promise<Quote | null> {
  const key = `${options.platform}|${options.crossplay}|${options.itemId}`;
  const cached = quoteCache.get(key);
  if (!force && cached && cached.expiry > Date.now()) return cached.quote;
  const persisted = readCache<{ expiry: number; quote: Quote | null }>(`quote:${key}`);
  if (!force && persisted && persisted.expiry > Date.now()) {
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
  const data = await get<MarketOrder[]>(`/orders/itemId/${encodeURIComponent(exact.id)}`, headers);
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
