import type { InventoryEntry, Recipe, Settings, Snapshot, PlannedItem } from "./models.js";

export type CraftPlan = {
  items: PlannedItem[];
  recipeAllocations: { itemId: string; itemName: string; quantity: number; destination: string; chain: string[] }[];
  revision: string;
};

const sortInventory = (entries: InventoryEntry[]) => new Map(entries.map((entry) => [entry.id, entry]));

export function planCollection(snapshot: Snapshot, recipes: Recipe[], settings: Settings, catalog: InventoryEntry[] = []): CraftPlan {
  const entries = [...snapshot.entries];
  const existingIds = new Set(entries.map((entry) => entry.id));
  for (const entry of catalog) {
    if (existingIds.has(entry.id)) continue;
    entries.push({ ...entry, quantity: 0, invested: 0, mastered: false });
    existingIds.add(entry.id);
  }
  for (const recipe of recipes.filter((item) => item.isPrimeEquipment && !existingIds.has(item.outputId))) {
    entries.push({ id: recipe.outputId, name: recipe.outputName, kind: "equipment", category: "Prime Gear", quantity: 0, invested: 0, mastered: false, prime: true });
    existingIds.add(recipe.outputId);
  }
  const inventory = sortInventory(entries);
  const recipeMap = new Map(recipes.map((recipe) => [recipe.outputId, recipe]));
  const available = new Map<string, number>();
  const reserved = new Map<string, number>();
  const protectedCopies = new Map<string, number>();
  const reasons = new Map<string, string[]>();
  const futureStock = new Map<string, number>();
  for (const build of snapshot.pendingBuilds ?? []) futureStock.set(build.itemId, (futureStock.get(build.itemId) ?? 0) + build.quantity);
  const allocations: CraftPlan["recipeAllocations"] = [];
  const allocatedReusable = new Set<string>();
  const recipeFor = (id: string) => recipeMap.get(id);

  for (const entry of entries) {
    const locked = Math.max(entry.invested, settings.locks[entry.id] ?? 0);
    available.set(entry.id, Math.max(0, entry.quantity - locked));
    reserved.set(entry.id, locked);
    protectedCopies.set(entry.id, locked);
    if (locked > 0) reasons.set(entry.id, [`${locked} protected ${locked === 1 ? "copy" : "copies"}`]);
  }

  const demands = new Map<string, { quantity: number; destination: string; chain: string[] }[]>();
  const addDemand = (id: string, quantity: number, destination: string, chain: string[]) => {
    const list = demands.get(id) ?? [];
    list.push({ quantity, destination, chain });
    demands.set(id, list);
  };

  for (const entry of entries.filter((item) => item.prime && item.kind === "equipment")) {
    if (settings.excluded.includes(entry.id)) continue;
    const desired = settings.targets[entry.id] ?? (settings.mode === "collection" ? 1 : Number(entry.mastered));
    const alreadyProtected = Math.min(desired, protectedCopies.get(entry.id) ?? 0);
    if (desired > alreadyProtected) addDemand(entry.id, desired - alreadyProtected, entry.name, [entry.name]);
  }

  const stack = new Set<string>();
  const allocate = (id: string, quantity: number, destination: string, chain: string[]) => {
    if (quantity <= 0) return;
    const item = inventory.get(id);
    if (!item) {
      allocations.push({ itemId: id, itemName: id, quantity, destination, chain });
      return;
    }
    const free = available.get(id) ?? 0;
    const use = Math.min(free, quantity);
    if (use > 0) {
      available.set(id, free - use);
      reserved.set(id, (reserved.get(id) ?? 0) + use);
      allocations.push({ itemId: id, itemName: item.name, quantity: use, destination, chain });
      const list = reasons.get(id) ?? [];
      list.push(`Used for ${destination}`);
      reasons.set(id, list);
    }
    const pending = Math.min(futureStock.get(id) ?? 0, quantity - use);
    if (pending > 0) {
      futureStock.set(id, (futureStock.get(id) ?? 0) - pending);
      allocations.push({ itemId: id, itemName: item.name, quantity: pending, destination, chain: [...chain, "Pending build"] });
      const list = reasons.get(id) ?? [];
      list.push(`${pending} pending for ${destination}`);
      reasons.set(id, list);
    }
    const missing = quantity - use - pending;
    if (!missing) return;
    const recipe = recipeFor(id);
    if (!recipe || stack.has(id)) {
      allocations.push({ itemId: id, itemName: item.name, quantity: missing, destination, chain });
      const list = reasons.get(id) ?? [];
      list.push(stack.has(id) ? `Recipe cycle needs review for ${destination}` : `Missing for ${destination}`);
      reasons.set(id, list);
      return;
    }
    stack.add(id);
    for (const ingredient of recipe.ingredients) {
      if (ingredient.reusable && allocatedReusable.has(ingredient.id)) continue;
      if (ingredient.reusable) allocatedReusable.add(ingredient.id);
      allocate(ingredient.id, ingredient.reusable ? ingredient.quantity : ingredient.quantity * missing, destination, [...chain, item.name, ingredient.name]);
    }
    stack.delete(id);
  };

  for (const [id, requests] of demands) {
    for (const request of requests) allocate(id, request.quantity, request.destination, request.chain);
  }

  const planned: PlannedItem[] = entries.map((entry) => {
    const locked = Math.max(entry.invested, settings.locks[entry.id] ?? 0);
    const reserve = Math.min(entry.quantity, Math.max(locked, reserved.get(entry.id) ?? 0));
    const surplus = Math.max(0, entry.quantity - reserve);
    const warnings = reasons.get(entry.id) ?? [];
    const isUnmappedPart = entry.kind === "component" && !recipes.some((recipe) => recipe.ingredients.some((i) => i.id === entry.id));
    const desired = settings.targets[entry.id] ?? (settings.mode === "collection" ? 1 : Number(entry.mastered));
    const pendingForItem = snapshot.pendingBuilds?.filter((build) => build.itemId === entry.id).reduce((sum, build) => sum + build.quantity, 0) ?? 0;
    const missingUnsupportedTarget = entry.kind === "equipment" && desired > entry.quantity + pendingForItem && !recipeMap.has(entry.id);
    if (missingUnsupportedTarget) warnings.push("Collection recipe is missing; held for review.");
    let recommendation: PlannedItem["recommendation"] = "Keep";
    if (isUnmappedPart || missingUnsupportedTarget) recommendation = "Check";
    else if (surplus > 0 && entry.platinumAsk === undefined) recommendation = "Check";
    else if (surplus > 0 && (entry.platinumAsk ?? 0) >= settings.platinumThreshold) recommendation = "Sell for platinum";
    else if (surplus > 0 && entry.ducats !== undefined) recommendation = "Ducats";
    else if (surplus > 0) recommendation = "Check";
    return { ...entry, reserved: reserve, surplus, pendingQuantity: pendingForItem, recommendation, reasons: warnings };
  });

  return { items: planned, recipeAllocations: allocations, revision: snapshot.revision };
}
