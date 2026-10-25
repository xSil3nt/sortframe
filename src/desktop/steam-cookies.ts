import { z } from "zod";
import type { CookiesSetDetails } from "electron";

const CookieSchema = z.object({
  name: z.string().min(1).max(1024), value: z.string().max(16384), domain: z.string().max(255),
  path: z.string().startsWith("/").max(2048), secure: z.boolean(), httpOnly: z.boolean(),
  hostOnly: z.boolean().optional(), expirationDate: z.number().finite().optional(),
  sameSite: z.enum(["unspecified", "no_restriction", "lax", "strict"]).optional()
});
export type StoredSteamCookie = z.infer<typeof CookieSchema>;

export function selectSteamCookies(value: unknown): StoredSteamCookie[] {
  const parsed = z.array(CookieSchema).max(200).safeParse(value);
  if (!parsed.success) return [];
  return parsed.data.filter((cookie) => /(^|\.)(steamcommunity|steampowered)\.com$/i.test(cookie.domain) && (cookie.expirationDate === undefined || cookie.expirationDate > Date.now() / 1000));
}

export function hasSteamLogin(cookies: StoredSteamCookie[]) {
  return cookies.some((cookie) => cookie.name === "steamLoginSecure" && cookie.value.length > 0);
}

export function steamCookieDetails(cookie: StoredSteamCookie): CookiesSetDetails {
  return { url: `https://${cookie.domain.replace(/^\./, "")}${cookie.path}`, name: cookie.name, value: cookie.value, path: cookie.path, secure: cookie.secure, httpOnly: cookie.httpOnly, ...(cookie.hostOnly ? {} : { domain: cookie.domain }), ...(cookie.expirationDate === undefined ? {} : { expirationDate: cookie.expirationDate }), ...(cookie.sameSite === undefined ? {} : { sameSite: cookie.sameSite }) };
}
