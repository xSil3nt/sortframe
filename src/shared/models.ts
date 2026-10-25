import { z } from "zod";

export const InventoryEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["equipment", "component"]),
  category: z.string().min(1),
  quantity: z.number().int().nonnegative(),
  invested: z.number().int().nonnegative().default(0),
  mastered: z.boolean().default(false),
  ducats: z.number().int().nonnegative().optional(),
  platinumAsk: z.number().nonnegative().optional(),
  prime: z.boolean().default(true)
}).refine((item) => item.invested <= item.quantity);

export const SnapshotSchema = z.object({
  revision: z.string().uuid(),
  source: z.enum(["demo", "companion", "import"]),
  capturedAt: z.string().datetime(),
  entries: z.array(InventoryEntrySchema),
  pendingBuilds: z.array(z.object({ itemId: z.string().min(1), name: z.string().min(1), quantity: z.number().int().positive() })).default([])
});

export const RecipeSchema = z.object({
  outputId: z.string().min(1),
  outputName: z.string().min(1),
  isPrimeEquipment: z.boolean().default(false),
  ingredients: z.array(z.object({ id: z.string().min(1), quantity: z.number().int().positive(), name: z.string().min(1), reusable: z.boolean().default(false) }))
});

export const SettingsSchema = z.object({
  mode: z.enum(["collection", "mastery"]).default("collection"),
  platinumThreshold: z.number().int().nonnegative().default(20),
  targets: z.record(z.string(), z.number().int().nonnegative()).default({}),
  excluded: z.array(z.string()).default([]),
  locks: z.record(z.string(), z.number().int().nonnegative()).default({})
});

export const QuoteSchema = z.object({
  itemId: z.string(),
  platform: z.enum(["pc", "ps4", "xbox", "switch", "mobile"]),
  crossplay: z.boolean(),
  lowestAsk: z.number().nonnegative().nullable(),
  highestBid: z.number().nonnegative().nullable(),
  medianFiveAsks: z.number().nonnegative().nullable(),
  observedAt: z.string().datetime(),
  source: z.literal("warframe.market")
});

export const ListingDraftSchema = z.object({
  snapshotRevision: z.string().uuid(),
  itemId: z.string(),
  itemName: z.string(),
  quantity: z.number().int().positive(),
  price: z.number().int().positive(),
  existingOrderId: z.string().optional()
});

export type InventoryEntry = z.infer<typeof InventoryEntrySchema>;
export type Snapshot = z.infer<typeof SnapshotSchema>;
export type Recipe = z.input<typeof RecipeSchema>;
export type Settings = z.infer<typeof SettingsSchema>;
export type Quote = z.infer<typeof QuoteSchema>;
export type ListingDraft = z.infer<typeof ListingDraftSchema>;

export type Recommendation = "Keep" | "Sell for platinum" | "Ducats" | "Check";
export type PlannedItem = InventoryEntry & {
  reserved: number;
  surplus: number;
  pendingQuantity: number;
  recommendation: Recommendation;
  reasons: string[];
};
