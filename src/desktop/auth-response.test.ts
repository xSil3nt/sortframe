import test from "node:test";
import assert from "node:assert/strict";
import { inlineAuthHeaders } from "./auth-response.js";

test("official HTML auth pages are rendered instead of downloaded as auth.html", () => {
  const headers = { "Content-Type": ["text/html; charset=utf-8"], "Content-Disposition": ['attachment; filename="auth.html"'] };
  assert.deepEqual(inlineAuthHeaders("https://steamcommunity.com/oauth/login", "mainFrame", headers), { "Content-Type": ["text/html; charset=utf-8"] });
  assert.deepEqual(inlineAuthHeaders("https://steamcommunity.com/oauth/login", "mainFrame", { ...headers, "Content-Type": ["application/octet-stream"] }), { "Content-Type": ["text/html; charset=utf-8"] });
  assert.equal(headers["Content-Disposition"].length, 1);
});

test("auth response handling does not rewrite binaries, subresources, or unrelated sites", () => {
  const html = { "content-type": ["text/html"], "content-disposition": ["attachment"] };
  const binary = { "content-type": ["application/octet-stream"], "content-disposition": ["attachment"] };
  assert.deepEqual(inlineAuthHeaders("https://evil.example/auth.html", "mainFrame", html), html);
  assert.deepEqual(inlineAuthHeaders("https://steamcommunity.com/auth.html", "script", html), html);
  assert.deepEqual(inlineAuthHeaders("https://steamcommunity.com/file", "mainFrame", binary), binary);
});
