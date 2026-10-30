// The editor as a widget for other pages: Mermaid code on the left, the live
// diagram on the right (stacked when narrow), with the same error handling as
// the app (keep the last good drawing, mark the line) and click-to-edit
// flowchart shapes. Used by Markdown editors for ```mermaid blocks.

import { EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers, Decoration } from "@codemirror/view";
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching } from "@codemirror/language";

import { mermaid as mermaidLang } from "./mermaid-lang.js";
import { errorLine, errorMessage, fixSvgSize, renderMermaid } from "./render.js";
import { PanZoom } from "./panzoom.js";
import { attachZoomToolbar } from "./zoom-toolbar.js";
import { attachCanvasEditor } from "./canvas-edit.js";
import { isFlowchart, minimalChange } from "./flowchart-edit.js";
import { factoryLink } from "./handoff.js";

const STYLE_ID = "mf-embed-style";
const CSS = `
.mf-embed {
  display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0;
  border: 1px solid var(--mf-border, #d9dde4); border-radius: 10px; overflow: visible;
  background: var(--mf-bg, transparent); color: var(--mf-text, inherit); text-align: left;
  white-space: normal; line-height: 1.4;
}
.mf-embed.mf-embed-stacked { grid-template-columns: minmax(0, 1fr); }
.mf-embed-code { min-width: 0; border-right: 1px solid var(--mf-border, #d9dde4); border-radius: 10px 0 0 10px; overflow: hidden; }
.mf-embed-stacked .mf-embed-code { border-right: 0; border-bottom: 1px solid var(--mf-border, #d9dde4); border-radius: 10px 10px 0 0; }
.mf-embed-code .cm-editor { height: 100%; min-height: 8rem; background: var(--mf-code-bg, transparent); font-size: 0.9em; }
.mf-embed-code .cm-editor.cm-focused { outline: none; }
/* !important: the editor may sit inside another CodeMirror (a Markdown editor), whose styles reach in. */
.mf-embed-code .cm-scroller { font-family: var(--mf-font-mono, ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace) !important; line-height: 1.5 !important; font-size: 1em !important; }
.mf-embed-code .cm-content { padding: 6px 0 !important; font-family: inherit !important; }
.mf-embed-code .cm-line { padding: 0 8px 0 6px !important; font-family: inherit !important; font-size: inherit !important; line-height: inherit !important; }
.mf-embed-code .cm-gutters { background: transparent; border-right: 0; color: var(--mf-muted, #8b93a3); }
.mf-embed-code .cm-activeLine, .mf-embed-code .cm-activeLineGutter { background: color-mix(in srgb, currentColor 5%, transparent); }
.mf-embed-code .mf-error-line { background: color-mix(in srgb, #c62828 14%, transparent); }
.mf-embed-side { display: flex; flex-direction: column; min-width: 0; }
.mf-embed-preview { position: relative; flex: 1; min-height: 18rem; overflow: hidden; cursor: grab; touch-action: none; }
.mf-embed-preview.panning { cursor: grabbing; }
.mf-embed-canvas { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.mf-embed-canvas svg { display: block; max-width: none !important; }
.mf-embed-empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 12px; color: var(--mf-muted, #8b93a3); font-size: 0.9em; }
.mf-embed-empty[hidden] { display: none; }
.mf-embed-foot { display: flex; align-items: baseline; gap: 10px; padding: 4px 10px 6px; font-size: 0.78em; }
.mf-embed-status { flex: 1; min-width: 0; color: var(--mf-muted, #8b93a3); }
.mf-embed-open { flex: none; color: var(--mf-link, inherit); text-decoration: underline; text-underline-offset: 2px; }
.mf-embed-open[hidden] { display: none; }
.mf-embed-status.mf-embed-error { color: var(--mf-error, #c62828); white-space: pre-wrap; }
`;

const setErrorLine = StateEffect.define();
const errorLineField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setErrorLine)) continue;
      if (e.value == null || e.value < 1 || e.value > tr.state.doc.lines) deco = Decoration.none;
      else deco = Decoration.set([Decoration.line({ class: "mf-error-line" }).range(tr.state.doc.line(e.value).from)]);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

function injectStyle(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.append(style);
}

/**
 * Mounts the split editor in `element`.
 *
 * Options: `source`; `onChange(source)` after each edit (typed or made on the
 * diagram); `onExit(where)` when the writer leaves the editor with the keyboard
 * ("before": ↑ on the first line, "after": ↓ on the last line, or Esc);
 * `theme` and `config` (look, layout, curve, fontFamily) for mermaid;
 * `autofocus`; `stackBelow` (px width under which the panes stack, default 560);
 * `factoryUrl` (a Mermaid Factory's address, e.g. "https://mermaid.example") to
 * show an "Open in Mermaid Factory" link that opens the code as a new diagram,
 * named `title` if given; `onOpenInFactory(source)` opens it yourself instead
 * (with openInFactory, so a save there comes back).
 *
 * Returns { view, getSource, setSource, focus, destroy }. `setSource` doesn't
 * call `onChange`.
 */
export function mountEditor(element, options = {}) {
  const doc = element.ownerDocument;
  injectStyle(doc);
  const { onChange = () => {}, onExit = () => {}, stackBelow = 560 } = options;
  let theme = options.theme || "default";
  let config = options.config || {};
  let quiet = false;

  const root = doc.createElement("div");
  root.className = "mf-embed";
  root.innerHTML = `
    <div class="mf-embed-code"></div>
    <div class="mf-embed-side">
      <div class="mf-embed-preview">
        <div class="mf-embed-canvas"></div>
        <div class="mf-embed-empty" hidden>Type some Mermaid code to see the diagram here.</div>
      </div>
      <div class="mf-embed-foot">
        <div class="mf-embed-status" aria-live="polite"></div>
        <a class="mf-embed-open" target="_blank" rel="noopener" hidden>Open in Mermaid Factory</a>
      </div>
    </div>`;
  element.append(root);
  const preview = root.querySelector(".mf-embed-preview");
  const canvas = root.querySelector(".mf-embed-canvas");
  const status = root.querySelector(".mf-embed-status");
  const empty = root.querySelector(".mf-embed-empty");
  // The link is made when it's used, so it carries the code as it is then.
  const open = root.querySelector(".mf-embed-open");
  if (options.factoryUrl) {
    open.hidden = false;
    open.href = options.factoryUrl;
    const update = () => { open.href = factoryLink(getSource(), { base: options.factoryUrl, title: options.title }); };
    open.addEventListener("pointerdown", update);
    open.addEventListener("focus", update);
    open.addEventListener("click", (e) => {
      if (!options.onOpenInFactory) return update();
      e.preventDefault();
      options.onOpenInFactory(getSource());
    });
  }

  const atEdge = (where) => (view) => {
    const { main } = view.state.selection;
    if (!main.empty) return false;
    const line = view.state.doc.lineAt(main.head);
    if (where === "before" ? line.number !== 1 : line.number !== view.state.doc.lines) return false;
    onExit(where);
    return true;
  };

  const view = new EditorView({
    parent: root.querySelector(".mf-embed-code"),
    state: EditorState.create({
      doc: options.source || "",
      extensions: [
        lineNumbers(),
        history(),
        drawSelection(),
        highlightActiveLine(),
        bracketMatching(),
        keymap.of([
          { key: "ArrowUp", run: atEdge("before") },
          { key: "ArrowDown", run: atEdge("after") },
          { key: "Escape", run: () => (onExit("after"), true) },
          indentWithTab,
          ...historyKeymap,
          ...defaultKeymap,
        ]),
        mermaidLang(),
        errorLineField,
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ "aria-label": "Mermaid code" }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          if (!quiet) onChange(update.state.doc.toString());
          scheduleRender();
        }),
      ],
    }),
  });

  const getSource = () => view.state.doc.toString();
  // Drag to pan, Ctrl/⌘ + wheel to zoom (a plain wheel scrolls the page), and
  // the floating toolbar. The view stays fitted until the writer zooms or pans.
  const panzoom = new PanZoom(preview, canvas, {
    wheelPans: false,
    keepFitted: true,
    onChange: (scale) => {
      zoomBar.update(scale);
      canvasEditor.refresh();
    },
  });
  const zoomBar = attachZoomToolbar(preview, panzoom);
  const canvasEditor = attachCanvasEditor({
    viewport: preview,
    canvas,
    getSource,
    setSource: (next) => view.dispatch({ changes: minimalChange(getSource(), next) }),
  });

  let timer = 0;
  let seq = 0;
  async function render() {
    const mine = ++seq;
    const source = getSource();
    if (!source.trim()) {
      canvas.innerHTML = "";
      panzoom.clear();
      empty.hidden = false;
      setStatus(null, source);
      return;
    }
    try {
      const { svg, bindFunctions } = await renderMermaid(source, { theme, config });
      if (mine !== seq) return;
      canvas.innerHTML = svg;
      bindFunctions?.(canvas);
      empty.hidden = true;
      panzoom.setContent(fixSvgSize(canvas.querySelector("svg")));
      canvasEditor.refresh();
      setStatus(null, source);
    } catch (err) {
      if (mine !== seq) return;
      // Keep the last good drawing; say what's wrong and mark the line.
      setStatus(err, source);
    }
  }
  function scheduleRender() {
    clearTimeout(timer);
    timer = setTimeout(render, 250);
  }
  function setStatus(err, source) {
    view.dispatch({ effects: setErrorLine.of(err ? errorLine(err) : null) });
    status.classList.toggle("mf-embed-error", !!err);
    status.textContent = err
      ? errorMessage(err)
      : isFlowchart(source)
        ? "Click a shape to change its text or shape, or to add a shape joined to it."
        : "";
  }

  // Side by side when there's room, stacked when there isn't.
  // A fitted view refits when the panes change size.
  const resize = new ResizeObserver(() => {
    root.classList.toggle("mf-embed-stacked", root.clientWidth < stackBelow);
    if (panzoom.hasContent && panzoom.fitted) panzoom.fit();
  });
  resize.observe(root);
  resize.observe(preview);

  render();
  if (options.autofocus) view.focus();

  return {
    view,
    root,
    getSource,
    setSource(next) {
      if (next === getSource()) return;
      quiet = true;
      try {
        view.dispatch({ changes: minimalChange(getSource(), next) });
      } finally {
        quiet = false;
      }
    },
    setTheme(next, nextConfig) {
      theme = next || "default";
      if (nextConfig) config = nextConfig;
      render();
    },
    focus: () => view.focus(),
    destroy() {
      clearTimeout(timer);
      seq++;
      resize.disconnect();
      canvasEditor.destroy();
      zoomBar.destroy();
      view.destroy();
      root.remove();
    },
  };
}
