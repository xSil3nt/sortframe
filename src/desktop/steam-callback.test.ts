import test from "node:test";
import assert from "node:assert/strict";
import { parseSteamCallback } from "./steam-callback.js";

test("Steam callback belongs to the current login attempt and exact official endpoint", () => {
  assert.deepEqual(parseSteamCallback("https://mobile.warframe.com/api/mobileSteamAuth.php?code=example-code&state=attempt-a", "attempt-a"), { kind: "complete", code: "example-code" });
  assert.deepEqual(parseSteamCallback("https://mobile.warframe.com/api/mobileSteamAuth.php?code=example-code&state=attempt-b", "attempt-a"), { kind: "invalid" });
  assert.deepEqual(parseSteamCallback("https://mobile.warframe.com.evil.example/api/mobileSteamAuth.php?code=example-code&state=attempt-a", "attempt-a"), { kind: "other" });
  assert.deepEqual(parseSteamCallback("http://mobile.warframe.com/api/mobileSteamAuth.php?code=example-code&state=attempt-a", "attempt-a"), { kind: "other" });
});

test("Steam callback rejects missing, duplicated, or malformed login values", () => {
  assert.deepEqual(parseSteamCallback("https://mobile.warframe.com/api/mobileSteamAuth.php?state=attempt-a", "attempt-a"), { kind: "invalid" });
  assert.deepEqual(parseSteamCallback("https://mobile.warframe.com/api/mobileSteamAuth.php?code=%3Cscript%3E&state=attempt-a", "attempt-a"), { kind: "invalid" });
  assert.deepEqual(parseSteamCallback("https://mobile.warframe.com/api/mobileSteamAuth.php?code=first&code=second&state=attempt-a", "attempt-a"), { kind: "invalid" });
});
