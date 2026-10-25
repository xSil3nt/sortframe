export function parseSteamCallback(url: string, state: string): { kind: "other" } | { kind: "invalid" } | { kind: "complete"; code: string } {
  let target: URL;
  try { target = new URL(url); } catch { return { kind: "other" }; }
  if (target.origin !== "https://mobile.warframe.com" || target.pathname !== "/api/mobileSteamAuth.php") return { kind: "other" };
  const code = target.searchParams.get("code");
  if (target.searchParams.getAll("code").length !== 1 || target.searchParams.getAll("state").length !== 1 || target.searchParams.get("state") !== state || !code || code.length > 512 || !/^[A-Za-z0-9._~-]+$/.test(code)) return { kind: "invalid" };
  return { kind: "complete", code };
}

export function isAbortedNavigation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const failure = error as { code?: unknown; errno?: unknown; message?: unknown };
  return failure.code === "ERR_ABORTED" || failure.errno === -3 || typeof failure.message === "string" && /\bERR_ABORTED\b/.test(failure.message);
}
