// Editing a flowchart from the drawing: click a node to change its text or
// shape, or to add a node joined to it. Every change is made to the source
// (see flowchart-edit.js) and the host re-renders as it would for typing.

import { SHAPES, addConnectedNode, findNode, isFlowchart, nodeIdFromElement, setNodeShape, setNodeText } from "./flowchart-edit.js";

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
  position: absolute; z-index: 20; width: 248px; box-sizing: border-box; padding: 10px;
  background: var(--mf-pop-bg, var(--surface, #fff)); color: var(--mf-pop-text, var(--text, #1d2330));
  border: 1px solid var(--mf-pop-border, var(--border, #d9dde4)); border-radius: 10px;
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
`;

function injectStyle(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.append(style);
}

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
    <div class="mf-node-pop-add">
      <button type="button" data-add title="Add a shape joined to this one with an arrow">+ Add connected shape</button>
    </div>`;
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
  viewport.append(pop);

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
  pop.querySelector("[data-add]").addEventListener("click", () => {
    if (!selected) return;
    const { source, id } = addConnectedNode(getSource(), selected, { text: "New step", shape: "rect" });
    change(source);
    // Select the new node (highlighted once it's drawn), ready to type its text.
    open(id, { focusText: true });
  });

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
    if (!el) return;
    const vr = viewport.getBoundingClientRect();
    const nr = el.getBoundingClientRect();
    const width = pop.offsetWidth || 248;
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
    selected = id;
    head.textContent = `Shape ${id}`;
    if (doc.activeElement !== input || focusText) input.value = node.text;
    markShape(node.shape);
    pop.hidden = false;
    place(highlight());
    if (focusText) {
      input.focus();
      input.select();
    }
  }

  function close() {
    selected = null;
    pop.hidden = true;
    highlight();
  }

  // A click (not a drag) on a node opens it; on empty space closes.
  let down = null;
  const onDown = (e) => {
    // Not on the popover or other controls over the drawing (the zoom toolbar).
    if (e.button !== 0 || pop.contains(e.target) || e.target.closest?.("[data-mf-ui]")) return (down = null);
    const g = e.target.closest?.("g.node");
    down = { x: e.clientX, y: e.clientY, id: g && canvas.contains(g) ? nodeIdFromElement(g) : null };
  };
  const onUp = (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4;
    const { id } = down;
    down = null;
    if (moved || !isFlowchart(getSource())) return;
    if (id) open(id);
    else if (selected) close();
  };
  // Capture, so this sees the press before pan/zoom takes the pointer.
  viewport.addEventListener("pointerdown", onDown, true);
  viewport.addEventListener("pointerup", onUp, true);
  // A click on a node shouldn't also count as a click on whatever hosts the drawing.
  const onClick = (e) => {
    if (e.target.closest?.("g.node") && isFlowchart(getSource())) e.stopPropagation();
  };
  viewport.addEventListener("click", onClick, true);

  return {
    /** Call after the drawing is replaced. */
    refresh() {
      if (!selected) return;
      if (!isFlowchart(getSource())) return close();
      const node = findNode(getSource(), selected);
      if (!node) return close();
      if (doc.activeElement !== input) input.value = node.text;
      markShape(node.shape);
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
      viewport.classList.remove("mf-canvas-edit");
      pop.remove();
    },
  };
}
