// Public read-only share page.

import { copyWithToast, markdownFence, readJson } from "./common.js";
import { errorMessage, renderMermaid, themeBackground } from "./render.js";
import { setupExportDialog } from "./exporter.js";

const diagram = readJson("diagram-data");
const preview = document.getElementById("preview");

renderMermaid(diagram.source, { theme: diagram.theme, config: diagram.config })
  .then(({ svg, bindFunctions }) => {
    preview.innerHTML = svg;
    preview.style.background = themeBackground(diagram.theme);
    bindFunctions?.(preview);
  })
  .catch((err) => {
    const box = document.getElementById("render-error");
    box.textContent = errorMessage(err);
    box.hidden = false;
    preview.hidden = true;
  });

const openExport = setupExportDialog(() => diagram);
const actions = {
  copy: () => copyWithToast(diagram.source, "Code copied"),
  "copy-md": () => copyWithToast(markdownFence(diagram.source), "Markdown copied"),
  export: () => openExport(),
};
document.querySelectorAll("[data-action]").forEach((btn) =>
  btn.addEventListener("click", () => actions[btn.dataset.action]?.()),
);
