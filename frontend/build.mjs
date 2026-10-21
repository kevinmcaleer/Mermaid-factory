// Bundles the browser code (mermaid.js, CodeMirror and our pages) into
// app/static/build so the app serves everything itself: no CDN, works offline.
import * as esbuild from "esbuild";
import { rm } from "node:fs/promises";

const outdir = new URL("../app/static/build/", import.meta.url).pathname;
const watch = process.argv.includes("--watch");

const options = {
  entryPoints: {
    editor: "src/editor.js",
    dashboard: "src/dashboard.js",
    gallery: "src/gallery.js",
    share: "src/share.js",
    settings: "src/settings.js",
  },
  outdir,
  bundle: true,
  splitting: true, // mermaid lazy-loads each diagram type as its own chunk
  format: "esm",
  target: ["es2022", "chrome110", "firefox115", "safari16"],
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  chunkNames: "chunks/[name]-[hash]",
  legalComments: "linked",
  logLevel: "info",
};

await rm(outdir, { recursive: true, force: true });
if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
