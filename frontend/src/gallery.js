// "New diagram" gallery: live thumbnails of each template, plus a filter box.

import { readJson } from "./common.js";
import { lazyThumb, thumbObserver } from "./thumbs.js";

const templates = readJson("gallery-data") || [];
const bySlug = new Map(templates.map((t) => [t.slug, t]));
const observer = thumbObserver();

document.querySelectorAll(".gcard-thumb[data-slug]").forEach((el) => {
  const t = bySlug.get(el.dataset.slug);
  if (t) lazyThumb(observer, el.querySelector(".thumb-inner"), { source: t.source, theme: "default", config: {} });
});

const search = document.getElementById("gallery-search");
search?.addEventListener("input", () => {
  const q = search.value.trim().toLowerCase();
  document.querySelectorAll(".gcard").forEach((card) => {
    card.hidden = q !== "" && !card.dataset.name.includes(q);
  });
});
