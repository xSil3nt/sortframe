import { randomUUID } from "node:crypto";
import type { Recipe, Snapshot, Settings } from "../shared/models.js";

export const demoRecipes: Recipe[] = [
  { outputId: "aklex-prime", outputName: "Aklex Prime", isPrimeEquipment: true, ingredients: [{ id: "lex-prime", name: "Lex Prime", quantity: 2 }, { id: "aklex-blueprint", name: "Aklex Prime Blueprint", quantity: 1 }] },
  { outputId: "lex-prime", outputName: "Lex Prime", isPrimeEquipment: true, ingredients: [{ id: "lex-barrel", name: "Lex Prime Barrel", quantity: 1 }, { id: "lex-receiver", name: "Lex Prime Receiver", quantity: 1 }, { id: "lex-blueprint", name: "Lex Prime Blueprint", quantity: 1 }] },
  { outputId: "akvasto-prime", outputName: "Akvasto Prime", isPrimeEquipment: true, ingredients: [{ id: "vasto-prime", name: "Vasto Prime", quantity: 2 }, { id: "akvasto-blueprint", name: "Akvasto Prime Blueprint", quantity: 1 }] },
  { outputId: "vasto-prime", outputName: "Vasto Prime", isPrimeEquipment: true, ingredients: [{ id: "vasto-barrel", name: "Vasto Prime Barrel", quantity: 1 }, { id: "vasto-receiver", name: "Vasto Prime Receiver", quantity: 1 }, { id: "vasto-blueprint", name: "Vasto Prime Blueprint", quantity: 1 }] },
  { outputId: "afuris-prime", outputName: "Afuris Prime", isPrimeEquipment: true, ingredients: [{ id: "afuris-barrel", name: "Afuris Prime Barrel", quantity: 2 }, { id: "afuris-receiver", name: "Afuris Prime Receiver", quantity: 2 }, { id: "afuris-blueprint", name: "Afuris Prime Blueprint", quantity: 1 }] }
];

export function demoSnapshot(): Snapshot {
  const now = new Date().toISOString();
  return {
    revision: randomUUID(), source: "demo", capturedAt: now, pendingBuilds: [],
    entries: [
      { id: "lex-prime", name: "Lex Prime", kind: "equipment", category: "Secondary", quantity: 3, invested: 1, mastered: true, ducats: 45, platinumAsk: 12, prime: true },
      { id: "aklex-prime", name: "Aklex Prime", kind: "equipment", category: "Secondary", quantity: 0, invested: 0, mastered: false, ducats: 45, prime: true },
      { id: "lex-barrel", name: "Lex Prime Barrel", kind: "component", category: "Prime Part", quantity: 3, invested: 0, mastered: false, ducats: 15, prime: true },
      { id: "lex-receiver", name: "Lex Prime Receiver", kind: "component", category: "Prime Part", quantity: 2, invested: 0, mastered: false, ducats: 15, prime: true },
      { id: "lex-blueprint", name: "Lex Prime Blueprint", kind: "component", category: "Prime Part", quantity: 1, invested: 0, mastered: false, ducats: 15, platinumAsk: 8, prime: true },
      { id: "vasto-prime", name: "Vasto Prime", kind: "equipment", category: "Secondary", quantity: 0, invested: 0, mastered: false, ducats: 45, platinumAsk: 21, prime: true },
      { id: "akvasto-prime", name: "Akvasto Prime", kind: "equipment", category: "Secondary", quantity: 0, invested: 0, mastered: false, ducats: 45, platinumAsk: 28, prime: true },
      { id: "vasto-barrel", name: "Vasto Prime Barrel", kind: "component", category: "Prime Part", quantity: 4, invested: 0, mastered: false, ducats: 15, prime: true },
      { id: "vasto-receiver", name: "Vasto Prime Receiver", kind: "component", category: "Prime Part", quantity: 3, invested: 0, mastered: false, ducats: 15, prime: true },
      { id: "vasto-blueprint", name: "Vasto Prime Blueprint", kind: "component", category: "Prime Part", quantity: 3, invested: 0, mastered: false, ducats: 15, platinumAsk: 7, prime: true },
      { id: "afuris-prime", name: "Afuris Prime", kind: "equipment", category: "Secondary", quantity: 0, invested: 0, mastered: false, ducats: 45, platinumAsk: 34, prime: true },
      { id: "afuris-barrel", name: "Afuris Prime Barrel", kind: "component", category: "Prime Part", quantity: 4, invested: 0, mastered: false, ducats: 15, prime: true },
      { id: "afuris-receiver", name: "Afuris Prime Receiver", kind: "component", category: "Prime Part", quantity: 3, invested: 0, mastered: false, ducats: 15, prime: true },
      { id: "afuris-blueprint", name: "Afuris Prime Blueprint", kind: "component", category: "Prime Part", quantity: 2, invested: 0, mastered: false, ducats: 15, platinumAsk: 10, prime: true },
      { id: "vauban-neuroptics", name: "Vauban Prime Neuroptics Blueprint", kind: "component", category: "Prime Part", quantity: 2, invested: 0, mastered: false, ducats: 15, platinumAsk: 30, prime: true },
      { id: "nautilus-cerebrum", name: "Nautilus Prime Cerebrum", kind: "component", category: "Prime Part", quantity: 1, invested: 0, mastered: false, ducats: 15, platinumAsk: 22, prime: true }
    ]
  };
}

export const defaultSettings: Settings = { mode: "collection", platinumThreshold: 20, targets: {}, excluded: [], locks: {} };
