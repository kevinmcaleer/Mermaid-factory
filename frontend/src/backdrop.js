// The diagram's background: none (transparent, the default), or blueprint
// paper in blue or black. A blueprint is a grid on the paper colour with the
// diagram drawn over it in pale "ink" (outlines, text and arrows), so the
// theme's own colours don't fight the paper. Shapes coloured with classDef or
// style keep their colours (those rules are !important; the ink isn't), and
// sequence-diagram notes stay sticky-note yellow.
//
// The choice is saved as config.background ("blueprint" | "blueprint-dark")
// and rides in front matter (`config: background: blueprint`) when the code
// goes to another page, so it's drawn there too.
//
// Pure string work, so it runs (and is tested) without a DOM.

export const BACKGROUNDS = [
  { value: "", label: "No background", short: "None" },
  { value: "blueprint", label: "Blue blueprint", short: "Blue" },
  { value: "blueprint-dark", label: "Black blueprint", short: "Black" },
];

const PAPERS = {
  blueprint: {
    paper: "#1f4f8f",
    minor: "rgba(255,255,255,0.09)",
    major: "rgba(255,255,255,0.22)",
    ink: "#f4f8ff",
    fill: "#2b5d9c",
    cluster: "rgba(255,255,255,0.04)",
  },
  "blueprint-dark": {
    paper: "#121519",
    minor: "rgba(140,190,255,0.08)",
    major: "rgba(140,190,255,0.18)",
    ink: "#d9e8ff",
    fill: "#1b2129",
    cluster: "rgba(140,190,255,0.04)",
  },
};

const MINOR = 20; // grid square, px
const MAJOR = 100; // every fifth line is stronger
const PADDING = 24; // paper around the drawing in a standalone SVG

/** The paper for a background value, or null for none / unknown values. */
export function paperFor(background) {
  return Object.hasOwn(PAPERS, background || "") ? PAPERS[background] : null;
}

/**
 * CSS for an element showing the paper behind a pan/zoom view. `scale`, `x`
 * and `y` (the view's transform) keep the grid moving with the drawing.
 * Returns {} for no background.
 */
export function paperCss(background, { scale = 1, x = 0, y = 0 } = {}) {
  const p = paperFor(background);
  if (!p) return {};
  const minor = MINOR * scale;
  const major = MAJOR * scale;
  const line = (c) => `linear-gradient(${c} 1px, transparent 1px), linear-gradient(90deg, ${c} 1px, transparent 1px)`;
  return {
    backgroundColor: p.paper,
    backgroundImage: `${line(p.major)}, ${line(p.minor)}`,
    backgroundSize: `${major}px ${major}px, ${major}px ${major}px, ${minor}px ${minor}px, ${minor}px ${minor}px`,
    backgroundPosition: `${x}px ${y}px`,
  };
}

/** Puts `paperCss` on `el` (clearing it for no background). */
export function applyPaper(el, background, transform) {
  const css = paperCss(background, transform);
  el.style.backgroundColor = css.backgroundColor || "";
  el.style.backgroundImage = css.backgroundImage || "";
  el.style.backgroundSize = css.backgroundSize || "";
  el.style.backgroundPosition = css.backgroundPosition || "";
  return !!css.backgroundColor;
}

// Selectors for the ink, scoped to the SVG's id so they outrank the theme's
// rules (which are scoped the same way and come first).
const TEXT = [
  "text",
  "tspan",
  ".label",
  ".nodeLabel",
  ".edgeLabel",
  ".cluster-label",
  ".labelText",
  ".messageText",
  ".loopText",
  ".actor-man",
  "text.actor > tspan",
  ".pieTitleText",
  ".legend text",
  ".titleText",
  ".sectionTitle",
  ".tick text",
  "foreignObject div",
  "foreignObject span",
  "foreignObject p",
];
const SHAPES = [
  ".node rect",
  ".node circle",
  ".node ellipse",
  ".node polygon",
  ".node path",
  "rect.actor",
  ".labelBox",
  ".activation0",
  ".activation1",
  ".activation2",
  ".classGroup rect",
  ".entityBox",
  ".er.entityBox",
  ".stateGroup rect",
  ".state-note",
  ".mindmap-node rect",
  ".mindmap-node path",
  ".section-root rect",
];
const CLUSTERS = [
  ".cluster rect",
  ".cluster polygon",
  ".cluster path",
  ".cluster[data-look] rect",
  ".statediagram-cluster rect",
  ".composit",
];
const LINES = [
  ".edgePath .path",
  ".flowchart-link",
  ".edge-thickness-normal",
  ".edge-thickness-thick",
  ".relation",
  ".relationshipLine",
  ".transition",
  ".messageLine0",
  ".messageLine1",
  ".actor-line",
  ".loopLine",
  ".divider",
  ".classGroup line",
  ".pieOuterCircle",
  ".pieCircle",
  ".grid .tick line",
];
// Arrowheads: all outlined in ink; filled ones (not fill="none") filled with it.
const MARKER_STROKES = ["marker path", "marker[id] path", "marker circle", ".marker", ".arrowheadPath", ".arrowMarkerPath"];
const MARKER_FILLS = ['marker path:not([fill="none"])', 'marker[id] path:not([fill="none"])', ".arrowMarkerPath"];
// Hollow ones (class diagram inheritance, ER's "zero" circle) are paper inside.
const MARKER_HOLLOW = ["marker circle", ".extension", ".aggregation", ".lollipop"];
const LABEL_BOXES = [".edgeLabel", ".edgeLabel p", ".labelBkg", ".edgeLabel rect", ".edgeLabel .label rect"];
// Mermaid's "neo" look (its default) styles shapes as [data-look="neo"].node …,
// which outranks .node …; these match that.
const NEO = (list) => list.filter((s) => s.startsWith(".node ")).map((s) => s.replace(".node ", ".node[data-look] "));
// A shape coloured with classDef or a style line (mermaid puts that inline on
// the shape) keeps its fill, so its label stays dark like the theme's text.
const OWN_FILL = '.node:has(> [style*="fill"])';
const OWN_FILL_TEXT = [".nodeLabel", ".label", "text", "tspan", "foreignObject div", "foreignObject span", "foreignObject p"].map(
  (s) => `${OWN_FILL} ${s}`,
);

const scoped = (id, list) => list.map((s) => `#${id} ${s}`).join(",");

/** The ink stylesheet (CSS text) for an SVG with id `svgId`, or "" for none. */
export function inkCss(background, svgId) {
  const p = paperFor(background);
  if (!p || !svgId) return "";
  return [
    `#${svgId}{color:${p.ink};fill:${p.ink};}`,
    `${scoped(svgId, TEXT)}{fill:${p.ink};color:${p.ink};}`,
    `${scoped(svgId, [...SHAPES, ...NEO(SHAPES)])}{fill:${p.fill};stroke:${p.ink};filter:none;}`,
    `${scoped(svgId, CLUSTERS)}{fill:${p.cluster};stroke:${p.ink};stroke-dasharray:6 4;}`,
    `${scoped(svgId, LINES)}{stroke:${p.ink};}`,
    `${scoped(svgId, MARKER_STROKES)}{stroke:${p.ink};}`,
    `${scoped(svgId, MARKER_FILLS)}{fill:${p.ink};}`,
    `${scoped(svgId, MARKER_HOLLOW)}{fill:${p.paper};stroke:${p.ink};}`,
    `${scoped(svgId, LABEL_BOXES)}{background-color:${p.paper};fill:${p.paper};opacity:1;}`,
    `${scoped(svgId, OWN_FILL_TEXT)}{fill:#1d2330;color:#1d2330;}`,
  ].join("");
}

const OPEN_TAG = /^\s*<svg\b[^>]*>/;

function svgIdOf(openTag) {
  return /\sid="([^"]+)"/.exec(openTag)?.[1] || null;
}

const num = (n) => String(Math.round(n * 1000) / 1000);

/** The paper (grid pattern + rects) as SVG markup covering box {x, y, width, height}. */
function paperMarkup(p, id, box) {
  const minorId = `${id}-bp-minor`;
  const majorId = `${id}-bp-major`;
  const rect = (fill) =>
    `<rect x="${num(box.x)}" y="${num(box.y)}" width="${num(box.width)}" height="${num(box.height)}" style="fill:${fill};stroke:none"/>`;
  return (
    `<g class="mf-paper" aria-hidden="true"><defs>` +
    `<pattern id="${minorId}" width="${MINOR}" height="${MINOR}" patternUnits="userSpaceOnUse" x="${num(box.x)}" y="${num(box.y)}">` +
    `<path d="M${MINOR} 0H0V${MINOR}" style="fill:none;stroke:${p.minor};stroke-width:1"/></pattern>` +
    `<pattern id="${majorId}" width="${MAJOR}" height="${MAJOR}" patternUnits="userSpaceOnUse" x="${num(box.x)}" y="${num(box.y)}">` +
    `<rect width="${MAJOR}" height="${MAJOR}" style="fill:url(#${minorId});stroke:none"/>` +
    `<path d="M${MAJOR} 0H0V${MAJOR}" style="fill:none;stroke:${p.major};stroke-width:1"/></pattern>` +
    `</defs>${rect(p.paper)}${rect(`url(#${majorId})`)}</g>`
  );
}

/**
 * Mermaid's SVG markup with the background drawn in: the ink stylesheet
 * always, and with `paper` (the default) the grid paper behind the drawing,
 * with a margin around it. Markup it can't follow, or no background, comes
 * back unchanged.
 */
export function withBackdrop(svg, background, { paper = true } = {}) {
  const p = paperFor(background);
  if (!p || typeof svg !== "string") return svg;
  const open = OPEN_TAG.exec(svg);
  if (!open) return svg;
  const id = svgIdOf(open[0]);
  if (!id) return svg;
  let tag = open[0];
  let body = svg.slice(open.index + tag.length);

  // The ink goes after mermaid's own <style> so it wins ties.
  const style = `<style>${inkCss(background, id)}</style>`;
  const end = body.indexOf("</style>");
  body = end >= 0 ? body.slice(0, end + 8) + style + body.slice(end + 8) : style + body;

  if (paper) {
    const vb = /\sviewBox="\s*([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+)\s*"/.exec(tag);
    if (vb) {
      const [x, y, w, h] = vb.slice(1).map(Number);
      const box = { x: x - PADDING, y: y - PADDING, width: w + 2 * PADDING, height: h + 2 * PADDING };
      tag = tag.replace(vb[0], ` viewBox="${num(box.x)} ${num(box.y)} ${num(box.width)} ${num(box.height)}"`);
      // Mermaid caps the width at the drawing's own; widen it by the margin.
      tag = tag.replace(/max-width:\s*([\d.]+)px/, (_, mw) => `max-width: ${num(Number(mw) + 2 * PADDING)}px`);
      tag = tag.replace(/(\swidth=")([\d.]+)(")/, (_, a, wv, b) => `${a}${num(Number(wv) + 2 * PADDING)}${b}`);
      tag = tag.replace(/(\sheight=")([\d.]+)(")/, (_, a, hv, b) => `${a}${num(Number(hv) + 2 * PADDING)}${b}`);
      body = paperMarkup(p, id, box) + body;
    }
  }
  return svg.slice(0, open.index) + tag + body;
}
