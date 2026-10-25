import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { planCollection } from "./craft.js";
import type { InventoryEntry, Recipe, Snapshot, Settings } from "./models.js";

const baseSettings: Settings = { mode: "collection", platinumThreshold: 20, targets: {}, excluded: [], locks: {} };
const lexRecipes: Recipe[] = [
  { outputId: "lex", outputName: "Lex Prime", isPrimeEquipment: true, ingredients: [{ id: "barrel", name: "Lex Barrel", quantity: 1 }, { id: "receiver", name: "Lex Receiver", quantity: 1 }, { id: "blueprint", name: "Lex Blueprint", quantity: 1 }] },
  { outputId: "aklex", outputName: "Aklex Prime", isPrimeEquipment: true, ingredients: [{ id: "lex", name: "Lex Prime", quantity: 2 }, { id: "akblueprint", name: "Aklex Blueprint", quantity: 1 }] }
];
const row = (id: string, kind: InventoryEntry["kind"], quantity: number, invested = 0): InventoryEntry => ({ id, name: ({ lex: "Lex Prime", aklex: "Aklex Prime", barrel: "Lex Barrel", receiver: "Lex Receiver", blueprint: "Lex Blueprint", akblueprint: "Aklex Blueprint", vasto: "Vasto Prime", akvasto: "Akvasto Prime", vb: "Vasto Barrel", afuris: "Afuris Prime" } as Record<string, string>)[id] ?? id, kind, category: "Prime", quantity, invested, mastered: false, ducats: 15, prime: true });
function snapshot(entries: InventoryEntry[], pendingBuilds: Snapshot["pendingBuilds"] = []): Snapshot { return { revision: randomUUID(), source: "demo", capturedAt: new Date().toISOString(), entries, pendingBuilds }; }
function lexInventory(lex: number, aklex: number, invested = 0) {
  return [row("lex", "equipment", lex, invested), row("aklex", "equipment", aklex), row("barrel", "component", 10), row("receiver", "component", 10), row("blueprint", "component", 10), row("akblueprint", "component", 10)];
}

test("three spare Lex copies fund one Lex and Aklex while preserving the invested Lex", () => {
  const plan = planCollection(snapshot(lexInventory(3, 0, 1)), lexRecipes, baseSettings);
  const lex = plan.items.find((item) => item.id === "lex")!;
  assert.equal(lex.reserved, 3);
  assert.equal(lex.surplus, 0);
  assert.ok(plan.recipeAllocations.some((entry) => entry.itemId === "lex" && entry.destination === "Aklex Prime" && entry.quantity === 2));
});

test("one invested Lex and no Aklex reserves two additional Lex recipes", () => {
  const plan = planCollection(snapshot(lexInventory(1, 0, 1)), lexRecipes, baseSettings);
  const lex = plan.items.find((item) => item.id === "lex")!;
  assert.equal(lex.reserved, 1);
  assert.equal(plan.recipeAllocations.filter((entry) => entry.destination === "Aklex Prime" && entry.itemId === "barrel").reduce((sum, entry) => sum + entry.quantity, 0), 2);
});

test("fresh Lex copies are used for Aklex before loose parts", () => {
  const plan = planCollection(snapshot(lexInventory(3, 0, 1)), lexRecipes, baseSettings);
  assert.equal(plan.recipeAllocations.filter((entry) => entry.destination === "Aklex Prime" && entry.itemId === "lex").reduce((sum, entry) => sum + entry.quantity, 0), 2);
  assert.equal(plan.recipeAllocations.filter((entry) => entry.destination === "Aklex Prime" && entry.itemId === "barrel").length, 0);
});

test("owned Lex and Aklex do not reserve more Lex parts", () => {
  const plan = planCollection(snapshot(lexInventory(1, 1, 0)), lexRecipes, baseSettings);
  assert.equal(plan.items.find((item) => item.id === "barrel")!.reserved, 0);
  assert.equal(plan.items.find((item) => item.id === "receiver")!.reserved, 0);
});

test("investment locks protect copies from being allocated to recipes", () => {
  const entries = lexInventory(3, 0, 0);
  const settings = { ...baseSettings, locks: { lex: 2 } };
  const plan = planCollection(snapshot(entries), lexRecipes, settings);
  assert.equal(plan.items.find((item) => item.id === "lex")!.reserved, 3);
});

test("missing Akvasto and Vasto collection target needs three Vasto copies", () => {
  const recipes: Recipe[] = [
    { outputId: "vasto", outputName: "Vasto Prime", isPrimeEquipment: true, ingredients: [{ id: "vb", name: "Vasto Barrel", quantity: 1 }] },
    { outputId: "akvasto", outputName: "Akvasto Prime", isPrimeEquipment: true, ingredients: [{ id: "vasto", name: "Vasto Prime", quantity: 2 }] }
  ];
  const entries = [row("vasto", "equipment", 0), row("akvasto", "equipment", 0), row("vb", "component", 3)];
  const plan = planCollection(snapshot(entries), recipes, baseSettings);
  assert.equal(plan.items.find((item) => item.id === "vb")!.reserved, 3);
});

test("Afuris recipe reserves two barrels and two receivers", () => {
  const recipes: Recipe[] = [{ outputId: "afuris", outputName: "Afuris Prime", isPrimeEquipment: true, ingredients: [{ id: "barrel", name: "Barrel", quantity: 2 }, { id: "receiver", name: "Receiver", quantity: 2 }] }];
  const entries = [row("afuris", "equipment", 0), row("barrel", "component", 4), row("receiver", "component", 3)];
  const plan = planCollection(snapshot(entries), recipes, baseSettings);
  assert.equal(plan.items.find((item) => item.id === "barrel")!.reserved, 2);
  assert.equal(plan.items.find((item) => item.id === "receiver")!.reserved, 2);
});

test("catalog equipment absent from inventory still gets a collection reserve", () => {
  const recipes: Recipe[] = [{ outputId: "fulmin", outputName: "Fulmin Prime", isPrimeEquipment: true, ingredients: [{ id: "receiver", name: "Fulmin Receiver", quantity: 1 }] }];
  const plan = planCollection(snapshot([row("receiver", "component", 1)]), recipes, baseSettings);
  const gear = plan.items.find((item) => item.id === "fulmin");
  assert.equal(gear?.quantity, 0);
  assert.equal(plan.items.find((item) => item.id === "receiver")?.reserved, 1);
});

test("pending equipment supplies the collection target without reserving ingredients again", () => {
  const recipes: Recipe[] = [{ outputId: "fulmin", outputName: "Fulmin Prime", isPrimeEquipment: true, ingredients: [{ id: "receiver", name: "Fulmin Receiver", quantity: 1 }] }];
  const pending = [{ itemId: "fulmin", name: "Fulmin Prime", quantity: 1 }];
  const plan = planCollection(snapshot([row("receiver", "component", 1)], pending), recipes, baseSettings);
  assert.equal(plan.items.find((item) => item.id === "receiver")?.reserved, 0);
  assert.equal(plan.recipeAllocations.find((item) => item.itemId === "fulmin")?.quantity, 1);
});

test("reusable blueprint is reserved once when building multiple copies", () => {
  const recipe: Recipe[] = [{ outputId: "weapon", outputName: "Weapon Prime", isPrimeEquipment: true, ingredients: [{ id: "part", name: "Weapon Prime Part", quantity: 1 }, { id: "blueprint", name: "Weapon Prime Blueprint", quantity: 1, reusable: true }] }];
  const entries = [row("weapon", "equipment", 0), row("part", "component", 2), row("blueprint", "component", 1)];
  const settings = { ...baseSettings, targets: { weapon: 2 } };
  const plan = planCollection(snapshot(entries), recipe, settings);
  assert.equal(plan.items.find((item) => item.id === "part")?.reserved, 2);
  assert.equal(plan.items.find((item) => item.id === "blueprint")?.reserved, 1);
});

test("surplus price threshold does not override collection reserve", () => {
  const entries = [row("prime-gun", "equipment", 2)];
  entries[0].platinumAsk = 80;
  const plan = planCollection(snapshot(entries), [], baseSettings);
  const item = plan.items[0];
  assert.equal(item.reserved, 1);
  assert.equal(item.surplus, 1);
  assert.equal(item.recommendation, "Sell for platinum");
});
