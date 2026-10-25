import { app, BrowserWindow, dialog, Menu, protocol, safeStorage, session } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { isAbortedNavigation, parseSteamCallback } from "./steam-callback.js";
import { createProtectedStore } from "./protected-store.js";
import { hasSteamLogin, selectSteamCookies, steamCookieDetails, type StoredSteamCookie } from "./steam-cookies.js";
import { inlineAuthHeaders } from "./auth-response.js";

const here = dirname(fileURLToPath(import.meta.url));
const appOrigin = "sortframe://app";
const mimeTypes: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
let mainWindow: BrowserWindow | null = null;
let authWindow: BrowserWindow | null = null;
let closeBackend: (() => Promise<void>) | undefined;
let shuttingDown = false;
let steamVault: ReturnType<typeof createProtectedStore>;
let steamCookies: StoredSteamCookie[] = [];
let steamRemembered = false;
let steamProtectionAvailable = false;
let steamAuthEpoch = 0;
let steamAuthInProgress = false;
if (process.env.SORTFRAME_PROFILE_DIR) app.setPath("userData", resolve(process.env.SORTFRAME_PROFILE_DIR));

protocol.registerSchemesAsPrivileged([{ scheme: "sortframe", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

async function authenticateSteam(): Promise<string> {
  if (steamAuthInProgress) {
    authWindow?.focus();
    throw new Error("Steam sign in is already open. Finish or close that window first.");
  }
  steamAuthInProgress = true;
  try {
  const state = randomUUID();
  const epoch = steamAuthEpoch;
  const authSession = session.fromPartition(`sortframe-steam-${state}`);
  authSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  authSession.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: inlineAuthHeaders(details.url, details.resourceType, details.responseHeaders) }));
  await Promise.allSettled(steamCookies.map((cookie) => authSession.cookies.set(steamCookieDetails(cookie))));
  return await new Promise<string>((resolveCode, reject) => {
    const window = new BrowserWindow({ title: "Steam — steamcommunity.com", width: 560, height: 760, minWidth: 460, minHeight: 600, parent: mainWindow ?? undefined, autoHideMenuBar: true, show: !hasSteamLogin(steamCookies), backgroundColor: "#171d19", webPreferences: { session: authSession, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
    authWindow = window;
    let settled = false;
    const timer = setTimeout(() => finish(undefined, "Steam sign in timed out. Try again."), 180000);
    const finish = (code?: string, message = "Steam sign in was cancelled.") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void (async () => {
        if (code && epoch === steamAuthEpoch) {
          try {
            const cookies = selectSteamCookies(await authSession.cookies.get({}));
            if (hasSteamLogin(cookies)) {
              const saved = await steamVault.save(cookies);
              if (epoch === steamAuthEpoch) { steamCookies = cookies; steamRemembered = saved; }
              else await steamVault.clear();
            }
          } catch { steamRemembered = false; }
        }
        if (epoch !== steamAuthEpoch) reject(new Error("Steam sign in was disconnected."));
        else if (code) resolveCode(code);
        else reject(new Error(message));
        if (!window.isDestroyed()) window.destroy();
        await authSession.clearStorageData().catch(() => undefined);
        await authSession.clearCache().catch(() => undefined);
      })();
    };
    const navigate = (event: { preventDefault: () => void }, url: string) => {
      let target: URL;
      try { target = new URL(url); } catch { event.preventDefault(); return; }
      const callback = parseSteamCallback(url, state);
      if (callback.kind !== "other") {
        event.preventDefault();
        if (callback.kind === "invalid") {
          finish(undefined, "Steam returned an invalid or expired login callback. Try again.");
        } else finish(callback.code);
        return;
      }
      const allowed = target.protocol === "https:" && ["steamcommunity.com", "store.steampowered.com", "login.steampowered.com", "help.steampowered.com", "mobile.warframe.com"].includes(target.hostname);
      if (!allowed) event.preventDefault();
    };
    authSession.on("will-download", (event, item) => {
      let urls: string[] = [];
      try { urls = [...item.getURLChain(), item.getURL()]; } catch { }
      event.preventDefault();
      for (const url of urls) {
        const callback = parseSteamCallback(url, state);
        if (callback.kind === "complete") { finish(callback.code); return; }
      }
      finish(undefined, "Steam returned an unexpected authentication download. No file was saved. Retry signing in.");
    });
    window.webContents.on("will-navigate", navigate);
    window.webContents.on("will-redirect", navigate);
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("page-title-updated", (event) => event.preventDefault());
    window.webContents.on("did-navigate", (_event, url) => { window.setTitle(`Sign in — ${new URL(url).hostname}`); });
    window.on("closed", () => {
      if (authWindow === window) authWindow = null;
      finish();
    });
    window.webContents.on("did-finish-load", () => {
      setTimeout(() => { if (!settled && !window.isDestroyed()) window.show(); }, 600);
    });
    window.webContents.on("did-fail-load", (_event, code, _description, _url, isMainFrame) => {
      if (isMainFrame && code !== -3) finish(undefined, `Steam's sign-in page could not load (network error ${code}). Check your connection and retry.`);
    });
    const url = new URL("https://steamcommunity.com/oauth/login");
    url.search = new URLSearchParams({ client_id: "A1182243", redirect_uri: "https://mobile.warframe.com/api/mobileSteamAuth.php", response_type: "code", mobileminimal: "1", state }).toString();
    void window.loadURL(url.href).catch((error: unknown) => {
      if (isAbortedNavigation(error)) return;
      const message = error instanceof Error ? error.message : "";
      const networkCode = message.match(/\bERR_[A-Z_]+\b/)?.[0];
      finish(undefined, `Steam's sign-in page could not open${networkCode ? ` (${networkCode})` : ""}. Check your connection and retry.`);
    });
  });
  } finally { steamAuthInProgress = false; }
}

async function startDesktop() {
  const dataRoot = process.env.SORTFRAME_DATA_DIR ?? join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "Sortframe");
  steamProtectionAvailable = process.platform === "win32" && await safeStorage.isAsyncEncryptionAvailable().catch(() => false);
  steamVault = createProtectedStore(join(dataRoot, "steam-session.enc"), {
    available: async () => steamProtectionAvailable,
    encrypt: (plain) => safeStorage.encryptStringAsync(plain),
    decrypt: async (bytes) => (await safeStorage.decryptStringAsync(bytes)).result
  });
  steamCookies = selectSteamCookies(await steamVault.load());
  steamRemembered = hasSteamLogin(steamCookies);
  const backend = await import("../server/index.js");
  closeBackend = backend.closeBackend;
  backend.setSteamAuthenticator(authenticateSteam);
  backend.setSessionConflictConfirmation(async () => {
    if (!mainWindow || mainWindow.isDestroyed() || shuttingDown) return false;
    const result = await dialog.showMessageBox(mainWindow, {
      type: "warning", title: "Warframe session already active", message: "Disconnect the active Warframe session and sync?",
      detail: "Proceeding can sign you out of the game and interrupt your current mission. Cancel to keep playing, or close Warframe normally before syncing.",
      buttons: ["Cancel", "Disconnect game and sync"], defaultId: 0, cancelId: 0, noLink: true
    });
    return result.response === 1;
  });
  await backend.app.ready();
  const webRoot = resolve(here, "../web");
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  protocol.handle("sortframe", async (request) => {
    const target = new URL(request.url);
    const initiatorOrigin = (request as Request & { initiatorOrigin?: string }).initiatorOrigin;
    if (target.protocol !== "sortframe:" || target.hostname !== "app" || target.port || (initiatorOrigin && initiatorOrigin !== appOrigin)) return new Response("Forbidden", { status: 403 });
    if (target.pathname === "/api/desktop/info" && request.method === "GET") return Response.json({ version: app.getVersion() });
    if (target.pathname === "/api/warframe/connection" && request.method === "GET") return Response.json({ remembered: steamRemembered, canRemember: steamProtectionAvailable });
    if (target.pathname === "/api/warframe/disconnect" && request.method === "POST") {
      steamAuthEpoch++;
      steamCookies = [];
      steamRemembered = false;
      authWindow?.destroy();
      await steamVault.clear();
      return Response.json({ remembered: false, canRemember: steamProtectionAvailable });
    }
    if (target.pathname === "/api/desktop/export" && request.method === "POST") {
      const destination = await dialog.showSaveDialog(mainWindow!, { title: "Export inventory", defaultPath: join(app.getPath("documents"), "sortframe-snapshot.json"), filters: [{ name: "Inventory JSON", extensions: ["json"] }] });
      if (destination.canceled || !destination.filePath) return Response.json({ saved: false });
      try {
        const snapshot = await backend.app.inject({ method: "GET", url: "/api/export", headers: { host: "localhost" } });
        if (snapshot.statusCode !== 200) throw new Error("Snapshot unavailable");
        await writeFile(destination.filePath, snapshot.body, "utf8");
        return Response.json({ saved: true });
      } catch { return Response.json({ error: "The inventory export could not be saved. Choose another folder and retry." }, { status: 500 }); }
    }
    if (target.pathname.startsWith("/api/")) {
      const method = request.method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) return new Response("Method not allowed", { status: 405 });
      const payload = method === "GET" ? undefined : await request.text();
      if (payload && Buffer.byteLength(payload) > 12 * 1024 * 1024) return new Response("Request too large", { status: 413 });
      const response = await backend.app.inject({ method, url: target.pathname + target.search, headers: { host: "localhost", "content-type": "application/json" }, ...(payload ? { payload } : {}) });
      if (target.pathname === "/api/quit" && method === "POST") setTimeout(() => app.quit(), 100);
      return new Response(response.body, { status: response.statusCode, headers: { "content-type": String(response.headers["content-type"] ?? "application/json"), ...(response.headers["content-disposition"] ? { "content-disposition": String(response.headers["content-disposition"]) } : {}) } });
    }
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
    const file = resolve(webRoot, "." + decodeURIComponent(target.pathname === "/" ? "/index.html" : target.pathname));
    if (relative(webRoot, file).startsWith("..") || !mimeTypes[extname(file)]) return new Response("Not found", { status: 404 });
    try {
      const body = await readFile(file);
      return new Response(new Uint8Array(body), { headers: { "content-type": mimeTypes[extname(file)], "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" } });
    } catch { return new Response("Not found", { status: 404 }); }
  });
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({ title: `Sortframe ${app.getVersion()}`, icon: join(webRoot, "sortframe.png"), width: 1400, height: 900, minWidth: 900, minHeight: 620, backgroundColor: "#101412", titleBarStyle: "hidden", titleBarOverlay: { color: "#141a16", symbolColor: "#b8c0b9", height: 36 }, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => { if (!url.startsWith(appOrigin + "/")) event.preventDefault(); });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => { mainWindow = null; authWindow?.destroy(); });
  await mainWindow.loadURL(appOrigin + "/");
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => { if (mainWindow?.isMinimized()) mainWindow.restore(); mainWindow?.show(); mainWindow?.focus(); });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (shuttingDown) return;
    event.preventDefault();
    shuttingDown = true;
    authWindow?.destroy();
    const deadline = setTimeout(() => app.exit(0), 3000);
    deadline.unref();
    void (closeBackend?.() ?? Promise.resolve()).finally(() => { clearTimeout(deadline); app.quit(); });
  });
  app.whenReady().then(startDesktop).catch((error) => { dialog.showErrorBox("Sortframe could not start", `The desktop workspace could not open: ${error instanceof Error ? error.message : "Unknown startup error"}`); app.quit(); });
}
