import { randomUUID } from "node:crypto";
import { SnapshotSchema, type InventoryEntry, type Snapshot } from "../shared/models.js";
import type { CraftData } from "./catalog.js";

type OwnedItem = { ItemType?: unknown; ItemCount?: unknown; ItemId?: unknown; XP?: unknown; Polarized?: unknown };
const equipmentCategories = ["Suits", "SpecialItems", "LongGuns", "Pistols", "Melee", "SentinelWeapons", "Sentinels", "SpaceSuits", "SpaceMelee", "SpaceGuns", "KubrowPets", "MechSuits", "MoaPets", "OperatorSuits", "DrifterMelee", "Hoverboards"];

function rows(value: unknown): OwnedItem[] {
  return Array.isArray(value) ? value.filter((item): item is OwnedItem => typeof item === "object" && item !== null) : [];
}

function readableUnknownName(id: string) {
  const last = id.split("/").filter(Boolean).at(-1) ?? id;
  return last.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/Prime/g, " Prime").trim();
}

export function parseCompanionInventory(raw: unknown, catalog: CraftData): Snapshot {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("Companion inventory was not an object.");
  const data = raw as Record<string, unknown>;
  const known = new Map(catalog.items.map((item) => [item.id, item]));
  const mastery = new Set(rows(data.XPInfo).map((item) => typeof item.ItemType === "string" ? item.ItemType : ""));
  const counts = new Map<string, InventoryEntry>();
  const addStack = (id: string, quantity: number) => {
    const metadata = known.get(id);
    if (metadata?.kind === "equipment" || !metadata && !/prime/i.test(id)) return;
    const current = counts.get(id);
    const name = metadata?.name ?? readableUnknownName(id);
    counts.set(id, {
      ...(metadata ?? { id, name, kind: "component" as const, category: "Unmapped Prime data", quantity: 0, invested: 0, mastered: false, prime: true }),
      quantity: (current?.quantity ?? 0) + quantity,
      invested: current?.invested ?? 0,
      mastered: false
    });
  };

  for (const category of ["Recipes", "MiscItems"]) {
    for (const item of rows(data[category])) {
      if (typeof item.ItemType !== "string" || !Number.isInteger(item.ItemCount) || Number(item.ItemCount) < 1) continue;
      addStack(item.ItemType, Number(item.ItemCount));
    }
  }

  for (const category of equipmentCategories) {
    for (const item of rows(data[category])) {
      if (typeof item.ItemType !== "string") continue;
      const metadata = known.get(item.ItemType);
      if (metadata?.kind !== "equipment") continue;
      const current = counts.get(item.ItemType);
      const xp = typeof item.XP === "number" && item.XP > 0;
      const invested = xp || (typeof item.Polarized === "number" && item.Polarized > 0) ? 1 : 0;
      counts.set(item.ItemType, {
        ...metadata,
        quantity: (current?.quantity ?? 0) + 1,
        invested: (current?.invested ?? 0) + invested,
        mastered: mastery.has(item.ItemType)
      });
    }
  }

  const recipeByOutput = new Map(catalog.recipes.map((recipe) => [recipe.outputId, recipe]));
  const pendingBuilds = rows(data.PendingRecipes).flatMap((item) => {
    if (typeof item.ItemType !== "string") return [];
    const direct = recipeByOutput.get(item.ItemType);
    const blueprintOwner = catalog.recipes.find((recipe) => recipe.ingredients.some((ingredient) => ingredient.reusable && ingredient.id === item.ItemType));
    const output = direct ?? blueprintOwner;
    if (!output) throw new Error("A pending Foundry item could not be identified. The current inventory was left unchanged.");
    const quantity = Number.isInteger(item.ItemCount) && Number(item.ItemCount) > 0 ? Number(item.ItemCount) : 1;
    return [{ itemId: output.outputId, name: output.outputName, quantity }];
  });

  const snapshot = {
    revision: randomUUID(), source: "import" as const, capturedAt: new Date().toISOString(),
    entries: [...counts.values()], pendingBuilds
  };
  const parsed = SnapshotSchema.safeParse(snapshot);
  if (!parsed.success || parsed.data.entries.length === 0) throw new Error("No recognizable Prime inventory entries were found. Your saved inventory was left unchanged.");
  return parsed.data;
}
