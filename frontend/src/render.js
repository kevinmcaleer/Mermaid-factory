// Wraps mermaid.js: builds the config for a diagram and serialises renders.

import mermaid from "mermaid";

let renderCounter = 0;
let queue = Promise.resolve();

/** Build the mermaid config for a diagram's theme and saved style options.
 *  `themeVariables` are mermaid's own (primaryColor, lineColor, dropShadow…),
 *  for a host restyling the theme, usually with theme "base". `forExport` switches labels to pure SVG <text> (no <foreignObject>) so the
 *  file works in Inkscape and can be drawn onto a canvas for PNG export. */
export function buildConfig(theme = "default", config = {}, { forExport = false } = {}) {
  const cfg = {
    startOnLoad: false,
    securityLevel: "strict",
    theme: theme || "default",
    flowchart: {},
  };
  if (config.look) cfg.look = config.look;
  if (config.layout) cfg.layout = config.layout;
  if (config.curve) cfg.flowchart.curve = config.curve;
  if (config.themeVariables) cfg.themeVariables = { ...config.themeVariables };
  if (config.fontFamily) {
    cfg.fontFamily = config.fontFamily;
    cfg.themeVariables = { ...cfg.themeVariables, fontFamily: config.fontFamily };
  }
  if (forExport) {
    cfg.htmlLabels = false;
    cfg.flowchart.htmlLabels = false;
  }
  return cfg;
}

function cleanupOrphans(id) {
  // On a failed render mermaid can leave its temporary container in <body>.
  document.getElementById(id)?.remove();
  document.getElementById("d" + id)?.remove();
}

/** Parse and render. Resolves to {svg, bindFunctions, diagramType}; rejects
 *  with an Error whose message is mermaid's parse error. Renders run one at a
 *  time because mermaid keeps global state. */
export function renderMermaid(source, { theme, config, forExport = false } = {}) {
  const job = queue.then(async () => {
    const id = `mf-render-${++renderCounter}`;
    mermaid.initialize(buildConfig(theme, config, { forExport }));
    try {
      await mermaid.parse(source);
      return await mermaid.render(id, source);
    } finally {
      cleanupOrphans(id);
    }
  });
  // Keep the queue alive even if this job fails.
  queue = job.catch(() => {});
  return job;
}

/** True when mermaid can parse `source`. Queued with renders. */
export function parses(source) {
  const job = queue.then(() => mermaid.parse(source, { suppressErrors: true }));
  queue = job.catch(() => {});
  return job.then((result) => result !== false, () => false);
}

export function errorMessage(err) {
  const text = (err && (err.message || err.str)) || String(err);
  return text.replace(/^Error:\s*/, "").trim();
}

/** Extract a 1-based line number from a mermaid error, if it has one. */
export function errorLine(err) {
  const hashLine = err?.hash?.loc?.first_line ?? err?.hash?.line;
  if (Number.isInteger(hashLine)) return hashLine + (err?.hash?.loc ? 0 : 1);
  const match = /line\s*:?\s*(\d+)/i.exec(errorMessage(err));
  return match ? Number(match[1]) : null;
}

/** Mermaid sizes its SVG with width="100%" and a max-width style. For
 *  pan/zoom and export we want the natural pixel size from the viewBox. */
export function naturalSize(svgEl) {
  const vb = svgEl.viewBox?.baseVal;
  if (vb && vb.width && vb.height) return { width: vb.width, height: vb.height };
  const box = svgEl.getBBox?.();
  return { width: box?.width || 300, height: box?.height || 150 };
}

export function fixSvgSize(svgEl) {
  const { width, height } = naturalSize(svgEl);
  svgEl.setAttribute("width", String(Math.ceil(width)));
  svgEl.setAttribute("height", String(Math.ceil(height)));
  svgEl.style.maxWidth = "none";
  return { width, height };
}

// Keep in sync with TYPE_KEYWORDS in app/diagrams.py.
const TYPE_KEYWORDS = [
  ["flowchart-elk", "flowchart"],
  ["flowchart", "flowchart"],
  ["graph", "flowchart"],
  ["sequenceDiagram", "sequence"],
  ["classDiagram", "class"],
  ["stateDiagram", "state"],
  ["erDiagram", "er"],
  ["journey", "journey"],
  ["gantt", "gantt"],
  ["pie", "pie"],
  ["quadrantChart", "quadrant"],
  ["requirementDiagram", "requirement"],
  ["requirement", "requirement"],
  ["gitGraph", "gitgraph"],
  ["C4Context", "c4"],
  ["C4Container", "c4"],
  ["C4Component", "c4"],
  ["C4Dynamic", "c4"],
  ["C4Deployment", "c4"],
  ["mindmap", "mindmap"],
  ["timeline", "timeline"],
  ["sankey", "sankey"],
  ["xychart", "xychart"],
  ["block", "block"],
  ["packet", "packet"],
  ["kanban", "kanban"],
  ["architecture", "architecture"],
  ["radar", "radar"],
  ["treemap", "treemap"],
  ["venn", "venn"],
  ["ishikawa", "ishikawa"],
  ["wardley", "wardley"],
  ["railroad", "railroad"],
  ["treeView", "treeview"],
  ["usecase", "usecase"],
  ["cynefin", "cynefin"],
  ["swimlane", "swimlane"],
  ["eventmodeling", "eventmodeling"],
  ["agentflow", "agentflow"],
  ["info", "info"],
];

/** Detect the diagram type slug from the first meaningful line. */
export function detectType(source) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  if (i < lines.length && lines[i].trim() === "---") {
    i++;
    while (i < lines.length && lines[i].trim() !== "---") i++;
    i++;
  }
  let inDirective = false;
  for (const line of lines.slice(i)) {
    const text = line.trim();
    if (inDirective) {
      if (text.includes("}%%")) inDirective = false;
      continue;
    }
    if (!text) continue;
    if (text.startsWith("%%{")) {
      inDirective = !text.includes("}%%");
      continue;
    }
    if (text.startsWith("%%")) continue;
    const word = (/^[A-Za-z0-9_-]+/.exec(text) || [""])[0];
    for (const [keyword, slug] of TYPE_KEYWORDS) {
      if (word === keyword || (word.startsWith(keyword) && word[keyword.length] === "-")) return slug;
    }
    return "unknown";
  }
  return "unknown";
}

/** True when the code sets its own config (init directive or front-matter config). */
export function hasInlineConfig(source) {
  if (/%%\{\s*init/.test(source)) return true;
  const lines = source.replace(/\r\n/g, "\n").trimStart().split("\n");
  if (lines[0]?.trim() !== "---") return false;
  for (const line of lines.slice(1)) {
    if (line.trim() === "---") break;
    if (line.trim().startsWith("config:")) return true;
  }
  return false;
}

export { mermaid };

const DARK_THEMES = new Set(["dark", "neo-dark", "redux-dark", "redux-dark-color"]);

/** Background to show behind a diagram so dark themes stay readable. */
export function themeBackground(theme) {
  return DARK_THEMES.has(theme) ? "#1f2020" : "";
}
