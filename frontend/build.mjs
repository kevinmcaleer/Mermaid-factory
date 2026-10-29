// Bundles the browser code (mermaid.js, CodeMirror and our pages) into
// app/static/build so the app serves everything itself: no CDN, works offline.
// Also builds the mermaid-tools library for other sites into frontend/dist
// (see "Using the editor in other pages" in the README).
import * as esbuild from "esbuild";
import { readFile, rm } from "node:fs/promises";

const outdir = new URL("../app/static/build/", import.meta.url).pathname;
const libdir = new URL("./dist/", import.meta.url).pathname;
const galleryDir = new URL("../app/gallery/", import.meta.url).pathname;
const watch = process.argv.includes("--watch");
const version = /^version\s*=\s*"([^"]+)"/m.exec(await readFile(new URL("../pyproject.toml", import.meta.url), "utf8"))[1];

// `import templates from "mf:templates"`: the gallery's starters, as the
// /api/templates endpoint serves them.
const templatesPlugin = {
  name: "mf-templates",
  setup(build) {
    build.onResolve({ filter: /^mf:templates$/ }, () => ({ path: "templates", namespace: "mf" }));
    build.onLoad({ filter: /.*/, namespace: "mf" }, async () => {
      const index = JSON.parse(await readFile(galleryDir + "index.json", "utf8"));
      const items = [];
      for (const { file, ...t } of index) items.push({ ...t, source: await readFile(galleryDir + file, "utf8") });
      return { contents: JSON.stringify(items), loader: "json", watchFiles: [galleryDir + "index.json"] };
    });
  },
};

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

const lib = {
  bundle: true,
  target: options.target,
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  legalComments: "linked",
  logLevel: "info",
  define: { __MF_VERSION__: JSON.stringify(version) },
  plugins: [templatesPlugin],
};
const libOptions = [
  // ES module: mermaid's diagram types load as chunks on first use.
  { ...lib, entryPoints: { "mermaid-tools": "src/lib.js" }, outdir: libdir, outExtension: { ".js": ".mjs" }, format: "esm", splitting: true, chunkNames: "chunks/[name]-[hash]" },
  // One script setting window.MermaidTools (everything inlined, so larger).
  { ...lib, entryPoints: { "mermaid-tools": "src/lib.js" }, outdir: libdir, format: "iife", globalName: "MermaidTools" },
];

await rm(outdir, { recursive: true, force: true });
await rm(libdir, { recursive: true, force: true });
if (watch) {
  for (const o of [options, ...libOptions]) await (await esbuild.context(o)).watch();
} else {
  await Promise.all([options, ...libOptions].map((o) => esbuild.build(o)));
}
