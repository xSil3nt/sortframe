import { build } from "esbuild";

await build({ entryPoints: ["src/server/index.ts"], bundle: true, platform: "node", format: "esm", packages: "external", outdir: "dist/server" });
await build({ entryPoints: ["src/desktop/main.ts"], bundle: true, platform: "node", format: "esm", packages: "external", external: ["../server/index.js"], outdir: "dist/desktop" });
