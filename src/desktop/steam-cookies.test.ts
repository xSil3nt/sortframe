import test from "node:test";
import assert from "node:assert/strict";
import { hasSteamLogin, selectSteamCookies, steamCookieDetails } from "./steam-cookies.js";

const cookie = { name: "steamLoginSecure", value: "synthetic-session", domain: "steamcommunity.com", path: "/", secure: true, httpOnly: true, hostOnly: true, sameSite: "lax" };

test("remembered cookies are limited to Steam domains and exclude expired sessions", () => {
  const selected = selectSteamCookies([cookie, { ...cookie, domain: "evilsteamcommunity.com" }, { ...cookie, domain: "steamcommunity.com.evil.example" }, { ...cookie, expirationDate: 1 }]);
  assert.equal(selected.length, 1);
  assert.equal(hasSteamLogin(selected), true);
  assert.equal(steamCookieDetails(selected[0]).url, "https://steamcommunity.com/");
  assert.equal(steamCookieDetails(selected[0]).domain, undefined);
  assert.equal(steamCookieDetails(selected[0]).httpOnly, true);
  assert.equal(hasSteamLogin(selectSteamCookies([{ ...cookie, name: "sessionid" }])), false);
});
