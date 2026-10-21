// Lazily render small diagram previews as cards scroll into view.

import { renderMermaid, themeBackground } from "./render.js";
import { storage } from "./common.js";

const PREFIX = "mf-thumb-";

/** Watch `el`; when visible, fill it with the rendered diagram.
 *  `cacheKey` (optional) caches the SVG in localStorage. */
export function lazyThumb(observer, el, item) {
  el._thumb = item;
  observer.observe(el);
}

export function thumbObserver() {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        fill(entry.target);
      }
    },
    { rootMargin: "200px" },
  );
  return observer;
}

async function fill(el) {
  const { source, theme, config, cacheKey } = el._thumb;
  el.style.background = themeBackground(theme);
  if (cacheKey) {
    const cached = storage.get(PREFIX + cacheKey);
    if (typeof cached === "string") {
      el.innerHTML = cached;
      return;
    }
  }
  if (!source.trim()) {
    el.innerHTML = '<span class="thumb-error">Empty</span>';
    return;
  }
  try {
    const { svg } = await renderMermaid(source, { theme, config });
    el.innerHTML = svg;
    if (cacheKey && svg.length < 200_000) {
      const id = cacheKey.split(":")[0];
      for (const key of storage.keys(PREFIX + id + ":")) storage.remove(key);
      if (!storage.set(PREFIX + cacheKey, svg)) {
        // Storage full: drop all cached thumbnails and carry on.
        for (const key of storage.keys(PREFIX)) storage.remove(key);
      }
    }
  } catch {
    el.innerHTML = '<span class="thumb-error">Doesn\'t render</span>';
  }
}
