# Sortframe

Sortframe plans which Prime parts to keep for crafting, which surplus parts may be worth selling, and which can go to Baro for Ducats. Inventory decisions are suggestions. Sortframe never consumes items in game.

The project is early development. The reserve planner, live Prime catalog, public prices, and synthetic demo work locally. A Windows Steam sign-in window and companion sync path are implemented, but they have not been validated against a live Warframe account. Warframe email login is not implemented. Marketplace email sign-in, order review, and order create/edit routes are implemented against the documented API, but have not been validated with a live account. No installer or portable release is published until the live account flows and a fresh-user install have been validated.

## Current build

- React interface with Inventory, Listings, and Settings pages.
- Complete collection and mastery-only planning modes.
- Investment and user locks count toward collection targets.
- Dual-wield duplicate weapons and repeated recipe ingredients are aggregated.
- Live Prime equipment recipes from WFCD and Prime part identifiers from the public warframe.market v2 catalog.
- PC-only warframe.market order-book quotes with 24-hour metadata and five-minute quote caches, using a two-request-per-second queue.
- Session-only warframe.market email sign-in through the local backend. The JWT stays in process memory and is not sent to the browser or written to disk.
- Listing review for selected platinum surplus, with refreshed quotes, existing-order reconciliation, collection revision checks, single-use review drafts, and explicit create/edit choices.
- Import of a companion inventory JSON response, including mastery, invested copies, and recognized pending builds.
- Packaged Windows Steam sign-in through a WebView2 window and companion inventory sync, with no game disconnect request and no persisted companion session. This flow still needs live account validation.
- Per-user SQLite database in the Windows local application data directory.
- Synthetic demo inventory, validated JSON import/export, and protected snapshots.
- Loopback-only local server with origin checks on write requests.
- Windows launcher and release packaging workflow source.

The current demo shows the Lex/Aklex, Vasto/Akvasto, and Afuris duplicate-part examples. It is synthetic and does not contain a real inventory snapshot. Live crafting metadata is fetched from WFCD and warframe.market when a real inventory is imported. If these sources are unavailable, all imported inventory is held for review.

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

The current Windows Steam flow does not ask for a Warframe password. It opens Steam's sign-in page in a temporary WebView2 profile, hands the returned code to the local service over a per-attempt named pipe, and discards the profile afterward. The companion request and inventory parsing still need live account validation. Warframe email login is not implemented.

warframe.market email and password are sent over HTTPS from the local backend for sign-in and then cleared. The resulting session token is held only in memory and is cleared when disconnected or Sortframe exits. Publishing requires an account that warframe.market marks verified. Sortframe does not automatically reprice, hide, or delete orders. These authenticated flows still need live account validation; no real account credentials are included in this repository.

## Distribution

The Windows x64 workflow packages a bundled Node runtime, a self-contained launcher, an installer, and a portable ZIP. Release publication requires a deliberate manual run on a `v*` tag with the publish input enabled. Keep that input off until Steam companion sync, marketplace sign-in and reviewed publishing pass against live accounts, and a clean Windows account can install or extract the app, connect its own accounts, sync inventory, inspect reserve explanations, and publish a reviewed order batch.

## Third-party data

Prime item and recipe metadata comes from [WFCD/warframe-items](https://github.com/WFCD/warframe-items), distributed under the MIT license, and is cached locally. Public market prices come from the warframe.market API. The current demo inventory is synthetic. Sortframe is an independent community project and is not affiliated with Digital Extremes, Warframe, Steam, or warframe.market.

## License

Sortframe source is released under the MIT license. See [LICENSE](LICENSE).
