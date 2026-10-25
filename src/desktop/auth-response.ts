export function inlineAuthHeaders(url: string, resourceType: string, headers: Record<string, string[]> | undefined) {
  const result = { ...headers };
  let target: URL;
  try { target = new URL(url); } catch { return result; }
  if (target.protocol !== "https:" || !["steamcommunity.com", "store.steampowered.com", "login.steampowered.com", "help.steampowered.com", "mobile.warframe.com"].includes(target.hostname) || resourceType !== "mainFrame") return result;
  const contentType = Object.entries(result).find(([name]) => name.toLowerCase() === "content-type")?.[1].join(";") ?? "";
  const disposition = Object.entries(result).find(([name]) => name.toLowerCase() === "content-disposition")?.[1].join(";") ?? "";
  const namedAuthPage = target.hostname === "steamcommunity.com" && target.pathname.startsWith("/oauth/") && /filename\s*=\s*["']?auth\.html\b/i.test(disposition);
  if (!/text\/html|application\/xhtml\+xml/i.test(contentType) && !namedAuthPage) return result;
  if (namedAuthPage) {
    for (const name of Object.keys(result)) if (name.toLowerCase() === "content-type") delete result[name];
    result["Content-Type"] = ["text/html; charset=utf-8"];
  }
  for (const name of Object.keys(result)) if (name.toLowerCase() === "content-disposition") delete result[name];
  return result;
}
