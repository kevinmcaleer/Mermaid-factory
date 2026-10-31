// Editing a flowchart from the drawing: click a node to change its text or
// shape, or to add a node joined to it. Every change is made to the source
// (see flowchart-edit.js) and the host re-renders as it would for typing.

import {
  SHAPES,
  addConnectedNode,
  addNode,
  connectNodes,
  deleteNode,
  findNode,
  flowDirection,
  isFlowchart,
  nodeIdFromElement,
  setNodeShape,
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
.mf-node-pop-add button.mf-node-pop-delete { flex: none; color: var(--mf-danger, #c62828); }
.mf-node-pop-add button.mf-node-pop-delete:hover { border-color: currentColor; }
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
.mf-add-shape {
  position: absolute; left: 10px; top: 10px; z-index: 15; display: flex; align-items: center; gap: 5px;
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
  viewport.append(pop);

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
  addButton.dataset.mfUi = "";
  addButton.title = "Add a shape that isn't joined to anything yet";
  addButton.innerHTML = `${PLUS}<span>Shape</span>`;
  viewport.append(addButton);
  for (const type of ["pointerdown", "mousedown", "click", "dblclick"]) {
    addButton.addEventListener(type, (e) => e.stopPropagation());
  }
  addButton.addEventListener("click", () => {
    const { source, id } = addNode(getSource());
    change(source);
    open(id, { focusText: true });
  });
  const editable = () => isFlowchart(getSource()) || !getSource().trim();
  const syncAddButton = () => (addButton.hidden = !editable());
  syncAddButton();

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
    note.textContent = "";
    head.textContent = `Shape ${id}`;
    if (doc.activeElement !== input || focusText) input.value = node.text;
    markShape(node.shape);
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
    if (!selected || pop.hidden || !["Delete", "Backspace", "Escape"].includes(e.key)) return;
    const t = doc.activeElement;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    e.preventDefault();
    if (e.key === "Escape") close();
    else removeSelected();
  };
  doc.addEventListener("keydown", onKey);

  return {
    /** Call after the drawing is replaced. */
    refresh() {
      syncAddButton();
      showHandles();
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
      viewport.removeEventListener("dblclick", onDblClick, true);
      viewport.removeEventListener("pointerover", onOver);
      doc.removeEventListener("keydown", onKey);
      viewport.classList.remove("mf-canvas-edit");
      pop.remove();
      addButton.remove();
      dragLine.remove();
      for (const h of Object.values(handles)) h.remove();
    },
  };
}
