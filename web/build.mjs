/**
 * Builds the web app into ../docs/app/, which GitHub Pages serves.
 *
 * The point of this file: the website does not keep its own copy of the
 * flavour catalogue, the can artwork, the map style, the filter rules or
 * the stock heuristic. It imports the mobile app's own modules (src/shared.ts)
 * and bundles them, so the two can never disagree about what a can looks
 * like or which shelves count as "sold in 36 h".
 *
 * That works because those modules are plain TypeScript. The ones that draw
 * (Can, Crown, icons) use React Native's SVG components, which are aliased
 * here to string builders in src/shim — see that folder for why.
 */
import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const outdir = path.join(here, "..", "docs", "app");

const options = {
  entryPoints: [path.join(here, "src", "main.js")],
  bundle: true,
  format: "esm",
  target: "es2020",
  outfile: path.join(outdir, "app.js"),
  tsconfig: path.join(here, "tsconfig.json"),
  jsx: "automatic",
  jsxImportSource: "react",
  // React and react-native-svg resolve to the string-rendering shims, so the
  // app's drawing components produce markup instead of a component tree.
  alias: {
    react: path.join(here, "src", "shim", "react"),
    "react-native-svg": path.join(here, "src", "shim", "react-native-svg.js"),
  },
  loader: { ".css": "css" },
  minify: true,
  // Only while developing: the map is 5 MB, and committing a fresh copy of
  // it on every build would grow the repo faster than the price data does.
  sourcemap: process.argv.includes("--watch"),
  logLevel: "info",
  metafile: true,
};

fs.mkdirSync(outdir, { recursive: true });
for (const file of ["index.html", "app.css"]) {
  fs.copyFileSync(path.join(here, "src", file), path.join(outdir, file));
}
// maplibre ships its own stylesheet; copied rather than bundled so the
// browser can cache it separately from our code.
fs.copyFileSync(
  path.join(here, "node_modules", "maplibre-gl", "dist", "maplibre-gl.css"),
  path.join(outdir, "maplibre-gl.css"),
);

if (process.argv.includes("--watch")) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("watching…");
} else {
  const result = await esbuild.build(options);
  const bytes = Object.values(result.metafile.outputs).reduce((n, o) => n + o.bytes, 0);
  console.log(`built ${(bytes / 1024).toFixed(0)} KB into docs/app/`);
}
