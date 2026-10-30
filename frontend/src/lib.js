// mermaid-tools: Mermaid Factory's pieces for other pages and editors.
// Built to frontend/dist/ as an ES module (esm/mermaid-tools.js, which loads
// each diagram type on demand) and a script that sets window.MermaidTools
// (mermaid-tools.js). The app uses these same modules.

import { mermaid as mermaidExtensions } from "./mermaid-lang.js";
import { buildConfig, detectType, errorLine, errorMessage, renderMermaid as render } from "./render.js";
import { exportSvgText, pngBlob } from "./exporter.js";
import templates from "mf:templates";
import * as flowchart from "./flowchart-edit.js";

export { mountEditor } from "./embed.js";
export { attachCanvasEditor } from "./canvas-edit.js";
export { flowchart, templates, detectType, buildConfig };
export { mermaidLanguage as mermaidStreamLanguage } from "./mermaid-lang.js";
export { mermaidStream as mermaidStreamParser } from "./mermaid-lang.js";
export { factoryLink, openInFactory } from "./handoff.js";

/** CodeMirror 6 extensions: the Mermaid highlighter with light and dark colours. */
export function mermaidLanguage() {
  return mermaidExtensions();
}

// { theme, look, layout, curve, font | fontFamily, config } → (theme, config).
// config can carry mermaid themeVariables for a host's own palette.
function split(options = {}) {
  const { theme, font, fontFamily, look, layout, curve } = options;
  const config = {};
  if (look) config.look = look;
  if (layout) config.layout = layout;
  if (curve) config.curve = curve;
  if (fontFamily || font) config.fontFamily = fontFamily || font;
  return { theme: theme || "default", config: { ...config, ...(options.config || {}) } };
}

/**
 * Draws `code`. Resolves to { svg, diagramType, bindFunctions } or, when the
 * code doesn't parse, { error, line } (line is 1-based, or null). Never rejects.
 */
export async function renderMermaid(code, options) {
  try {
    const { svg, diagramType, bindFunctions } = await render(code, split(options));
    return { svg, diagramType, bindFunctions };
  } catch (err) {
    return { error: errorMessage(err), line: errorLine(err) };
  }
}

/** A standalone SVG file's text (labels as plain SVG text, so it opens anywhere). */
export async function exportSvg(code, { background, ...options } = {}) {
  const { text } = await exportSvgText({ source: code, ...split(options), background });
  return text;
}

/** A PNG of the diagram at `scale` (1, 2, 4…) on `background` ("transparent" or a colour). */
export function exportPng(code, { scale = 2, background, ...options } = {}) {
  return pngBlob({ source: code, ...split(options), background }, scale);
}

export const version = __MF_VERSION__;
