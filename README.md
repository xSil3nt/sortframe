# Sortframe

Sortframe plans which Prime parts to keep for crafting, which surplus parts may be worth selling, and which can go to Baro for Ducats. Inventory decisions are suggestions. Sortframe never consumes items in game.

The project is early development. The reserve planner and synthetic demo work locally. Companion login and sync, live Warframe recipes, marketplace prices, account sign-in, and order publishing are not connected yet. No installer or portable release is published until those account flows and a fresh-user install have been validated.

## Current build

- React interface with Inventory, Listings, and Settings pages.
- Complete collection and mastery-only planning modes.
- Investment and user locks count toward collection targets.
- Dual-wield duplicate weapons and repeated recipe ingredients are aggregated.
- Public warframe.market v2 item matching and PC order-book quotes, with local cache and request pacing.
- Per-user SQLite database in the Windows local application data directory.
- Synthetic demo inventory, validated JSON import/export, and protected snapshots.
- Loopback-only local server with origin checks on write requests.
- Windows launcher and release packaging workflow source.

The current demo shows the Lex/Aklex, Vasto/Akvasto, and Afuris duplicate-part examples. It is synthetic and does not contain a real inventory snapshot. Market quotes apply to imported normalized snapshots whose item IDs are exact in-game reference paths.

## Development

Requirements: Node.js 24 and npm.

```powershell
npm ci
npm run dev
```

Open the local Vite address printed by the development server. The frontend proxies API calls to the local Fastify service. Run the checks with:

```powershell
npm run typecheck
npm test
npm run build
```

## Data and privacy

The local server binds to `127.0.0.1`. The production launcher stores the database in `%LOCALAPPDATA%\Sortframe`; portable builds use the same per-user location. App files and user data are kept separately. The JSON export contains the current snapshot, so review it before sharing.

Sortframe does not currently ask for account credentials. Do not enter passwords into the demo build. Account adapters will be added only after the official login steps and local token handling are validated.

## Distribution

The Windows x64 release workflow is configured to package a bundled Node runtime, a self-contained launcher, an installer, and a portable ZIP. A release is not considered ready until a clean Windows account can install or extract it, connect its own accounts, sync inventory, inspect the reserve explanations, and publish a reviewed order batch.

## Third-party data

Planned item metadata uses [WFCD/warframe-items](https://github.com/WFCD/warframe-items), which is distributed under the MIT license. The current demo data is hand-authored synthetic data. Sortframe is an independent community project and is not affiliated with Digital Extremes, Warframe, Steam, or warframe.market.

## License

Sortframe source is released under the MIT license. See [LICENSE](LICENSE).
