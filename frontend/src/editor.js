// The editor page: CodeMirror on the left, live mermaid preview on the right.

import { EditorView, basicSetup } from "codemirror";
import { Compartment, EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";

import {
  api,
  confirmDialog,
  copyWithToast,
  debounce,
  markdownFence,
  readJson,
  relativeTime,
  storage,
  toast,
  wireMenus,
} from "./common.js";
import { mermaid as mermaidLang } from "./mermaid-lang.js";
import {
  detectType,
  errorLine,
  errorMessage,
  fixSvgSize,
  hasInlineConfig,
  parses,
  renderMermaid,
  themeBackground,
} from "./render.js";
import { PanZoom } from "./panzoom.js";
import { attachZoomToolbar } from "./zoom-toolbar.js";
import { setupExportDialog } from "./exporter.js";
import { lazyThumb, thumbObserver } from "./thumbs.js";
import { canConvert, convertDiagram } from "./convert.js";
import { attachCanvasEditor } from "./canvas-edit.js";
import { minimalChange } from "./flowchart-edit.js";
import { SAVE, SAVED, readHandoff } from "./handoff.js";

const $ = (sel) => document.querySelector(sel);
const RENDER_DEBOUNCE_MS = 300;
const SPLIT_KEY = "mf-split";
const PANEL_KEY = "mf-panel";

const initial = readJson("diagram-data");
const typeLabels = readJson("type-labels") || {};

const state = {
  id: initial.id,
  title: initial.title,
  source: initial.source,
  theme: initial.theme || "default",
  config: { ...(initial.config || {}) },
  tags: [...(initial.tags || [])],
  shareToken: initial.share_token || null,
  saving: false,
};
// Code handed over by another page ("Open in Mermaid Factory").
const handoff = state.id === null ? readHandoff(location.hash) : null;
if (handoff) {
  state.source = handoff.source;
  if (handoff.title) state.title = handoff.title;
  history.replaceState(null, "", location.pathname + location.search);
}
let saved = snapshot();
if (state.id === null && state.source) {
  // A template that hasn't been saved yet counts as unsaved work.
  saved = "";
}

function snapshot() {
  return JSON.stringify({
    title: state.title,
    source: state.source,
    theme: state.theme,
    config: state.config,
    tags: state.tags,
  });
}

const isDirty = () => snapshot() !== saved;
const draftKey = () => `mf-draft-${state.id ?? "new"}`;

// --------------------------------------------------------------- dirty state

function updateDirty() {
  const dirty = isDirty();
  $("#dirty-indicator").hidden = !dirty;
  document.title = `${dirty ? "• " : ""}${state.title || "Untitled"} · Mermaid Factory`;
  $("#save-btn").textContent = state.saving ? "Saving…" : dirty || state.id === null ? "Save" : "Saved";
  $("#save-btn").disabled = state.saving;
}

const saveDraft = debounce(() => {
  if (isDirty()) storage.set(draftKey(), { ...JSON.parse(snapshot()), at: new Date().toISOString() });
  else storage.remove(draftKey());
}, 800);

function changed() {
  updateDirty();
  saveDraft();
}

window.addEventListener("beforeunload", (e) => {
  // Opened from another page, what matters is whether it went back there.
  const unsaved = handoff?.back ? state.source !== sentBack : isDirty();
  if (unsaved) {
    e.preventDefault();
    e.returnValue = "";
  }
});

// ------------------------------------------------------------- code editor

const setErrorLine = StateEffect.define();
const errorLineField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setErrorLine)) {
        if (e.value == null || e.value < 1 || e.value > tr.state.doc.lines) deco = Decoration.none;
        else {
          const line = tr.state.doc.line(e.value);
          deco = Decoration.set([Decoration.line({ class: "cm-error-line" }).range(line.from)]);
        }
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const uiDark = () => {
  const attr = document.documentElement.getAttribute("data-ui-theme");
  if (attr) return attr === "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
};
const themeCompartment = new Compartment();
const editorTheme = (dark) =>
  EditorView.theme(
    {
      "&": { backgroundColor: "var(--surface)", color: "var(--text)" },
      ".cm-gutters": { backgroundColor: "var(--surface-2)", color: "var(--muted)", borderRight: "1px solid var(--border)" },
      ".cm-activeLine": { backgroundColor: dark ? "#ffffff0a" : "#0000000a" },
      ".cm-activeLineGutter": { backgroundColor: dark ? "#ffffff12" : "#00000010" },
      ".cm-cursor": { borderLeftColor: "var(--text)" },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
        backgroundColor: dark ? "#3b4a6b !important" : "#cfe0ff !important",
      },
    },
    { dark },
  );

const view = new EditorView({
  parent: $("#code-editor"),
  state: EditorState.create({
    doc: state.source,
    extensions: [
      basicSetup,
      keymap.of([
        { key: "Mod-s", preventDefault: true, run: () => (saveShortcut(), true) },
        indentWithTab,
      ]),
      mermaidLang(),
      errorLineField,
      themeCompartment.of(editorTheme(uiDark())),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        state.source = update.state.doc.toString();
        changed();
        syncDirection();
        scheduleRender();
      }),
    ],
  }),
});
document.addEventListener("mf:ui-theme", () =>
  view.dispatch({ effects: themeCompartment.reconfigure(editorTheme(uiDark())) }),
);
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () =>
  view.dispatch({ effects: themeCompartment.reconfigure(editorTheme(uiDark())) }),
);

function setSource(text) {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
}

document.addEventListener("keydown", (e) => {
  // The code editor handles its own Ctrl/⌘+S (and prevents the default).
  if (!e.defaultPrevented && (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "s") {
    e.preventDefault();
    saveShortcut();
  }
});

// ------------------------------------------------------------------ preview

const viewport = $("#preview-viewport");
const canvas = $("#preview-canvas");
const panzoom = new PanZoom(viewport, canvas, {
  onChange: (scale) => {
    zoomBar.update(scale);
    canvasEditor.refresh(); // keep the shape editor beside its node
  },
});
// Floating over the drawing: fit, −, the zoom level (100% ⇄ fit) and +.
const zoomBar = attachZoomToolbar(viewport, panzoom);

// Clicking a flowchart node edits its text and shape, or adds a node joined to it.
const canvasEditor = attachCanvasEditor({
  viewport,
  canvas,
  getSource: () => state.source,
  setSource: (next) => view.dispatch({ changes: minimalChange(state.source, next) }),
});

let renderSeq = 0;
let rendering = false;
let pendingRender = false;

async function doRender() {
  if (rendering) {
    // Coalesce: only the latest text is rendered once the current one finishes.
    pendingRender = true;
    return;
  }
  rendering = true;
  const seq = ++renderSeq;
  const source = state.source;
  updateTypeBadge();
  updateInlineNote();
  try {
    if (!source.trim()) {
      canvas.innerHTML = "";
      panzoom.clear();
      $("#preview-empty").hidden = false;
      showError(null);
      return;
    }
    const { svg, bindFunctions } = await renderMermaid(source, { theme: state.theme, config: state.config });
    if (seq !== renderSeq) return;
    canvas.innerHTML = svg;
    viewport.style.background = themeBackground(state.theme);
    const svgEl = canvas.querySelector("svg");
    bindFunctions?.(canvas);
    $("#preview-empty").hidden = true;
    panzoom.setContent(fixSvgSize(svgEl));
    canvasEditor.refresh();
    showError(null);
  } catch (err) {
    // Keep the last good render on screen; just report the problem.
    showError(err);
  } finally {
    rendering = false;
    if (pendingRender) {
      pendingRender = false;
      doRender();
    }
  }
}
const scheduleRender = debounce(doRender, RENDER_DEBOUNCE_MS);

function showError(err) {
  const strip = $("#error-strip");
  if (!err) {
    strip.hidden = true;
    strip.textContent = "";
    view.dispatch({ effects: setErrorLine.of(null) });
    return;
  }
  const line = errorLine(err);
  strip.textContent = errorMessage(err);
  strip.hidden = false;
  view.dispatch({ effects: setErrorLine.of(line) });
}

function updateTypeBadge() {
  const type = detectType(state.source);
  const badge = $("#type-badge");
  badge.textContent = type === "unknown" ? "Choose type" : typeLabels[type] || type;
  return type;
}

function updateInlineNote() {
  const note = $("#note-strip");
  const inline = hasInlineConfig(state.source);
  note.hidden = !inline;
  note.textContent = inline
    ? "This code sets its own config (an %%{init}%% directive or front-matter config:). Those values override the toolbar theme and Style panel."
    : "";
}

// ------------------------------------------------------------- change type

const typeDialog = $("#type-dialog");
const typeGrid = $("#type-grid");
const typeSearch = $("#type-search");
let typeTemplates = null;

// Front matter (title, config) is kept when switching, unless the template brings its own.
const FRONT_MATTER_RE = /^\s*---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

async function openTypeDialog() {
  typeSearch.value = "";
  filterTypes();
  typeDialog.showModal();
  if (!typeTemplates) {
    try {
      typeTemplates = (await api("GET", "/api/templates")).items;
    } catch (err) {
      typeGrid.textContent = err.message;
      return;
    }
    buildTypeGrid();
  }
  const current = detectType(state.source);
  typeGrid.querySelectorAll(".tcard").forEach((card) => {
    card.setAttribute("aria-current", String(card.dataset.slug === current));
    card.querySelector(".tcard-keep").hidden = !canConvert(current, card.dataset.slug);
  });
}

function buildTypeGrid() {
  const observer = thumbObserver();
  typeGrid.innerHTML = "";
  for (const t of typeTemplates) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "tcard";
    card.dataset.slug = t.slug;
    card.dataset.name = `${t.name} ${t.description}`.toLowerCase();
    card.title = t.description;
    const thumb = document.createElement("div");
    thumb.className = "thumb-inner";
    thumb.innerHTML = '<span class="spinner" aria-hidden="true"></span>';
    const name = document.createElement("span");
    name.className = "tcard-name";
    name.textContent = t.name;
    const keep = document.createElement("span");
    keep.className = "tcard-keep";
    keep.textContent = "keeps content";
    keep.hidden = true;
    card.append(thumb, name, keep);
    card.addEventListener("click", () => switchType(t));
    typeGrid.append(card);
    lazyThumb(observer, thumb, { source: t.source, theme: "default", config: {} });
  }
  filterTypes();
}

function filterTypes() {
  const q = typeSearch.value.trim().toLowerCase();
  typeGrid.querySelectorAll(".tcard").forEach((card) => {
    card.hidden = q !== "" && !card.dataset.name.includes(q);
  });
}
typeSearch.addEventListener("input", filterTypes);
typeSearch.addEventListener("keydown", (e) => {
  // Enter picks the only (or first) match instead of submitting the dialog.
  if (e.key !== "Enter") return;
  e.preventDefault();
  typeGrid.querySelector(".tcard:not([hidden])")?.click();
});

async function switchType(t) {
  typeDialog.close();
  const before = state.source;
  const from = detectType(before);
  if (from === t.slug) return;
  const frontMatter = FRONT_MATTER_RE.exec(before)?.[0];
  // Carry the content over where the types are compatible, but only if the
  // result actually parses; otherwise start from the type's template.
  let code = convertDiagram(frontMatter ? before.slice(frontMatter.length) : before, from, t.slug);
  if (code !== null && !(await parses(code))) code = null;
  if (state.source !== before) return; // edited while we were checking
  const converted = code !== null;
  code = converted ? code : t.source;
  const next = frontMatter && !FRONT_MATTER_RE.test(code) ? frontMatter.trimStart() + code : code;
  setSource(next);
  view.focus();
  if (!before.trim()) return;
  const message = converted
    ? `Converted to ${t.name}`
    : `Couldn't carry this over to ${t.name}, so it's the starter template`;
  toast(message, "info", 8000, { label: "Undo", run: () => (setSource(before), view.focus()) });
}

$("#type-badge").addEventListener("click", openTypeDialog);

// -------------------------------------------------------------- split pane

const split = $("#split");
const divider = $("#divider");
const savedSplit = storage.get(SPLIT_KEY);
if (typeof savedSplit === "number") split.style.setProperty("--split", `${savedSplit}%`);
divider.addEventListener("pointerdown", (e) => {
  divider.setPointerCapture(e.pointerId);
  divider.classList.add("dragging");
  const rect = split.getBoundingClientRect();
  const move = (ev) => {
    const pct = Math.min(80, Math.max(15, ((ev.clientX - rect.left) / rect.width) * 100));
    split.style.setProperty("--split", `${pct}%`);
  };
  const up = (ev) => {
    divider.releasePointerCapture(ev.pointerId);
    divider.classList.remove("dragging");
    divider.removeEventListener("pointermove", move);
    divider.removeEventListener("pointerup", up);
    const pct = parseFloat(split.style.getPropertyValue("--split"));
    if (!Number.isNaN(pct)) storage.set(SPLIT_KEY, Math.round(pct * 10) / 10);
  };
  divider.addEventListener("pointermove", move);
  divider.addEventListener("pointerup", up);
});
divider.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  const current = parseFloat(split.style.getPropertyValue("--split")) || 42;
  const pct = Math.min(80, Math.max(15, current + (e.key === "ArrowLeft" ? -2 : 2)));
  split.style.setProperty("--split", `${pct}%`);
  storage.set(SPLIT_KEY, pct);
});

// ------------------------------------------------------------ title, theme

const titleInput = $("#title");
titleInput.value = state.title;
titleInput.addEventListener("input", () => {
  state.title = titleInput.value;
  changed();
});
titleInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    view.focus();
  }
});

const themeSelect = $("#theme-select");
themeSelect.value = state.theme;
themeSelect.addEventListener("change", () => {
  state.theme = themeSelect.value;
  changed();
  doRender();
});

// ------------------------------------------------------------ side panels

const panel = $("#side-panel");
const panelTitles = { style: "Style", reference: "Syntax reference", history: "History" };
let openPanel = null;

function showPanel(name) {
  openPanel = name;
  panel.hidden = !name;
  document.querySelectorAll("[data-panel]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.panel === name)));
  document.querySelectorAll("[data-panel-body]").forEach((b) => (b.hidden = b.dataset.panelBody !== name));
  storage.set(PANEL_KEY, name);
  if (!name) return;
  $("#side-title").textContent = panelTitles[name];
  if (name === "reference") loadCheatsheet();
  if (name === "history") loadHistory();
  // The preview area changed size; keep the diagram in view.
  requestAnimationFrame(() => panzoom.hasContent && panzoom.fit());
}
document.querySelectorAll("[data-panel]").forEach((btn) =>
  btn.addEventListener("click", () => showPanel(openPanel === btn.dataset.panel ? null : btn.dataset.panel)),
);
$("#side-close").addEventListener("click", () => showPanel(null));

// Style panel -----------------------------------------------------------------

const styleForm = $("#style-form");
for (const key of ["look", "layout", "curve", "fontFamily"]) {
  styleForm.elements[key].value = state.config[key] || "";
}
$("#tags-input").value = state.tags.join(", ");

const DIRECTION_RE = /^(\s*(?:flowchart|graph)(?:-elk)?)(?:[ \t]+(TB|TD|BT|RL|LR))?[ \t]*$/m;
function syncDirection() {
  const match = DIRECTION_RE.exec(state.source);
  const select = $("#direction-select");
  select.disabled = !match;
  select.value = match ? (match[2] === "TB" ? "TD" : match[2] || "") : "";
}

styleForm.addEventListener("input", (e) => {
  const el = e.target;
  if (el.name === "direction") {
    const match = DIRECTION_RE.exec(state.source);
    if (match) {
      const replacement = el.value ? `${match[1]} ${el.value}` : match[1];
      const from = match.index;
      view.dispatch({ changes: { from, to: from + match[0].length, insert: replacement } });
    }
    return;
  }
  if (el.name === "tags") {
    state.tags = el.value.split(",").map((t) => t.trim()).filter(Boolean);
    changed();
    return;
  }
  const value = el.value.trim();
  if (value) state.config[el.name] = value;
  else delete state.config[el.name];
  changed();
  scheduleRender();
});

// Reference panel ------------------------------------------------------------

let cheatsheetTypes = null;
async function loadCheatsheet(type) {
  const select = $("#cheatsheet-select");
  if (!cheatsheetTypes) {
    try {
      cheatsheetTypes = (await api("GET", "/api/cheatsheets")).types;
    } catch (err) {
      $("#cheatsheet").textContent = err.message;
      return;
    }
    select.innerHTML = "";
    for (const t of cheatsheetTypes) select.add(new Option(typeLabels[t] || t, t));
    select.addEventListener("change", () => loadCheatsheet(select.value));
  }
  const detected = detectType(state.source);
  type = type || (cheatsheetTypes.includes(detected) ? detected : cheatsheetTypes.includes("flowchart") ? "flowchart" : cheatsheetTypes[0]);
  select.value = type;
  const box = $("#cheatsheet");
  try {
    const { html } = await api("GET", `/api/cheatsheets/${encodeURIComponent(type)}`);
    box.innerHTML = html; // Server-rendered from our own Markdown files.
    box.querySelectorAll("a[href^='http']").forEach((a) => {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    });
    box.querySelectorAll("pre").forEach((pre) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-sm insert-btn";
      btn.textContent = "Insert";
      btn.title = "Insert at cursor";
      btn.addEventListener("click", () => {
        const text = pre.querySelector("code")?.textContent ?? pre.textContent;
        const { from, to } = view.state.selection.main;
        const line = view.state.doc.lineAt(from);
        const prefix = from === line.from ? "" : "\n";
        view.dispatch({ changes: { from, to, insert: prefix + text.replace(/\n$/, "") }, scrollIntoView: true });
        view.focus();
      });
      pre.append(btn);
    });
  } catch (err) {
    box.textContent = err.message;
  }
}

// History panel -----------------------------------------------------------------

async function loadHistory() {
  const list = $("#history-list");
  list.innerHTML = "";
  if (state.id === null) {
    list.innerHTML = "<li class='muted'>Save the diagram to start its history.</li>";
    return;
  }
  let items;
  try {
    items = (await api("GET", `/api/diagrams/${state.id}/versions`)).items;
  } catch (err) {
    list.textContent = err.message;
    return;
  }
  items.forEach((v, idx) => {
    const li = document.createElement("li");
    li.value = v.number;
    const head = document.createElement("div");
    head.className = "hist-head";
    const when = document.createElement("span");
    when.textContent = `Version ${v.number} · ${relativeTime(v.created_at)}`;
    when.title = new Date(v.created_at).toLocaleString();
    head.append(when);
    if (idx === 0) {
      const cur = document.createElement("span");
      cur.className = "current";
      cur.textContent = "current";
      head.append(cur);
    } else {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-sm";
      btn.textContent = "Restore";
      btn.addEventListener("click", () => restoreVersion(v));
      head.append(btn);
    }
    const thumb = document.createElement("div");
    thumb.className = "hist-thumb";
    li.append(head, thumb);
    list.append(li);
    renderMermaid(v.source, { theme: v.theme, config: v.config })
      .then(({ svg }) => (thumb.innerHTML = svg))
      .catch(() => (thumb.textContent = "(doesn't render)"));
  });
}

async function restoreVersion(version) {
  if (isDirty()) {
    const ok = await confirmDialog({
      title: "Discard unsaved changes?",
      message: "Restoring a version replaces your unsaved edits.",
      ok: "Restore",
    });
    if (!ok) return;
  }
  try {
    const d = await api("POST", `/api/diagrams/${state.id}/versions/${version.id}/restore`);
    applyServer(d);
    toast(`Restored version ${version.number}`);
    loadHistory();
  } catch (err) {
    toast(err.message, "error");
  }
}

// -------------------------------------------------------------------- save

function applyServer(d) {
  state.id = d.id;
  state.title = d.title;
  state.theme = d.theme;
  state.config = { ...d.config };
  state.tags = [...d.tags];
  state.shareToken = d.share_token;
  titleInput.value = d.title;
  themeSelect.value = d.theme;
  for (const key of ["look", "layout", "curve", "fontFamily"]) styleForm.elements[key].value = state.config[key] || "";
  $("#tags-input").value = state.tags.join(", ");
  if (d.source !== state.source) setSource(d.source); // updates state.source via listener
  state.source = d.source;
  saved = snapshot();
  updateDirty();
  doRender();
}

// ------------------------------------------------- back to the page it came from

// A diagram opened from another page ("Open in Mermaid Factory" with a way
// back) saves there: the page that opened this tab (window.opener) gets the
// code and answers whether it kept it. See handoff.js.
let sentBack = handoff?.source ?? null;
let pendingBack = null;
let backTimer = 0;
const backButton = $("#save-back-btn");
if (handoff?.back) {
  const { label } = handoff.back;
  backButton.hidden = false;
  backButton.textContent = `Save to ${label}`;
  backButton.title = `Send the diagram back to ${label} (Ctrl/⌘+S)`;
  $("#save-btn").classList.remove("btn-primary");
  $("#save-btn").title = "Save a copy in Mermaid Factory";
  backButton.addEventListener("click", () => saveBack());
  window.addEventListener("message", (e) => {
    const data = e.data;
    if (e.origin !== handoff.back.origin || !data || data.type !== SAVED || data.ref !== handoff.back.ref) return;
    clearTimeout(backTimer);
    if (data.ok) {
      sentBack = pendingBack ?? sentBack;
      toast(`Saved to ${label}`);
    } else {
      toast(data.message || `${label} didn't take the diagram`, "error", 8000);
    }
  });
}

function saveShortcut() {
  if (handoff?.back) saveBack();
  else save();
}

function saveBack() {
  const { origin, ref, label } = handoff.back;
  const target = window.opener;
  if (!target || target.closed) {
    toast(`${label} is no longer open, so the diagram can't go back there. Save it here instead.`, "error", 8000);
    return;
  }
  const source = state.source;
  target.postMessage({ type: SAVE, ref, source, title: state.title }, origin);
  clearTimeout(backTimer);
  backTimer = setTimeout(() => toast(`No answer from ${label}. Is it still open?`, "error", 8000), 4000);
  pendingBack = source; // counted as sent once the answer comes
}

async function save() {
  if (state.saving) return;
  if (state.id !== null && !isDirty()) {
    toast("Already saved");
    return;
  }
  state.saving = true;
  updateDirty();
  const body = { title: state.title, source: state.source, theme: state.theme, config: state.config, tags: state.tags };
  try {
    const wasNew = state.id === null;
    const d = wasNew ? await api("POST", "/api/diagrams", body) : await api("PUT", `/api/diagrams/${state.id}`, body);
    if (wasNew) {
      storage.remove(draftKey());
      history.replaceState(null, "", `/diagrams/${d.id}/edit`);
    }
    state.id = d.id;
    state.shareToken = d.share_token;
    state.title = d.title;
    state.tags = d.tags;
    titleInput.value = d.title;
    saved = snapshot();
    storage.remove(draftKey());
    toast("Saved");
    if (openPanel === "history") loadHistory();
  } catch (err) {
    toast(`Save failed: ${err.message}`, "error", 5000);
  } finally {
    state.saving = false;
    updateDirty();
  }
}
$("#save-btn").addEventListener("click", save);

// ------------------------------------------------------------- menu actions

const openExport = setupExportDialog(() => ({ ...state }));

async function requireSaved(what) {
  if (state.id !== null) return true;
  toast(`Save the diagram first to ${what}.`, "error");
  return false;
}

const actions = {
  copy: () => copyWithToast(state.source, "Code copied"),
  "copy-md": () => copyWithToast(markdownFence(state.source), "Markdown copied"),
  export: () => openExport(),
  share: async () => {
    if (!(await requireSaved("share it"))) return;
    openShareDialog();
  },
  duplicate: async () => {
    if (!(await requireSaved("duplicate it"))) return;
    if (isDirty()) await save();
    try {
      const d = await api("POST", `/api/diagrams/${state.id}/duplicate`);
      window.location.href = `/diagrams/${d.id}/edit`;
    } catch (err) {
      toast(err.message, "error");
    }
  },
  delete: async () => {
    const ok = await confirmDialog({
      title: "Delete diagram?",
      message: `"${state.title}" and its history will be permanently deleted.`,
    });
    if (!ok) return;
    try {
      if (state.id !== null) await api("DELETE", `/api/diagrams/${state.id}`);
      storage.remove(draftKey());
      saved = snapshot(); // don't trigger the unsaved-changes prompt
      window.location.href = "/diagrams";
    } catch (err) {
      toast(err.message, "error");
    }
  },
};
document.querySelectorAll("[data-action]").forEach((btn) =>
  btn.addEventListener("click", () => actions[btn.dataset.action]?.()),
);
wireMenus();

// Share dialog ------------------------------------------------------------------

const shareDialog = $("#share-dialog");
function shareUrl() {
  return `${location.origin}/share/${state.shareToken}`;
}
function refreshShare() {
  $("#share-on").hidden = !state.shareToken;
  $("#share-off").hidden = !!state.shareToken;
  if (state.shareToken) $("#share-url").value = shareUrl();
}
function openShareDialog() {
  refreshShare();
  shareDialog.showModal();
}
$("#share-create").addEventListener("click", async () => {
  try {
    const r = await api("POST", `/api/diagrams/${state.id}/share`);
    state.shareToken = r.share_token;
    refreshShare();
    await copyWithToast(shareUrl(), "Share link created and copied");
  } catch (err) {
    toast(err.message, "error");
  }
});
$("#share-copy").addEventListener("click", () => copyWithToast(shareUrl(), "Link copied"));
$("#share-revoke").addEventListener("click", async () => {
  try {
    await api("DELETE", `/api/diagrams/${state.id}/share`);
    state.shareToken = null;
    refreshShare();
    toast("Link revoked. The old URL no longer works.");
  } catch (err) {
    toast(err.message, "error");
  }
});

// -------------------------------------------------------------------- start

function offerDraft() {
  const draft = storage.get(draftKey());
  if (!draft || typeof draft.source !== "string") return;
  const { at, ...content } = draft;
  if (JSON.stringify(content) === snapshot()) {
    storage.remove(draftKey());
    return;
  }
  const dialog = $("#draft-dialog");
  $("#draft-when").textContent = relativeTime(at);
  dialog.addEventListener(
    "close",
    () => {
      if (dialog.returnValue === "restore") {
        state.title = content.title ?? state.title;
        state.theme = content.theme ?? state.theme;
        state.config = { ...(content.config || {}) };
        state.tags = [...(content.tags || [])];
        titleInput.value = state.title;
        themeSelect.value = state.theme;
        for (const key of ["look", "layout", "curve", "fontFamily"]) styleForm.elements[key].value = state.config[key] || "";
        $("#tags-input").value = state.tags.join(", ");
        setSource(content.source);
        changed();
      } else {
        storage.remove(draftKey());
      }
    },
    { once: true },
  );
  dialog.showModal();
}

updateDirty();
syncDirection();
doRender();
offerDraft();
const panelPref = storage.get(PANEL_KEY);
if (panelPref && panelTitles[panelPref]) showPanel(panelPref);
view.focus();
