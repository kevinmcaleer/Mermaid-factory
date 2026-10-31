// Editing a flowchart from the drawing: click a node to change its text or
// shape, or to add a node joined to it. Every change is made to the source
// (see flowchart-edit.js) and the host re-renders as it would for typing.

import {
  ARROW_ENDS,
  LINE_STYLES,
  SHAPES,
  STYLE_PRESETS,
  deleteEdge,
  findEdge,
  listEdges,
  reverseEdge,
  setEdge,
  classDefNames,
  nodeClass,
  nodeStyle,
  setNodeClass,
  setNodeStyle,
  addConnectedNode,
  addNode,
  connectNodes,
  deleteNode,
  findNode,
  flowDirection,
  isFlowchart,
  nodeIdFromElement,
  setNodeShape,
  setDirection,
  setNodeText,
} from "./flowchart-edit.js";

// Little outlines of each shape for the picker (viewBox 0 0 28 18).
const ICONS = {
  rect: '<rect x="3" y="3" width="22" height="12"/>',
  rounded: '<rect x="3" y="3" width="22" height="12" rx="3.5"/>',
  stadium: '<rect x="3" y="3" width="22" height="12" rx="6"/>',
  circle: '<circle cx="14" cy="9" r="7"/>',
  "double-circle": '<circle cx="14" cy="9" r="7.5"/><circle cx="14" cy="9" r="5"/>',
  diamond: '<path d="M14 1.5 26 9 14 16.5 2 9Z"/>',
  hexagon: '<path d="M7 3h14l4 6-4 6H7L3 9Z"/>',
  subroutine: '<rect x="3" y="3" width="22" height="12"/><path d="M6.5 3v12M21.5 3v12"/>',
  cylinder: '<path d="M7 4.5v9c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-9"/><ellipse cx="14" cy="4.5" rx="7" ry="2.5"/>',
  parallelogram: '<path d="M8 3h17l-5 12H3Z"/>',
  "parallelogram-alt": '<path d="M3 3h17l5 12H8Z"/>',
  trapezoid: '<path d="M8 3h12l5 12H3Z"/>',
  "trapezoid-alt": '<path d="M3 3h22l-5 12H8Z"/>',
  asymmetric: '<path d="M3 3h22v12H3l5-6Z"/>',
};

const STYLE_ID = "mf-canvas-edit-style";
const CSS = `
.mf-canvas-edit g.node { cursor: pointer; }
.mf-canvas-edit g.node:hover > :is(rect, polygon, circle, path, ellipse) { filter: drop-shadow(0 0 2px var(--mf-select, #2563eb)); }
.mf-canvas-edit g.node.mf-selected > :is(rect, polygon, circle, path, ellipse),
.mf-canvas-edit g.node.mf-selected > g > :is(rect, polygon, circle, path, ellipse) {
  stroke: var(--mf-select, #2563eb) !important; stroke-width: 2.5px !important;
}
.mf-node-pop {
  position: absolute; z-index: 20; width: 264px; box-sizing: border-box; padding: 10px;
  background: var(--mf-pop-bg, var(--surface, #fff)); color: var(--mf-pop-text, var(--text, #1d2330));
  border: 1px solid var(--mf-pop-border, var(--border, #d9dde4)); border-radius: 10px;
  max-height: calc(100% - 8px); overflow-y: auto; overscroll-behavior: contain;
  box-shadow: 0 4px 18px rgb(0 0 0 / 16%); font: 13px/1.35 var(--mf-pop-font, system-ui, sans-serif);
  cursor: default; text-align: left; white-space: normal; letter-spacing: normal;
}
.mf-node-pop * { box-sizing: border-box; }
.mf-node-pop[hidden] { display: none; }
.mf-node-pop-head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; color: var(--mf-pop-muted, var(--muted, #5d6677)); font-size: 12px; }
.mf-node-pop-head span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mf-node-pop button { font: inherit; color: inherit; cursor: pointer; }
.mf-node-pop-close { border: 0; background: none; padding: 0 4px; font-size: 16px !important; line-height: 1; color: inherit; }
.mf-node-pop-text { width: 100%; box-sizing: border-box; padding: 6px 8px; border: 1px solid var(--mf-pop-border, var(--border, #d9dde4)); border-radius: 6px; background: transparent; color: inherit; font: inherit; }
.mf-node-pop-text:focus { outline: 2px solid var(--mf-select, #2563eb); outline-offset: -1px; }
.mf-node-pop-label { margin: 8px 0 4px; font-size: 12px; color: var(--mf-pop-muted, var(--muted, #5d6677)); }
.mf-node-pop-shapes { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; }
.mf-node-pop-shapes button { display: grid; place-items: center; height: 26px; padding: 0; border: 1px solid transparent; border-radius: 5px; background: none; }
.mf-node-pop-shapes button:hover { border-color: var(--mf-pop-border, var(--border, #d9dde4)); }
.mf-node-pop-shapes button[aria-pressed="true"] { border-color: var(--mf-select, #2563eb); background: color-mix(in srgb, var(--mf-select, #2563eb) 12%, transparent); }
.mf-node-pop-shapes svg { width: 24px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.4; }
.mf-node-pop-add { display: flex; gap: 6px; margin-top: 10px; }
.mf-node-pop-add button { flex: 1; padding: 6px 8px; border: 1px solid var(--mf-pop-border, var(--border, #d9dde4)); border-radius: 6px; background: var(--mf-pop-button, transparent); }
.mf-node-pop-add button:hover { border-color: var(--mf-select, #2563eb); }
.mf-node-pop-add button.mf-node-pop-delete { flex: none; color: var(--mf-danger, #c62828); }
.mf-node-pop-add button.mf-node-pop-delete:hover { border-color: currentColor; }
.mf-node-pop-styles { display: flex; flex-wrap: wrap; gap: 4px; }
.mf-node-pop-styles button {
  min-width: 0; padding: 3px 7px; border: 1px solid var(--chip-stroke, var(--mf-pop-border, #d9dde4)); border-radius: 5px;
  background: var(--chip-fill, transparent); color: var(--chip-text, inherit); font-size: 11.5px !important;
}
.mf-node-pop-styles button[aria-pressed="true"] { outline: 2px solid var(--mf-select, #2563eb); outline-offset: 1px; }
.mf-node-pop-more { margin-top: 8px; }
.mf-node-pop-more > summary { cursor: pointer; font-size: 12px; color: var(--mf-pop-muted, var(--muted, #5d6677)); }
.mf-node-pop-row { display: flex; align-items: center; gap: 3px; flex-wrap: wrap; margin-top: 4px; }
.mf-node-pop-row > span { flex-basis: 100%; margin-top: 2px; font-size: 11.5px; color: var(--mf-pop-muted, var(--muted, #5d6677)); }
.mf-node-pop-row button.mf-dot {
  width: 16px; height: 16px; padding: 0; border-radius: 50%; border: 1px solid rgb(0 0 0 / 22%); background: var(--dot);
}
.mf-node-pop-row button.mf-dot[data-value=""] { background: linear-gradient(135deg, transparent 45%, #c62828 45% 55%, transparent 55%), #fff; }
.mf-node-pop-row button.mf-dot[aria-pressed="true"] { outline: 2px solid var(--mf-select, #2563eb); outline-offset: 1px; }
.mf-node-pop-row button.mf-opt { height: 22px; min-width: 26px; padding: 0 5px; border: 1px solid var(--mf-pop-border, var(--border, #d9dde4)); border-radius: 5px; background: none; font-size: 11.5px !important; }
.mf-node-pop-row button.mf-opt[aria-pressed="true"] { border-color: var(--mf-select, #2563eb); background: color-mix(in srgb, var(--mf-select, #2563eb) 12%, transparent); }
.mf-node-pop-row svg { width: 22px; height: 10px; stroke: currentColor; stroke-width: 2; }
.mf-canvas-edit .mf-edge-hit { fill: none !important; stroke: transparent !important; stroke-width: 14px !important; pointer-events: stroke; cursor: pointer; marker-start: none !important; marker-end: none !important; }
.mf-canvas-edit .edgeLabel [data-id] { cursor: pointer; }
.mf-canvas-edit path.mf-edge-selected { stroke: var(--mf-select, #2563eb) !important; }
.mf-canvas-edit .mf-edge-hit:hover + path, .mf-canvas-edit path:has(+ .mf-edge-hit:hover) { stroke: var(--mf-select, #2563eb) !important; }
.mf-edge-pop .mf-node-pop-row > span { flex-basis: 44px; margin: 0; }
.mf-node-pop-note { margin-top: 6px; font-size: 12px; color: var(--mf-danger, #c62828); }
.mf-node-pop-note:empty { display: none; }
/* The "+" handles on each side of a shape: click to add, drag to connect. */
.mf-handle {
  position: absolute; z-index: 16; width: 20px; height: 20px; margin: -10px 0 0 -10px; padding: 0;
  display: grid; place-items: center; border: 0; border-radius: 50%;
  background: var(--mf-select, #2563eb); color: #fff; box-shadow: 0 1px 4px rgb(0 0 0 / 25%);
  cursor: crosshair; touch-action: none; opacity: 0.9; transition: transform 0.1s;
}
.mf-handle:hover { transform: scale(1.2); opacity: 1; }
.mf-handle[hidden] { display: none; }
.mf-handle svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; }
.mf-drag-line { position: absolute; inset: 0; z-index: 17; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
.mf-drag-line[hidden] { display: none; }
.mf-drag-line line { stroke: var(--mf-select, #2563eb); stroke-width: 2; stroke-dasharray: 5 4; }
.mf-drag-line circle { fill: var(--mf-select, #2563eb); }
.mf-canvas-edit g.node.mf-drop-target > :is(rect, polygon, circle, path, ellipse),
.mf-canvas-edit g.node.mf-drop-target > g > :is(rect, polygon, circle, path, ellipse) {
  stroke: var(--mf-select, #2563eb) !important; stroke-width: 3px !important; stroke-dasharray: 5 3;
}
.mf-canvas-bar { position: absolute; left: 10px; top: 10px; z-index: 15; display: flex; gap: 6px; }
.mf-canvas-bar[hidden] { display: none; }
.mf-dir { display: flex; padding: 2px; gap: 1px; border: 1px solid var(--mf-pop-border, var(--border, #d9dde4)); border-radius: 9px;
  background: var(--mf-pop-bg, var(--surface, #fff)); color: var(--mf-pop-text, var(--text, #1d2330)); box-shadow: 0 2px 10px rgb(0 0 0 / 12%); }
.mf-dir button { display: grid; place-items: center; width: 24px; height: 22px; padding: 0; border: 0; border-radius: 6px; background: none; color: inherit; cursor: pointer; }
.mf-dir button:hover { background: color-mix(in srgb, currentColor 10%, transparent); }
.mf-dir button[aria-pressed="true"] { background: color-mix(in srgb, var(--mf-select, #2563eb) 16%, transparent); color: var(--mf-select, #2563eb); }
.mf-dir svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.mf-add-shape {
  display: flex; align-items: center; gap: 5px;
  padding: 5px 10px 5px 8px; border: 1px solid var(--mf-pop-border, var(--border, #d9dde4)); border-radius: 9px;
  background: var(--mf-pop-bg, var(--surface, #fff)); color: var(--mf-pop-text, var(--text, #1d2330));
  box-shadow: 0 2px 10px rgb(0 0 0 / 12%); font: 12px/1 var(--mf-pop-font, system-ui, sans-serif); cursor: pointer;
}
.mf-add-shape:hover { border-color: var(--mf-select, #2563eb); }
.mf-add-shape[hidden] { display: none; }
.mf-add-shape svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; }
`;

function injectStyle(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.append(style);
}

// Colours offered for fill, border and text ("" clears).
const PALETTE = ["", "#ffffff", "#f1f3f6", "#9aa3b2", "#3d4452", "#11141a", "#fde2e4", "#fdf0d5", "#fef9c3", "#dcf5ea", "#e0ecff", "#efe4fb", "#d9506a", "#e8873a", "#d4b106", "#3aa676", "#4c7bd9", "#8e5bd0"];
const BORDERS = [
  { id: "solid", label: "Solid", props: { "stroke-dasharray": "", "stroke-width": "" }, icon: '<line x1="1" y1="5" x2="21" y2="5"/>' },
  { id: "dashed", label: "Dashed", props: { "stroke-dasharray": "6 4", "stroke-width": "" }, icon: '<line x1="1" y1="5" x2="21" y2="5" stroke-dasharray="5 3"/>' },
  { id: "dotted", label: "Dotted", props: { "stroke-dasharray": "2 3", "stroke-width": "" }, icon: '<line x1="1" y1="5" x2="21" y2="5" stroke-dasharray="1.5 2.5"/>' },
  { id: "thick", label: "Thick", props: { "stroke-dasharray": "", "stroke-width": "3px" }, icon: '<line x1="1" y1="5" x2="21" y2="5" stroke-width="4"/>' },
];
const borderOf = (st) =>
  st["stroke-width"] ? "thick" : st["stroke-dasharray"] === "6 4" ? "dashed" : st["stroke-dasharray"] === "2 3" ? "dotted" : st["stroke-dasharray"] ? "" : "solid";

const LINE_ICONS = {
  solid: '<line x1="1" y1="5" x2="21" y2="5"/>',
  dotted: '<line x1="1" y1="5" x2="21" y2="5" stroke-dasharray="2 2.5"/>',
  thick: '<line x1="1" y1="5" x2="21" y2="5" stroke-width="4"/>',
  invisible: '<line x1="1" y1="5" x2="21" y2="5" stroke-dasharray="1 3" opacity=".35"/>',
};
const END_ICONS = {
  arrow: '<line x1="1" y1="5" x2="18" y2="5"/><path d="M15 1.5 21 5l-6 3.5Z" fill="currentColor" stroke="none"/>',
  none: '<line x1="1" y1="5" x2="21" y2="5"/>',
  circle: '<line x1="1" y1="5" x2="15" y2="5"/><circle cx="18" cy="5" r="3" fill="none"/>',
  cross: '<line x1="1" y1="5" x2="16" y2="5"/><path d="M15 2l6 6M21 2l-6 6"/>',
  both: '<line x1="5" y1="5" x2="17" y2="5"/><path d="M15 1.5 21 5l-6 3.5ZM7 1.5 1 5l6 3.5Z" fill="currentColor" stroke="none"/>',
};
const LABELS = { solid: "Solid", dotted: "Dotted", thick: "Thick", invisible: "Invisible (layout only)", arrow: "Arrow", none: "No arrow", circle: "Circle end", cross: "Cross end", both: "Arrows both ways" };

const PLUS = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8h9M8 3.5v9"/></svg>';
// Which side of a shape the flow comes from, by direction.
const UPSTREAM = { TB: "top", BT: "bottom", LR: "left", RL: "right" };
const SIDES = ["top", "right", "bottom", "left"];

const icon = (shape) => `<svg viewBox="0 0 28 18" aria-hidden="true">${ICONS[shape] || ICONS.rect}</svg>`;

/**
 * Makes the nodes drawn in `canvas` clickable. `viewport` is the element the
 * popover is placed in (positioned; often `canvas` itself or its scroller).
 * `getSource`/`setSource` read and write the diagram's code; after each
 * re-render, call `refresh()` so the selection follows the new drawing.
 */
export function attachCanvasEditor({ viewport, canvas, getSource, setSource }) {
  const doc = viewport.ownerDocument;
  injectStyle(doc);
  viewport.classList.add("mf-canvas-edit");
  if (getComputedStyle(viewport).position === "static") viewport.style.position = "relative";

  let selected = null; // node id

  const pop = doc.createElement("div");
  pop.className = "mf-node-pop";
  pop.hidden = true;
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Edit shape");
  pop.innerHTML = `
    <div class="mf-node-pop-head"><span></span><button type="button" class="mf-node-pop-close" title="Close (Esc)" aria-label="Close">×</button></div>
    <input class="mf-node-pop-text" type="text" aria-label="Text" spellcheck="true">
    <div class="mf-node-pop-label">Shape</div>
    <div class="mf-node-pop-shapes" role="group" aria-label="Shape"></div>
    <div class="mf-node-pop-label">Style</div>
    <div class="mf-node-pop-styles" role="group" aria-label="Style"></div>
    <details class="mf-node-pop-more">
      <summary>Colours and border</summary>
      <div class="mf-node-pop-row" data-prop="fill"><span>Fill</span></div>
      <div class="mf-node-pop-row" data-prop="stroke"><span>Border</span></div>
      <div class="mf-node-pop-row" data-prop="color"><span>Text</span></div>
      <div class="mf-node-pop-row" data-border><span>Line</span></div>
      <div class="mf-node-pop-row" data-font><span>Text</span>
        <button type="button" class="mf-opt" data-font="font-weight" data-on="bold" title="Bold"><b>B</b></button>
        <button type="button" class="mf-opt" data-font="font-style" data-on="italic" title="Italic"><i>I</i></button>
      </div>
    </details>
    <div class="mf-node-pop-add">
      <button type="button" data-add title="Add a shape joined to this one with an arrow">+ Add connected shape</button>
      <button type="button" class="mf-node-pop-delete" data-delete title="Delete this shape and its arrows (Delete)">Delete</button>
    </div>
    <div class="mf-node-pop-note" role="status"></div>`;
  const head = pop.querySelector(".mf-node-pop-head span");
  const input = pop.querySelector(".mf-node-pop-text");
  const shapes = pop.querySelector(".mf-node-pop-shapes");
  for (const s of SHAPES) {
    const b = doc.createElement("button");
    b.type = "button";
    b.dataset.shape = s.id;
    b.title = s.label;
    b.setAttribute("aria-label", s.label);
    b.innerHTML = icon(s.id);
    shapes.append(b);
  }
  const note = pop.querySelector(".mf-node-pop-note");
  const styleChips = pop.querySelector(".mf-node-pop-styles");
  for (const row of pop.querySelectorAll(".mf-node-pop-row[data-prop]")) {
    for (const c of PALETTE) {
      const b = doc.createElement("button");
      b.type = "button";
      b.className = "mf-dot";
      b.dataset.value = c;
      b.style.setProperty("--dot", c || "transparent");
      b.title = c || "Default";
      b.setAttribute("aria-label", c || "Default");
      row.append(b);
    }
  }
  const borderRow = pop.querySelector("[data-border]");
  for (const bd of BORDERS) {
    const b = doc.createElement("button");
    b.type = "button";
    b.className = "mf-opt";
    b.dataset.borderId = bd.id;
    b.title = bd.label;
    b.setAttribute("aria-label", bd.label);
    b.innerHTML = `<svg viewBox="0 0 22 10" aria-hidden="true">${bd.icon}</svg>`;
    borderRow.append(b);
  }
  styleChips.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-class]");
    if (!b || !selected) return;
    let next = getSource();
    const name = b.dataset.class || null;
    // A ready-made look replaces the shape's own colours.
    if (name) next = setNodeStyle(next, selected, { fill: null, stroke: null, color: null });
    change(setNodeClass(next, selected, name));
    syncStyle();
  });
  pop.querySelector(".mf-node-pop-more").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || !selected) return;
    const row = b.closest(".mf-node-pop-row");
    let changes = null;
    if (row?.dataset.prop) changes = { [row.dataset.prop]: b.dataset.value };
    else if (b.dataset.borderId) changes = BORDERS.find((x) => x.id === b.dataset.borderId).props;
    else if (b.dataset.font) {
      const on = nodeStyle(getSource(), selected)[b.dataset.font] === b.dataset.on;
      changes = { [b.dataset.font]: on ? null : b.dataset.on };
    }
    if (changes) change(setNodeStyle(getSource(), selected, changes));
    syncStyle();
  });

  // Shows the selected shape's class and own style in the controls.
  function syncStyle() {
    if (!selected) return;
    const src = getSource();
    const current = nodeClass(src, selected) || "";
    const presets = new Map(STYLE_PRESETS.map((p) => [p.name, p]));
    const names = ["", ...STYLE_PRESETS.map((p) => p.name), ...classDefNames(src).filter((n) => !presets.has(n))];
    const key = names.join("|");
    if (styleChips.dataset.key !== key) {
      styleChips.dataset.key = key;
      styleChips.innerHTML = "";
      for (const n of names) {
        const b = doc.createElement("button");
        b.type = "button";
        b.dataset.class = n;
        b.textContent = n || "None";
        b.title = n ? `Use the ${n} style (classDef ${n})` : "No style class";
        const p = presets.get(n);
        if (p) {
          b.style.setProperty("--chip-fill", p.fill);
          b.style.setProperty("--chip-stroke", p.stroke);
          b.style.setProperty("--chip-text", p.color);
        }
        styleChips.append(b);
      }
    }
    styleChips.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.class === current)));
    const st = nodeStyle(src, selected);
    for (const row of pop.querySelectorAll(".mf-node-pop-row[data-prop]")) {
      const v = (st[row.dataset.prop] || "").toLowerCase();
      row.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === v)));
    }
    const border = borderOf(st);
    borderRow.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.borderId === border)));
    pop.querySelectorAll("button[data-font]").forEach((b) => b.setAttribute("aria-pressed", String(st[b.dataset.font] === b.dataset.on)));
  }
  viewport.append(pop);

  // The arrow editor: label, line, end, reverse, delete.
  let selectedEdge = null;
  const epop = doc.createElement("div");
  epop.className = "mf-node-pop mf-edge-pop";
  epop.hidden = true;
  epop.setAttribute("role", "dialog");
  epop.setAttribute("aria-label", "Edit arrow");
  const opts = (list, icons, attr) =>
    list.map((v) => `<button type="button" class="mf-opt" data-${attr}="${v}" title="${LABELS[v]}" aria-label="${LABELS[v]}"><svg viewBox="0 0 22 10" aria-hidden="true">${icons[v]}</svg></button>`).join("");
  epop.innerHTML = `
    <div class="mf-node-pop-head"><span></span><button type="button" class="mf-node-pop-close" title="Close (Esc)" aria-label="Close">×</button></div>
    <input class="mf-node-pop-text" type="text" aria-label="Label" placeholder="Label (optional)" spellcheck="true">
    <div class="mf-node-pop-row"><span>Line</span>${opts(LINE_STYLES, LINE_ICONS, "line")}</div>
    <div class="mf-node-pop-row"><span>End</span>${opts(ARROW_ENDS, END_ICONS, "end")}</div>
    <div class="mf-node-pop-add">
      <button type="button" data-reverse title="Point the arrow the other way">⇄ Reverse</button>
      <button type="button" class="mf-node-pop-delete" data-delete title="Delete this arrow (Delete)">Delete</button>
    </div>
    <div class="mf-node-pop-note" role="status"></div>`;
  viewport.append(epop);
  const ehead = epop.querySelector(".mf-node-pop-head span");
  const einput = epop.querySelector(".mf-node-pop-text");
  const enote = epop.querySelector(".mf-node-pop-note");
  for (const type of ["pointerdown", "mousedown", "click", "dblclick", "wheel", "keydown"]) {
    epop.addEventListener(type, (e) => e.stopPropagation());
  }
  epop.querySelector(".mf-node-pop-close").addEventListener("click", () => closeEdge());
  epop.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || (e.key === "Enter" && e.target === einput)) {
      e.preventDefault();
      closeEdge();
    }
  });
  einput.addEventListener("input", () => {
    if (selectedEdge) change(setEdge(getSource(), selectedEdge, { label: einput.value }));
  });
  epop.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || !selectedEdge) return;
    if (b.dataset.line) change(setEdge(getSource(), selectedEdge, { line: b.dataset.line }));
    else if (b.dataset.end) change(setEdge(getSource(), selectedEdge, { end: b.dataset.end }));
    else if (b.hasAttribute("data-delete")) return removeEdge();
    else if (b.hasAttribute("data-reverse")) {
      const edge = findEdge(getSource(), selectedEdge);
      const next = reverseEdge(getSource(), selectedEdge);
      if (next === null) return (enote.textContent = "This arrow is shared with others (a & b). Please change it in the code.");
      change(next);
      // Its drawn id follows the new direction.
      const again = edge && findEdgeBetween(edge.to, edge.from, edge.edgeId, edge.source.from);
      return again ? openEdge(again) : closeEdge();
    }
    syncEdge();
  });

  // After reversing, the arrow's drawn id changes: find it near where it was.
  function findEdgeBetween(from, to, edgeId, near) {
    if (edgeId) return edgeId;
    const matches = listEdges(getSource()).filter((e) => e.from === from && e.to === to);
    matches.sort((a, b) => Math.abs(a.source.from - near) - Math.abs(b.source.from - near));
    return matches[0]?.id || null;
  }

  function removeEdge() {
    if (!selectedEdge) return;
    const next = deleteEdge(getSource(), selectedEdge);
    if (next === null) {
      enote.textContent = "This arrow is shared with others (a & b). Please change it in the code.";
      return;
    }
    closeEdge();
    change(next);
  }

  function edgeElements(id) {
    return [...canvas.querySelectorAll("path[data-edge]")].filter((p) => p.dataset.id === id);
  }

  function syncEdge() {
    const edge = selectedEdge && findEdge(getSource(), selectedEdge);
    if (!edge) return closeEdge();
    ehead.textContent = `Arrow ${edge.from} → ${edge.to}`;
    if (doc.activeElement !== einput) einput.value = edge.label;
    epop.querySelectorAll("button[data-line]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.line === edge.line)));
    epop.querySelectorAll("button[data-end]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.end === edge.end)));
    canvas.querySelectorAll("path.mf-edge-selected").forEach((p) => p.classList.remove("mf-edge-selected"));
    const els = edgeElements(selectedEdge);
    els.forEach((p) => p.classList.add("mf-edge-selected"));
    const label = [...canvas.querySelectorAll(".edgeLabel [data-id]")].find((l) => l.dataset.id === selectedEdge);
    const anchor = label && label.getBoundingClientRect().width ? label : els[0];
    if (anchor) placePop(epop, anchor);
  }

  function openEdge(id) {
    if (!findEdge(getSource(), id)) return;
    close();
    selectedEdge = id;
    enote.textContent = "";
    epop.hidden = false;
    syncEdge();
  }

  function closeEdge() {
    selectedEdge = null;
    epop.hidden = true;
    canvas.querySelectorAll("path.mf-edge-selected").forEach((p) => p.classList.remove("mf-edge-selected"));
  }

  // Thin lines are hard to hit: lay a wide invisible copy over each arrow.
  function addEdgeHitAreas() {
    for (const p of canvas.querySelectorAll("path[data-edge]")) {
      if (p.nextElementSibling?.classList.contains("mf-edge-hit")) continue;
      const hit = p.cloneNode(false);
      hit.removeAttribute("id");
      hit.removeAttribute("marker-start");
      hit.removeAttribute("marker-end");
      hit.removeAttribute("data-edge");
      hit.removeAttribute("style");
      hit.setAttribute("class", "mf-edge-hit");
      p.after(hit);
    }
  }

  function edgeIdAt(target) {
    const hit = target.closest?.(".mf-edge-hit, path[data-edge], .edgeLabel [data-id]");
    return hit && canvas.contains(hit) ? hit.dataset.id || null : null;
  }

  // "+" handles on the four sides of the shape under the pointer (or the selected one).
  const handles = {};
  for (const side of SIDES) {
    const h = doc.createElement("button");
    h.type = "button";
    h.className = "mf-handle";
    h.dataset.mfUi = "";
    h.dataset.side = side;
    h.hidden = true;
    h.title = "Click to add a shape, or drag to another shape to connect";
    h.setAttribute("aria-label", `Add a shape (${side})`);
    h.innerHTML = PLUS;
    viewport.append(h);
    handles[side] = h;
  }
  const dragLine = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  dragLine.classList.add("mf-drag-line");
  dragLine.setAttribute("hidden", "");
  dragLine.innerHTML = '<line/><circle r="4"/>';
  viewport.append(dragLine);

  // "+ Shape": a new shape on its own (or a new flowchart when the code is empty).
  const addButton = doc.createElement("button");
  addButton.type = "button";
  addButton.className = "mf-add-shape";
  addButton.title = "Add a shape that isn't joined to anything yet";
  addButton.innerHTML = `${PLUS}<span>Shape</span>`;
  // Which way the flowchart flows, beside it.
  const dirGroup = doc.createElement("div");
  dirGroup.className = "mf-dir";
  dirGroup.setAttribute("role", "group");
  dirGroup.setAttribute("aria-label", "Direction");
  const DIRS = [
    ["TD", "Top to bottom", "M8 2.5v11M4 9.5l4 4 4-4"],
    ["LR", "Left to right", "M2.5 8h11M9.5 4l4 4-4 4"],
    ["BT", "Bottom to top", "M8 13.5v-11M4 6.5l4-4 4 4"],
    ["RL", "Right to left", "M13.5 8h-11M6.5 4l-4 4 4 4"],
  ];
  dirGroup.innerHTML = DIRS.map(([d, label, path]) => `<button type="button" data-dir="${d}" title="${label}" aria-label="${label}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="${path}"/></svg></button>`).join("");
  dirGroup.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-dir]");
    if (b) change(setDirection(getSource(), b.dataset.dir));
  });
  const bar = doc.createElement("div");
  bar.className = "mf-canvas-bar";
  bar.dataset.mfUi = "";
  bar.append(addButton, dirGroup);
  viewport.append(bar);
  for (const type of ["pointerdown", "mousedown", "click", "dblclick"]) {
    bar.addEventListener(type, (e) => e.stopPropagation());
  }
  addButton.addEventListener("click", () => {
    const { source, id } = addNode(getSource());
    change(source);
    open(id, { focusText: true });
  });
  const editable = () => isFlowchart(getSource()) || !getSource().trim();
  const syncAddButton = () => {
    bar.hidden = !editable();
    const flow = isFlowchart(getSource());
    dirGroup.hidden = !flow;
    dirGroup.style.display = flow ? "" : "none";
    const dir = flow ? flowDirection(getSource()) : "";
    dirGroup.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.dir === "TD" ? "TB" : b.dataset.dir) === dir)));
  };
  syncAddButton();

  // Opening "Colours and border" makes the popover taller: keep it on screen.
  pop.querySelector(".mf-node-pop-more").addEventListener("toggle", () => {
    const el = selected && nodeElement(selected);
    if (el) place(el);
  });

  // Keep clicks, drags and wheel in the popover away from pan/zoom and hosts.
  for (const type of ["pointerdown", "mousedown", "click", "dblclick", "wheel", "keydown"]) {
    pop.addEventListener(type, (e) => e.stopPropagation());
  }

  const change = (next) => {
    if (next !== getSource()) setSource(next);
  };

  input.addEventListener("input", () => {
    if (selected) change(setNodeText(getSource(), selected, input.value));
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      close();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  });
  pop.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
  pop.querySelector(".mf-node-pop-close").addEventListener("click", () => close());
  shapes.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-shape]");
    if (!b || !selected) return;
    change(setNodeShape(getSource(), selected, b.dataset.shape));
    markShape(b.dataset.shape);
  });
  pop.querySelector("[data-delete]").addEventListener("click", () => removeSelected());
  pop.querySelector("[data-add]").addEventListener("click", () => {
    if (!selected) return;
    const { source, id } = addConnectedNode(getSource(), selected, { text: "New step", shape: "rect" });
    change(source);
    // Select the new node (highlighted once it's drawn), ready to type its text.
    open(id, { focusText: true });
  });

  function removeSelected() {
    if (!selected) return;
    const next = deleteNode(getSource(), selected);
    if (next === null) {
      note.textContent = "This line is too unusual to change here. Please delete it in the code.";
      return;
    }
    close();
    hover = null;
    change(next);
    showHandles();
  }

  // ---------------------------------------------------------------- handles

  let hover = null; // node id under the pointer
  let hideTimer = 0;
  let drag = null; // a handle being dragged

  function handleNode() {
    return drag?.from || hover || selected;
  }

  function showHandles() {
    const id = handleNode();
    const el = id && isFlowchart(getSource()) ? nodeElement(id) : null;
    if (!el) {
      for (const h of Object.values(handles)) h.hidden = true;
      return;
    }
    const vr = viewport.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const gap = 14;
    const cx = r.left + r.width / 2 - vr.left + viewport.scrollLeft;
    const cy = r.top + r.height / 2 - vr.top + viewport.scrollTop;
    const at = {
      top: [cx, r.top - vr.top + viewport.scrollTop - gap],
      bottom: [cx, r.bottom - vr.top + viewport.scrollTop + gap],
      left: [r.left - vr.left + viewport.scrollLeft - gap, cy],
      right: [r.right - vr.left + viewport.scrollLeft + gap, cy],
    };
    for (const side of SIDES) {
      const h = handles[side];
      h.hidden = !!drag && drag.side !== side;
      h.style.left = `${at[side][0]}px`;
      h.style.top = `${at[side][1]}px`;
    }
  }

  const onOver = (e) => {
    if (drag) return;
    if (e.target.closest?.(".mf-handle")) {
      clearTimeout(hideTimer);
      return;
    }
    const g = e.target.closest?.("g.node");
    const id = g && canvas.contains(g) ? nodeIdFromElement(g) : null;
    if (id) {
      clearTimeout(hideTimer);
      if (id !== hover) {
        hover = id;
        showHandles();
      }
    } else if (hover) {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        hover = null;
        showHandles();
      }, 350);
    }
  };
  viewport.addEventListener("pointerover", onOver);

  function nodeAt(x, y) {
    const g = doc.elementFromPoint(x, y)?.closest?.("g.node");
    return g && canvas.contains(g) ? nodeIdFromElement(g) : null;
  }

  function markDropTarget(id) {
    canvas.querySelectorAll("g.node.mf-drop-target").forEach((g) => g.classList.remove("mf-drop-target"));
    if (id) nodeElement(id)?.classList.add("mf-drop-target");
  }

  for (const side of SIDES) {
    const h = handles[side];
    h.addEventListener("click", (e) => e.stopPropagation());
    h.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      const from = handleNode();
      if (!from) return;
      h.setPointerCapture(e.pointerId);
      const vr = viewport.getBoundingClientRect();
      drag = { from, side, x: e.clientX, y: e.clientY, moved: false, target: null, vr };
    });
    h.addEventListener("pointermove", (e) => {
      if (!drag) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) {
        drag.moved = true;
        dragLine.removeAttribute("hidden");
        showHandles();
      }
      if (!drag.moved) return;
      const { vr } = drag;
      const hr = h.getBoundingClientRect();
      const line = dragLine.querySelector("line");
      const dot = dragLine.querySelector("circle");
      const sx = hr.left + hr.width / 2 - vr.left;
      const sy = hr.top + hr.height / 2 - vr.top;
      const ex = e.clientX - vr.left;
      const ey = e.clientY - vr.top;
      line.setAttribute("x1", sx);
      line.setAttribute("y1", sy);
      line.setAttribute("x2", ex);
      line.setAttribute("y2", ey);
      dot.setAttribute("cx", ex);
      dot.setAttribute("cy", ey);
      dragLine.style.left = `${viewport.scrollLeft}px`;
      dragLine.style.top = `${viewport.scrollTop}px`;
      const target = nodeAt(e.clientX, e.clientY);
      drag.target = target && target !== drag.from ? target : null;
      markDropTarget(drag.target);
    });
    const finish = (e, cancelled) => {
      if (!drag) return;
      const { from, moved, target } = drag;
      drag = null;
      dragLine.setAttribute("hidden", "");
      markDropTarget(null);
      if (h.hasPointerCapture?.(e.pointerId)) h.releasePointerCapture(e.pointerId);
      if (cancelled) return showHandles();
      if (moved && target) {
        // Dropped on another shape: join them.
        change(connectNodes(getSource(), from, target));
        open(from);
      } else if (moved && nodeAt(e.clientX, e.clientY) === from) {
        showHandles(); // dropped back where it started
      } else {
        // A click, or a drop on empty space: a new shape on that side.
        const before = side === UPSTREAM[flowDirection(getSource())];
        const { source, id } = addConnectedNode(getSource(), from, { text: "New step", shape: "rect", before });
        change(source);
        hover = null;
        open(id, { focusText: true });
      }
      showHandles();
    };
    h.addEventListener("pointerup", (e) => finish(e, false));
    h.addEventListener("pointercancel", (e) => finish(e, true));
  }

  function markShape(shape) {
    shapes.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.shape === shape)));
  }

  function nodeElement(id) {
    return [...canvas.querySelectorAll("g.node")].find((g) => nodeIdFromElement(g) === id) || null;
  }

  function highlight() {
    canvas.querySelectorAll("g.node.mf-selected").forEach((g) => g.classList.remove("mf-selected"));
    const el = selected && nodeElement(selected);
    el?.classList.add("mf-selected");
    return el;
  }

  function place(el) {
    placePop(pop, el);
  }

  function placePop(pop, el) {
    if (!el) return;
    const vr = viewport.getBoundingClientRect();
    const nr = el.getBoundingClientRect();
    const width = pop.offsetWidth || 264;
    const height = pop.offsetHeight || 170;
    const scrollX = viewport.scrollLeft;
    const scrollY = viewport.scrollTop;
    // Beside the node (right, else left), else under it.
    let left = nr.right - vr.left + 10;
    let top = nr.top - vr.top;
    if (left + width > vr.width - 4) left = nr.left - vr.left - width - 10;
    if (left < 4) {
      left = Math.max(4, Math.min(vr.width - width - 4, nr.left - vr.left));
      top = nr.bottom - vr.top + 8;
    }
    top = Math.max(4, Math.min(top, Math.max(4, vr.height - height - 4)));
    pop.style.left = `${left + scrollX}px`;
    pop.style.top = `${top + scrollY}px`;
  }

  function open(id, { focusText = false } = {}) {
    const node = findNode(getSource(), id);
    if (!node) return close();
    if (selectedEdge) closeEdge();
    selected = id;
    note.textContent = "";
    head.textContent = `Shape ${id}`;
    if (doc.activeElement !== input || focusText) input.value = node.text;
    markShape(node.shape);
    syncStyle();
    pop.hidden = false;
    place(highlight());
    showHandles();
    if (focusText) {
      input.focus();
      input.select();
    }
  }

  function close() {
    selected = null;
    pop.hidden = true;
    highlight();
    showHandles();
  }

  // A click (not a drag) on a node opens it; on empty space closes.
  let down = null;
  const onDown = (e) => {
    // Not on the popover or other controls over the drawing (the zoom toolbar).
    if (e.button !== 0 || pop.contains(e.target) || e.target.closest?.("[data-mf-ui]")) return (down = null);
    if (epop.contains(e.target)) return (down = null);
    const g = e.target.closest?.("g.node");
    const id = g && canvas.contains(g) ? nodeIdFromElement(g) : null;
    down = { x: e.clientX, y: e.clientY, id, edge: id ? null : edgeIdAt(e.target) };
  };
  const onUp = (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4;
    const { id, edge } = down;
    down = null;
    if (moved || !isFlowchart(getSource())) return;
    if (id) open(id);
    else if (edge) openEdge(edge);
    else {
      if (selected) close();
      if (selectedEdge) closeEdge();
    }
  };
  // Capture, so this sees the press before pan/zoom takes the pointer.
  viewport.addEventListener("pointerdown", onDown, true);
  viewport.addEventListener("pointerup", onUp, true);
  // A click on a node shouldn't also count as a click on whatever hosts the drawing.
  const onClick = (e) => {
    if ((e.target.closest?.("g.node") || edgeIdAt(e.target)) && isFlowchart(getSource())) e.stopPropagation();
  };
  viewport.addEventListener("click", onClick, true);
  // Double-click a shape to type its text straight away.
  const onDblClick = (e) => {
    const g = e.target.closest?.("g.node");
    if (!g || !canvas.contains(g) || !isFlowchart(getSource())) return;
    e.preventDefault();
    e.stopPropagation();
    open(nodeIdFromElement(g), { focusText: true });
  };
  viewport.addEventListener("dblclick", onDblClick, true);
  // Delete or Backspace removes the selected shape, unless the writer is typing.
  const onKey = (e) => {
    if (!(selected || selectedEdge) || !["Delete", "Backspace", "Escape"].includes(e.key)) return;
    const t = doc.activeElement;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    e.preventDefault();
    if (selectedEdge) return e.key === "Escape" ? closeEdge() : removeEdge();
    if (e.key === "Escape") close();
    else removeSelected();
  };
  doc.addEventListener("keydown", onKey);

  return {
    /** Call after the drawing is replaced. */
    refresh() {
      syncAddButton();
      addEdgeHitAreas();
      showHandles();
      if (selectedEdge) {
        if (!isFlowchart(getSource())) closeEdge();
        else syncEdge();
      }
      if (!selected) return;
      if (!isFlowchart(getSource())) return close();
      const node = findNode(getSource(), selected);
      if (!node) return close();
      if (doc.activeElement !== input) input.value = node.text;
      markShape(node.shape);
      syncStyle();
      const el = highlight();
      if (el) place(el);
    },
    /** Open the editor on node `id`. */
    select: (id, opts) => open(id, opts),
    close,
    get selected() {
      return selected;
    },
    get isOpen() {
      return !pop.hidden;
    },
    destroy() {
      viewport.removeEventListener("pointerdown", onDown, true);
      viewport.removeEventListener("pointerup", onUp, true);
      viewport.removeEventListener("click", onClick, true);
      viewport.removeEventListener("dblclick", onDblClick, true);
      viewport.removeEventListener("pointerover", onOver);
      doc.removeEventListener("keydown", onKey);
      viewport.classList.remove("mf-canvas-edit");
      pop.remove();
      epop.remove();
      bar.remove();
      dragLine.remove();
      for (const h of Object.values(handles)) h.remove();
    },
  };
}
