// Renders every gallery template (and every full example in the cheat sheets)
// with the bundled mermaid.js in headless Chromium, and fails if any errors.
//
//   npm run check-templates            # uses Playwright's Chromium
//   CHROMIUM_PATH=/path/to/chrome npm run check-templates
import * as esbuild from "esbuild";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = new URL("../app/", import.meta.url).pathname;
const work = await mkdtemp(join(tmpdir(), "mf-check-"));

function loadPlaywright() {
  for (const name of ["playwright", "playwright-core", "@playwright/test"]) {
    try {
      return require(name);
    } catch {
      /* try the next */
    }
  }
  try {
    const globalRoot = require("node:child_process").execSync("npm root -g").toString().trim();
    return require(join(globalRoot, "playwright"));
  } catch {
    console.error("Playwright is not installed. Run: npm install --no-save playwright");
    process.exit(2);
  }
}

async function collectCases() {
  const cases = [];
  const index = JSON.parse(await readFile(join(root, "gallery/index.json"), "utf8"));
  for (const t of index) {
    cases.push({ name: `template ${t.slug}`, source: await readFile(join(root, "gallery", t.file), "utf8") });
  }
  // Cheat-sheet code blocks marked ```mermaid are complete diagrams.
  for (const file of (await readdir(join(root, "cheatsheets"))).filter((f) => f.endsWith(".md"))) {
    const text = await readFile(join(root, "cheatsheets", file), "utf8");
    let n = 0;
    for (const m of text.matchAll(/```mermaid\n([\s\S]*?)```/g)) {
      cases.push({ name: `cheatsheet ${file} #${++n}`, source: m[1] });
    }
  }
  return cases;
}

try {
  await writeFile(
    join(work, "entry.js"),
    `import { renderMermaid } from ${JSON.stringify(new URL("./src/render.js", import.meta.url).pathname)};
     window.renderMermaid = renderMermaid; window.ready = true;`,
  );
  await esbuild.build({
    entryPoints: [join(work, "entry.js")],
    outdir: join(work, "out"),
    bundle: true,
    splitting: true,
    format: "esm",
    logLevel: "warning",
  });
  await writeFile(join(work, "out", "index.html"), '<!doctype html><script type="module" src="entry.js"></script>');

  const types = { ".js": "text/javascript", ".html": "text/html" };
  const server = createServer(async (req, res) => {
    try {
      const path = join(work, "out", decodeURIComponent(new URL(req.url, "http://x").pathname));
      const body = await readFile(path);
      res.writeHead(200, { "Content-Type": types[extname(path)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/index.html`);
  await page.waitForFunction(() => window.ready === true);

  const cases = await collectCases();
  let failures = 0;
  for (const c of cases) {
    const error = await page.evaluate(async (source) => {
      try {
        const { svg } = await window.renderMermaid(source, { theme: "default", config: {} });
        return svg.includes("<svg") ? null : "no SVG produced";
      } catch (e) {
        return String(e?.message || e);
      }
    }, c.source);
    if (error) {
      failures++;
      console.log(`✗ ${c.name}\n    ${error.split("\n").join("\n    ")}`);
    } else {
      console.log(`✓ ${c.name}`);
    }
  }
  await browser.close();
  server.close();
  console.log(`\n${cases.length - failures}/${cases.length} rendered`);
  process.exitCode = failures ? 1 : 0;
} finally {
  await rm(work, { recursive: true, force: true });
}
