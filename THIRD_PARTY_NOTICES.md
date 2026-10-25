# Third-party notices

## WFCD/warframe-items

The app fetches canonical Warframe item names, identifiers, and crafting metadata from [WFCD/warframe-items](https://github.com/WFCD/warframe-items). That project declares the MIT license. Its license notice must accompany any redistributed catalog data.

No WFCD catalog files are bundled in the current demo build.

## warframe.market

The app reads public item metadata and orders from the warframe.market API. API terms and current integration documentation are at [docs.warframe.market](https://docs.warframe.market/docs/intro/). The app does not currently sign in or create orders.

## Runtime and packages

The release workflow bundles the Node.js runtime and the npm production dependencies listed in `package-lock.json`. Their individual license texts are available in the installed package metadata and the Node.js distribution. A generated, complete dependency license bundle is required before a public binary release.
