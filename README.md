# Sortframe

Sortframe is a Windows desktop app for planning a Prime collection and sorting surplus into platinum listings, ducats, or review. It never consumes items in Warframe.

## Desktop build

The app uses Electron with a sandboxed React interface. Inventory, recipes, prices, and marketplace sessions run inside the desktop process. It does not open a browser tab, listen on a local HTTP port, or require WebView2, .NET, Node.js, Python, or Git on the user's computer.

Steam sign-in opens an isolated child window on Steam's official website. The current login attempt's callback is checked before its code reaches the companion exchange. The signed-in Steam session is remembered using Windows-protected encryption and restored for later syncs. Steam can require sign-in or confirmation again when the session expires. Settings includes Disconnect Steam to remove it. There is no separate authentication helper.

The sign-in window blocks downloads and renders official HTML auth pages inline. If Warframe reports an active-session conflict, Sortframe asks before retrying with the companion's session override. Cancel is the default. Proceeding can disconnect the game and interrupt a mission.

## Current features

- Inventory table with Keep, Sell for platinum, Ducats, and Check decisions.
- One complete Prime collection by default, with mastery mode, targets, exclusions, and investment locks.
- Duplicate weapon and repeated ingredient planning, including Lex/Aklex, Vasto/Akvasto, and Afuris.
- WFCD recipes and exact warframe.market item mappings, with public PC quotes.
- Companion JSON import/export and a synthetic demo.
- Steam companion inventory sync and session-only marketplace email sign-in.
- Explicit listing review with refreshed quotes, existing orders, collection revision checks, and single-use submission drafts.
- Windows installer and portable ZIP build targets, with a bundled runtime.

Live Steam companion sync and marketplace publishing still require real account validation in the desktop app. Warframe email/password login is not implemented. Do not treat mocked API checks as live account proof.

## Try it from source

Development needs Node.js 24 and npm. Install dependencies, build, then open the desktop app:

```powershell
npm ci
node node_modules/electron/install.js
npm run dev
```

Other commands:

```powershell
npm test
npm run typecheck
npm run build
npm run test:desktop
npm run package:dir
npm run package:win
```

`package:dir` creates an unpacked application in `release/win-unpacked`. `package:win` creates the installer and portable ZIP in `release`. Friends will use those downloads; they do not need the development commands.

## Local data

The database remains in `%LOCALAPPDATA%\Sortframe`, including data created by the earlier browser prototype. Installed application files and account data are separate. Uninstalling preserves data. Passwords are not retained. Remembered Steam session data is encrypted with Windows-protected storage; no plaintext fallback is used when protection is unavailable. The marketplace token lives only in memory until disconnect or exit. The inventory export contains personal inventory data, so review it before sharing.

## Release validation

CI builds and tests the desktop source. The manual Windows workflow builds an installer, a portable ZIP, and SHA-256 checksums. Public release publication remains disabled until a clean Windows account can install, authenticate, sync its own inventory, understand the reserves, and publish a reviewed listing batch without developer assistance.

The desktop smoke check uses synthetic data to verify the renderer boundary, reserve drawer, native export, Steam window creation, cancellation, protected session saving, disconnect, and quitting. It stubs account and metadata network traffic; it does not prove live account access.

Unmapped Foundry builds are preserved as warnings without being credited as future inventory. This can reserve extra parts, while allowing the known inventory to sync. Pending Prime blueprints are mapped separately from the rule for reusable recipe ingredients; Prime blueprints remain consumable.

## Future overlay

A game overlay is future work. The first candidate is a separate transparent desktop window with a hotkey and optional click-through behavior. It would show data from the last explicitly synced snapshot. Game process injection, memory reading, automatic trading, and automatic in-game item consumption are outside this design. Fullscreen compatibility, display scaling, focus behavior, and Digital Extremes' current guidance need checking before committing to an overlay implementation.

## Credits and license

Prime metadata comes from [WFCD/warframe-items](https://github.com/WFCD/warframe-items). Marketplace data comes from [warframe.market](https://warframe.market). Sortframe is an independent community project, unaffiliated with Digital Extremes, Warframe, Steam, or warframe.market.

Source is MIT licensed. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
