import test from "node:test";
import assert from "node:assert/strict";
import { isAbortedNavigation, parseSteamCallback } from "./steam-callback.js";

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

test("redirect aborts do not report a failed Steam connection", () => {
  assert.equal(isAbortedNavigation({ code: "ERR_ABORTED" }), true);
  assert.equal(isAbortedNavigation({ errno: -3 }), true);
  assert.equal(isAbortedNavigation(new Error("ERR_ABORTED (-3) loading the initial page")), true);
  assert.equal(isAbortedNavigation({ code: "ERR_NAME_NOT_RESOLVED", errno: -105 }), false);
  assert.equal(isAbortedNavigation(new Error("ERR_CONNECTION_TIMED_OUT")), false);
});
