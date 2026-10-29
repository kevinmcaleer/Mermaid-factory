// Minimal pan and zoom for the preview: Ctrl/⌘ + wheel zooms around the
// cursor, plain wheel scrolls, dragging pans. The transform survives
// re-renders so editing doesn't reset the viewport.
//
// Options: `wheelPans: false` leaves a plain wheel to the page (for a view
// embedded in a document); `keepFitted: true` refits new content while the
// view is still "fitted" (nobody has zoomed or panned since the last fit).

const MIN = 0.1;
const MAX = 8;

export class PanZoom {
  constructor(viewport, canvas, { onChange, wheelPans = true, keepFitted = false } = {}) {
    this.viewport = viewport;
    this.canvas = canvas;
    this.onChange = onChange || (() => {});
    this.wheelPans = wheelPans;
    this.keepFitted = keepFitted;
    this.fitted = false;
    this.scale = 1;
    this.x = 0;
    this.y = 0;
    this.content = { width: 0, height: 0 };
    this.hasContent = false;
    this.#wire();
  }

  #apply() {
    this.canvas.style.transform = `translate(${this.x}px, ${this.y}px) scale(${this.scale})`;
    this.onChange(this.scale);
  }

  #wire() {
    const vp = this.viewport;
    vp.addEventListener(
      "wheel",
      (e) => {
        if (!this.hasContent) return;
        if (!this.wheelPans && !(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
          const rect = vp.getBoundingClientRect();
          const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
          this.zoomAt(this.scale * factor, e.clientX - rect.left, e.clientY - rect.top);
        } else {
          this.x -= e.deltaX;
          this.y -= e.deltaY;
          this.fitted = false;
          this.#apply();
        }
      },
      { passive: false },
    );

    let drag = null;
    vp.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !this.hasContent) return;
      drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: this.x, y: this.y };
      vp.setPointerCapture(e.pointerId);
      vp.classList.add("panning");
    });
    vp.addEventListener("pointermove", (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      this.x = drag.x + (e.clientX - drag.sx);
      this.y = drag.y + (e.clientY - drag.sy);
      if (e.clientX !== drag.sx || e.clientY !== drag.sy) this.fitted = false;
      this.#apply();
    });
    const end = (e) => {
      if (drag && drag.id === e.pointerId) {
        drag = null;
        vp.classList.remove("panning");
      }
    };
    vp.addEventListener("pointerup", end);
    vp.addEventListener("pointercancel", end);
    vp.addEventListener("dblclick", () => this.fit());
  }

  zoomAt(scale, cx, cy) {
    const next = Math.min(MAX, Math.max(MIN, scale));
    // Keep the point under the cursor fixed.
    this.x = cx - ((cx - this.x) * next) / this.scale;
    this.y = cy - ((cy - this.y) * next) / this.scale;
    this.scale = next;
    this.fitted = false;
    this.#apply();
  }

  zoomBy(factor) {
    const rect = this.viewport.getBoundingClientRect();
    this.zoomAt(this.scale * factor, rect.width / 2, rect.height / 2);
  }

  fit() {
    const rect = this.viewport.getBoundingClientRect();
    const { width, height } = this.content;
    // Not laid out yet: stay "fitted" so the next resize or content fits it.
    if (!width || !height || !rect.width || !rect.height) return void (this.fitted = true);
    const pad = 24;
    const scale = Math.min((rect.width - pad * 2) / width, (rect.height - pad * 2) / height, 2);
    this.scale = Math.max(MIN, scale);
    this.x = (rect.width - width * this.scale) / 2;
    this.y = (rect.height - height * this.scale) / 2;
    this.fitted = true;
    this.#apply();
  }

  reset() {
    const rect = this.viewport.getBoundingClientRect();
    const { width, height } = this.content;
    this.scale = 1;
    this.x = Math.max(16, (rect.width - width) / 2);
    this.y = Math.max(16, (rect.height - height) / 2);
    this.fitted = false;
    this.#apply();
  }

  /** Call after new content is placed in the canvas. The first time, the
   *  view is fitted; afterwards the current pan/zoom is kept (or, with
   *  keepFitted, refitted while the view is fitted). */
  setContent(size) {
    const first = !this.hasContent;
    this.content = size;
    this.hasContent = true;
    if (first || (this.keepFitted && this.fitted)) this.fit();
    else this.#apply();
  }

  clear() {
    this.hasContent = false;
  }
}
