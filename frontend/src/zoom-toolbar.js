// A small floating toolbar over a pan/zoom view: zoom to fit, zoom out, the
// zoom level (click it to switch between 100% and fit) and zoom in.

const STYLE_ID = "mf-zoom-style";
const CSS = `
.mf-zoom {
  position: absolute; right: 10px; bottom: 10px; z-index: 15; display: flex; align-items: center; gap: 2px;
  padding: 3px; border: 1px solid var(--mf-pop-border, var(--border, #d9dde4)); border-radius: 9px;
  background: var(--mf-pop-bg, var(--surface, #fff)); color: var(--mf-pop-text, var(--text, #1d2330));
  box-shadow: 0 2px 10px rgb(0 0 0 / 12%); font: 12px/1 var(--mf-pop-font, system-ui, sans-serif);
  white-space: nowrap; cursor: default; user-select: none;
}
.mf-zoom button {
  display: grid; place-items: center; min-width: 28px; height: 26px; padding: 0 6px; border: 0; border-radius: 6px;
  background: none; color: inherit; font: inherit; cursor: pointer;
}
.mf-zoom button:hover { background: color-mix(in srgb, currentColor 10%, transparent); }
.mf-zoom button:focus-visible { outline: 2px solid var(--mf-select, #2563eb); outline-offset: -2px; }
.mf-zoom svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; }
.mf-zoom-level { min-width: 46px !important; font-variant-numeric: tabular-nums; }
.mf-zoom-sep { width: 1px; height: 16px; margin: 0 2px; background: var(--mf-pop-border, var(--border, #d9dde4)); }
`;

const FIT = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 5.5V2h3.5M10.5 2H14v3.5M14 10.5V14h-3.5M5.5 14H2v-3.5"/></svg>';
const MINUS = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8h9"/></svg>';
const PLUS = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8h9M8 3.5v9"/></svg>';

/** Puts the toolbar in `viewport` (positioned) for `panzoom`. Call `update(scale)` when the zoom changes. */
export function attachZoomToolbar(viewport, panzoom) {
  const doc = viewport.ownerDocument;
  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    doc.head.append(style);
  }
  const bar = doc.createElement("div");
  bar.className = "mf-zoom";
  bar.dataset.mfUi = "";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Zoom");
  bar.innerHTML = `
    <button type="button" data-zoom="fit" title="Zoom to fit" aria-label="Zoom to fit">${FIT}</button>
    <span class="mf-zoom-sep" aria-hidden="true"></span>
    <button type="button" data-zoom="out" title="Zoom out" aria-label="Zoom out">${MINUS}</button>
    <button type="button" data-zoom="toggle" class="mf-zoom-level" title="100% / zoom to fit">100%</button>
    <button type="button" data-zoom="in" title="Zoom in" aria-label="Zoom in">${PLUS}</button>`;
  const level = bar.querySelector(".mf-zoom-level");
  // Keep presses on the toolbar from panning the view or reaching the host.
  for (const type of ["pointerdown", "mousedown", "click", "dblclick", "wheel"]) {
    bar.addEventListener(type, (e) => e.stopPropagation());
  }
  bar.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-zoom]");
    if (!b || !panzoom.hasContent) return;
    const z = b.dataset.zoom;
    if (z === "in") panzoom.zoomBy(1.25);
    else if (z === "out") panzoom.zoomBy(0.8);
    else if (z === "fit") panzoom.fit();
    else if (Math.abs(panzoom.scale - 1) < 0.005) panzoom.fit();
    else panzoom.reset();
  });
  viewport.append(bar);
  const update = (scale) => {
    level.textContent = `${Math.round(scale * 100)}%`;
    level.setAttribute("aria-label", `Zoom ${level.textContent}: switch between 100% and zoom to fit`);
  };
  update(panzoom.scale);
  return { element: bar, update, destroy: () => bar.remove() };
}
