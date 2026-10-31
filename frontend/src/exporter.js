// SVG / PNG download, done entirely in the browser.

import { backgroundOf, errorMessage, fixSvgSize, renderMermaid, themeBackground } from "./render.js";
import { BACKGROUNDS } from "./backdrop.js";
import { slugify, toast } from "./common.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Turn mermaid's SVG markup into a standalone, correctly sized SVG document. */
export function standaloneSvg(svgMarkup, background) {
  const holder = document.createElement("div");
  holder.style.cssText = "position:absolute;left:-99999px;top:0;visibility:hidden";
  holder.innerHTML = svgMarkup;
  document.body.append(holder);
  try {
    const svg = holder.querySelector("svg");
    const { width, height } = fixSvgSize(svg);
    svg.setAttribute("xmlns", SVG_NS);
    svg.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    svg.setAttribute("version", "1.1");
    svg.removeAttribute("style");
    if (background && background !== "transparent") {
      const vb = svg.viewBox.baseVal;
      const rect = document.createElementNS(SVG_NS, "rect");
      rect.setAttribute("x", String(vb?.x ?? 0));
      rect.setAttribute("y", String(vb?.y ?? 0));
      rect.setAttribute("width", "100%");
      rect.setAttribute("height", "100%");
      if (vb && vb.width) {
        rect.setAttribute("width", String(vb.width));
        rect.setAttribute("height", String(vb.height));
      }
      rect.setAttribute("fill", background);
      // After <style> so it's the first thing painted.
      const style = svg.querySelector(":scope > style");
      svg.insertBefore(rect, style ? style.nextSibling : svg.firstChild);
    }
    const text = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg);
    return { text, width, height };
  } finally {
    holder.remove();
  }
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function exportSvgText({ source, theme, config, background }) {
  const { svg } = await renderMermaid(source, { theme, config, forExport: true });
  return standaloneSvg(svg, background);
}

export async function downloadSvg(opts, filename) {
  const { text } = await exportSvgText(opts);
  download(new Blob([text], { type: "image/svg+xml;charset=utf-8" }), filename);
}

export async function pngBlob(opts, scale = 2) {
  const { text, width, height } = await exportSvgText(opts);
  const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    img.decoding = "sync";
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("The browser could not rasterise this diagram."));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    if (opts.background && opts.background !== "transparent") {
      ctx.fillStyle = opts.background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encoding failed"))), "image/png"),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function downloadPng(opts, scale, filename) {
  download(await pngBlob(opts, scale), filename);
}

/** Wire the shared <dialog id="export-dialog">. `getDiagram` returns
 *  {title, source, theme, config} at the moment the dialog opens. */
export function setupExportDialog(getDiagram) {
  const dialog = document.getElementById("export-dialog");
  if (!dialog) return () => {};
  const form = dialog.querySelector("form");
  const formatSel = form.elements.format;
  const scaleSel = form.elements.scale;
  const filenameInput = form.elements.filename;
  let current = null;

  const fileName = () => {
    const base = slugify(current?.title || "diagram");
    if (formatSel.value === "svg") return `${base}.svg`;
    const scale = Number(scaleSel.value);
    return scale === 1 ? `${base}.png` : `${base}@${scale}x.png`;
  };
  let userEditedName = false;
  const refresh = () => {
    form.querySelectorAll("[data-png-only]").forEach((el) => (el.hidden = formatSel.value !== "png"));
    if (!userEditedName) filenameInput.value = fileName();
  };
  formatSel.addEventListener("change", refresh);
  scaleSel.addEventListener("change", refresh);
  filenameInput.addEventListener("input", () => (userEditedName = true));
  form.elements.background_color.addEventListener("input", () => {
    form.querySelector('input[name="background"][value="custom"]').checked = true;
  });

  dialog.addEventListener("close", async () => {
    if (dialog.returnValue !== "download" || !current) return;
    const bgChoice = form.querySelector('input[name="background"]:checked').value;
    const background =
      bgChoice === "custom" ? form.elements.background_color.value : bgChoice === "paper" ? null : bgChoice;
    // The diagram's blueprint, or (any other choice) the diagram without it.
    const config = bgChoice === "paper" ? current.config : { ...current.config, background: "" };
    let name = filenameInput.value.trim() || fileName();
    const ext = formatSel.value === "svg" ? ".svg" : ".png";
    if (!name.toLowerCase().endsWith(ext)) name += ext;
    const opts = { source: current.source, theme: current.theme, config, background };
    try {
      if (formatSel.value === "svg") await downloadSvg(opts, name);
      else await downloadPng(opts, Number(scaleSel.value), name);
      toast(`Downloaded ${name}`);
    } catch (err) {
      toast("Export failed: " + errorMessage(err), "error", 5000);
    }
  });

  return () => {
    current = getDiagram();
    if (!current.source.trim()) {
      toast("Nothing to export yet.", "error");
      return;
    }
    userEditedName = false;
    // A blueprint diagram offers its blueprint (and picks it).
    const paper = backgroundOf(current.source, current.config);
    const paperOption = form.querySelector("[data-paper-only]");
    paperOption.hidden = !paper;
    if (paper) {
      paperOption.querySelector("[data-paper-label]").textContent = BACKGROUNDS.find((b) => b.value === paper).label;
      paperOption.querySelector("input").checked = true;
    } else if (paperOption.querySelector("input").checked) {
      form.querySelector('input[name="background"][value="transparent"]').checked = true;
    }
    // Dark themes look wrong on transparent/white, so suggest their own background.
    const darkBg = themeBackground(current.theme);
    if (darkBg && !paper) {
      form.elements.background_color.value = darkBg;
      form.querySelector('input[name="background"][value="custom"]').checked = true;
    }
    dialog.returnValue = "";
    refresh();
    dialog.showModal();
  };
}
