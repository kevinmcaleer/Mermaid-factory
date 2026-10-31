// A small floating toolbar over a pan/zoom view: zoom to fit, zoom out, the
// zoom level (click it to switch between 100% and fit) and zoom in, and
// optionally a background picker (none, blue or black blueprint).

import { BACKGROUNDS, paperFor } from "./backdrop.js";

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
.mf-bg-swatch {
  display: inline-block; width: 15px; height: 15px; border-radius: 4px; flex: none;
  border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
  background-color: #fff;
  background-image: linear-gradient(45deg, #d5d9e0 25%, transparent 25%, transparent 75%, #d5d9e0 75%),
    linear-gradient(45deg, #d5d9e0 25%, transparent 25%, transparent 75%, #d5d9e0 75%);
  background-size: 6px 6px; background-position: 0 0, 3px 3px;
}
.mf-bg-swatch[data-bg="blueprint"], .mf-bg-swatch[data-bg="blueprint-dark"] {
  background-image: linear-gradient(rgb(255 255 255 / 30%) 1px, transparent 1px),
    linear-gradient(90deg, rgb(255 255 255 / 30%) 1px, transparent 1px);
  background-size: 4px 4px; background-position: -1px -1px;
}
.mf-bg-swatch[data-bg="blueprint"] { background-color: #1f4f8f; }
.mf-bg-swatch[data-bg="blueprint-dark"] { background-color: #121519; }
.mf-bg-menu {
  position: absolute; right: 0; bottom: calc(100% + 6px); display: grid; gap: 1px; min-width: 168px; padding: 4px;
  border: 1px solid var(--mf-pop-border, var(--border, #d9dde4)); border-radius: 9px;
  background: var(--mf-pop-bg, var(--surface, #fff)); box-shadow: 0 4px 16px rgb(0 0 0 / 16%);
}
.mf-bg-menu[hidden] { display: none; }
.mf-bg-menu-title { padding: 5px 8px 4px; opacity: 0.65; font-size: 11px; }
.mf-zoom .mf-bg-menu button { display: flex; justify-content: flex-start; gap: 8px; width: 100%; height: 28px; padding: 0 8px; }
.mf-zoom .mf-bg-menu button[aria-checked="true"] { background: color-mix(in srgb, var(--mf-select, #2563eb) 14%, transparent); font-weight: 600; }
`;

const FIT = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 5.5V2h3.5M10.5 2H14v3.5M14 10.5V14h-3.5M5.5 14H2v-3.5"/></svg>';
const MINUS = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8h9"/></svg>';
const PLUS = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8h9M8 3.5v9"/></svg>';

const labelOf = (value) => (BACKGROUNDS.find((b) => b.value === value) || BACKGROUNDS[0]).label;

/**
 * Puts the toolbar in `viewport` (positioned) for `panzoom`. Call
 * `update(scale)` when the zoom changes. With `background: { value, onChange }`
 * it also has a background picker; `setBackground(value)` shows a new value.
 */
export function attachZoomToolbar(viewport, panzoom, { background } = {}) {
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
  let setBackground = () => {};
  if (background) {
    const wrap = doc.createElement("span");
    wrap.style.cssText = "position: relative; display: flex; align-items: center; gap: 2px";
    wrap.innerHTML = `
      <span class="mf-zoom-sep" aria-hidden="true"></span>
      <button type="button" class="mf-bg-toggle" aria-haspopup="menu" aria-expanded="false"><span class="mf-bg-swatch"></span></button>
      <div class="mf-bg-menu" role="menu" aria-label="Background" hidden>
        <div class="mf-bg-menu-title">Background</div>
        ${BACKGROUNDS.map(
          (b) => `<button type="button" role="menuitemradio" data-bg="${b.value}" aria-checked="false"><span class="mf-bg-swatch" data-bg="${b.value}"></span>${b.label}</button>`,
        ).join("")}
      </div>`;
    bar.append(wrap);
    const toggle = wrap.querySelector(".mf-bg-toggle");
    const menu = wrap.querySelector(".mf-bg-menu");
    let current = "";
    setBackground = (value) => {
      current = paperFor(value) ? value : "";
      toggle.querySelector(".mf-bg-swatch").dataset.bg = current;
      toggle.title = `Background: ${labelOf(current)}`;
      toggle.setAttribute("aria-label", toggle.title);
      for (const item of menu.querySelectorAll("[data-bg]")) item.setAttribute("aria-checked", String(item.dataset.bg === current));
    };
    const close = () => {
      menu.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      doc.removeEventListener("pointerdown", outside, true);
    };
    const outside = (e) => {
      if (!wrap.contains(e.target)) close();
    };
    toggle.addEventListener("click", () => {
      if (!menu.hidden) return close();
      menu.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
      doc.addEventListener("pointerdown", outside, true);
      menu.querySelector('[aria-checked="true"]')?.focus();
    });
    menu.addEventListener("click", (e) => {
      const item = e.target.closest("button[data-bg]");
      if (!item) return;
      close();
      toggle.focus();
      if (item.dataset.bg === current) return;
      setBackground(item.dataset.bg);
      background.onChange?.(current);
    });
    menu.addEventListener("keydown", (e) => {
      const items = [...menu.querySelectorAll("button[data-bg]")];
      const at = items.indexOf(doc.activeElement);
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        toggle.focus();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        items[(at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length].focus();
      }
    });
    setBackground(background.value);
  }
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
  return { element: bar, update, setBackground: (value) => setBackground(value), destroy: () => bar.remove() };
}
