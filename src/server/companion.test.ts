import test from "node:test";
import assert from "node:assert/strict";
import { parseCompanionInventory } from "./companion.js";
import type { CraftData } from "./catalog.js";

const catalog: CraftData = {
  source: "live", loadedAt: new Date().toISOString(),
  items: [
    { id: "weapon", name: "Test Prime", kind: "equipment", category: "Primary", quantity: 0, invested: 0, mastered: false, prime: true },
    { id: "part", name: "Test Prime Barrel", kind: "component", category: "Prime Part", quantity: 0, invested: 0, mastered: false, ducats: 15, prime: true },
    { id: "bp", name: "Test Prime Blueprint", kind: "component", category: "Prime Part", quantity: 0, invested: 0, mastered: false, ducats: 15, prime: true }
  ],
  recipes: [{ outputId: "weapon", outputName: "Test Prime", isPrimeEquipment: true, ingredients: [{ id: "part", name: "Test Prime Barrel", quantity: 1 }, { id: "bp", name: "Test Prime Blueprint", quantity: 1, reusable: true }] }]
};

test("companion equipment, part stacks, mastery, investment, and pending build are normalized", () => {
  const result = parseCompanionInventory({
    Pistols: [{ ItemType: "weapon", ItemId: "instance", XP: 180000, Polarized: 2 }],
    XPInfo: [{ ItemType: "weapon", XP: 180000 }],
    Recipes: [{ ItemType: "part", ItemCount: 3 }, { ItemType: "bp", ItemCount: 1 }],
    PendingRecipes: [{ ItemType: "weapon", ItemCount: 1 }]
  }, catalog);
  assert.equal(result.source, "import");
  assert.deepEqual(result.entries.map((entry) => [entry.id, entry.quantity, entry.invested, entry.mastered]), [["part", 3, 0, false], ["bp", 1, 0, false], ["weapon", 1, 1, true]]);
  assert.deepEqual(result.pendingBuilds, [{ itemId: "weapon", name: "Test Prime", quantity: 1 }]);
});

test("unmapped Prime parts are retained for review", () => {
  const result = parseCompanionInventory({ MiscItems: [{ ItemType: "/Lotus/Types/Items/PrimeUnlistedPart", ItemCount: 2 }] }, catalog);
  assert.equal(result.entries[0].quantity, 2);
  assert.equal(result.entries[0].category, "Unmapped Prime data");
});

test("unresolved pending recipes fail closed", () => {
  assert.throws(() => parseCompanionInventory({ PendingRecipes: [{ ItemType: "/Lotus/Types/Recipes/UnknownPrimeBlueprint" }] }, catalog), /pending Foundry item could not be identified/i);
});
