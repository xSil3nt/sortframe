import test from "node:test";
import assert from "node:assert/strict";
import { summarizeOrders } from "./market.js";

const now = Date.now();
const order = (type: string, platinum: number, status = "ingame", quantity = 1, age = 0) => ({ type, platinum, quantity, visible: true, user: { status, lastSeen: new Date(now - age).toISOString() } });

test("quote summary uses the lowest current seller ask and highest buyer offer", () => {
  const quote = summarizeOrders([order("sell", 15), order("sell", 10), order("buy", 7), order("buy", 9)], now);
  assert.deepEqual(quote, { lowestAsk: 10, highestBid: 9, medianFiveAsks: 15 });
});

test("quote summary uses median of five lowest asks and excludes offline or empty orders", () => {
  const quote = summarizeOrders([order("sell", 6), order("sell", 5), order("sell", 4), order("sell", 3), order("sell", 2), order("sell", 1), order("buy", 20, "offline"), order("sell", 2, "ingame", 0)], now);
  assert.deepEqual(quote, { lowestAsk: 1, highestBid: null, medianFiveAsks: 3 });
});

test("stale marketplace status is not quoted", () => {
  const quote = summarizeOrders([order("sell", 6, "online", 1, 25 * 60 * 60 * 1000)], now);
  assert.deepEqual(quote, { lowestAsk: null, highestBid: null, medianFiveAsks: null });
});

test("own orders do not affect price comparisons", () => {
  const orders = [
    { ...order("sell", 1), user: { id: "self", status: "ingame" } },
    { ...order("sell", 9), user: { id: "other", status: "ingame" } },
    { ...order("buy", 30), user: { id: "self", status: "ingame" } }
  ];
  assert.deepEqual(summarizeOrders(orders, now, "self"), { lowestAsk: 9, highestBid: null, medianFiveAsks: 9 });
});
