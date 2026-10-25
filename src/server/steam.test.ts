import test from "node:test";
import assert from "node:assert/strict";
import { steamLoginPayload } from "./steam.js";

test("Steam companion login payload contains no Warframe password", () => {
  const payload = steamLoginPayload("sample-code", 1700000000000);
  assert.equal(payload.steamCode, "sample-code");
  assert.equal(payload.steamLogin, true);
  assert.equal(payload.time, 1700000000);
  assert.equal(payload.appVersion, "5.3.8.0");
  assert.equal(payload.password, "");
  assert.match(String(payload.date), /^\d{16}$/);
});
