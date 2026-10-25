import type { InventoryEntry, Recipe } from "../shared/models.js";
import { readCache, writeCache } from "./store.js";

const marketItemsUrl = "https://api.warframe.market/v2/items";
const gameDataBase = "https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json";
const gearFiles = ["Warframes", "Primary", "Secondary", "Melee", "Sentinels", "SentinelWeapons", "Archwing", "Arch-Gun", "Arch-Melee", "Pets"];
const ttl = 24 * 60 * 60 * 1000;

type WfcdItem = { uniqueName?: string; name?: string; category?: string; productCategory?: string; isPrime?: boolean; masterable?: boolean; components?: { uniqueName?: string; name?: string; itemCount?: number }[] };
type MarketItem = { id?: string; slug?: string; gameRef?: string; ducats?: number; tradable?: boolean; i18n?: { en?: { name?: string } } };
export type CraftData = { items: InventoryEntry[]; recipes: Recipe[]; loadedAt: string; source: "live" | "stale" | "demo" };

let cache: { expiresAt: number; data: CraftData } | undefined;

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { "User-Agent": "Sortframe/0.1 (+https://github.com/xSil3nt/sortframe)", "Language": "en" }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Data source returned HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

function envelopeData<T>(value: unknown, key: string): T {
  if (typeof value === "object" && value !== null && key in value) return (value as Record<string, T>)[key];
  throw new Error(`Expected ${key} data was missing`);
}

export async function loadCraftData(fallbackItems: InventoryEntry[], fallbackRecipes: Recipe[], force = false): Promise<CraftData> {
  if (!force && cache && cache.expiresAt > Date.now()) return cache.data;
  const persisted = readCache<{ expiresAt: number; data: CraftData }>("prime-catalog:v2");
  if (!force && !cache && persisted?.expiresAt && persisted.expiresAt > Date.now() && persisted.data.source === "live") {
    cache = persisted;
    return persisted.data;
  }
  try {
    const [marketResponse, ...categoryResponses] = await Promise.all([
      readJson<unknown>(marketItemsUrl),
      ...gearFiles.map((file) => readJson<WfcdItem[]>(`${gameDataBase}/${encodeURIComponent(file)}.json`))
    ]);
    const market = envelopeData<MarketItem[]>(marketResponse, "data");
    if (!Array.isArray(market)) throw new Error("Prime item catalog was invalid");

    const gear = categoryResponses.flat().filter((item): item is WfcdItem & { uniqueName: string; name: string } => item.isPrime === true && typeof item.uniqueName === "string" && typeof item.name === "string");
    const gearByRef = new Map(gear.map((item) => [item.uniqueName, item]));
    const namesByRef = new Map(gear.map((item) => [item.uniqueName, item.name]));
    const parts = market.filter((item): item is MarketItem & { gameRef: string; i18n: { en: { name: string } }; ducats: number } => typeof item.gameRef === "string" && typeof item.i18n?.en?.name === "string" && typeof item.ducats === "number" && /prime/i.test(item.i18n.en.name));
    const marketByRef = new Map(parts.map((item) => [item.gameRef, item]));
    for (const item of parts) if (!gearByRef.has(item.gameRef)) namesByRef.set(item.gameRef, item.i18n.en.name);

    const items: InventoryEntry[] = [
      ...gear.map((item) => ({ id: item.uniqueName, name: item.name, kind: "equipment" as const, category: item.category ?? item.productCategory ?? "Prime Gear", quantity: 0, invested: 0, mastered: false, prime: true })),
      ...parts.filter((item) => !gearByRef.has(item.gameRef)).map((item) => ({ id: item.gameRef, name: item.i18n.en.name, kind: "component" as const, category: "Prime Part", quantity: 0, invested: 0, mastered: false, ducats: item.ducats, prime: true }))
    ];
    const recipes = gear.flatMap((output) => {
      const grouped = new Map<string, number>();
      for (const ingredient of output.components ?? []) {
        if (!ingredient.uniqueName || !Number.isInteger(ingredient.itemCount) || ingredient.itemCount! < 1) continue;
        if (!gearByRef.has(ingredient.uniqueName) && !marketByRef.has(ingredient.uniqueName)) continue;
        grouped.set(ingredient.uniqueName, (grouped.get(ingredient.uniqueName) ?? 0) + ingredient.itemCount!);
      }
      if (!grouped.size) return [];
      const ingredients = [...grouped].map(([id, quantity]) => ({ id, quantity, name: namesByRef.get(id) ?? id, reusable: false }));
      return [{
        outputId: output.uniqueName!,
        outputName: output.name!,
        blueprintId: output.components?.find((component) => component.name === "Blueprint")?.uniqueName,
        isPrimeEquipment: true,
        ingredients
      }];
    });
    if (!gear.length || !parts.length || !recipes.length) throw new Error("Prime catalog was incomplete");
    const data: CraftData = { items, recipes, loadedAt: new Date().toISOString(), source: "live" };
    cache = { expiresAt: Date.now() + ttl, data };
    writeCache("prime-catalog:v2", cache);
    return data;
  } catch {
    if (cache) {
      return { ...cache.data, source: "stale" };
    }
    const data: CraftData = { items: fallbackItems, recipes: fallbackRecipes, loadedAt: new Date().toISOString(), source: "demo" };
    cache = { expiresAt: Date.now() + 60_000, data };
    return data;
  }
}
