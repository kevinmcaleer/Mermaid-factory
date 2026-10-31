// Edits to flowchart source made from the diagram itself: a node's text and
// shape, and new nodes connected to it. Each function takes the source and
// returns new source, touching only the characters it has to, so comments,
// layout and everything else the writer typed stay as they were.

/** The classic bracket shapes, in the order the shape picker shows them. */
export const SHAPES = [
  { id: "rect", label: "Rectangle", open: "[", close: "]", at: "rect" },
  { id: "rounded", label: "Rounded rectangle", open: "(", close: ")", at: "rounded" },
  { id: "stadium", label: "Stadium", open: "([", close: "])", at: "stadium" },
  { id: "circle", label: "Circle", open: "((", close: "))", at: "circle" },
  { id: "double-circle", label: "Double circle", open: "(((", close: ")))", at: "dbl-circ" },
  { id: "diamond", label: "Diamond (decision)", open: "{", close: "}", at: "diam" },
  { id: "hexagon", label: "Hexagon", open: "{{", close: "}}", at: "hex" },
  { id: "subroutine", label: "Subroutine", open: "[[", close: "]]", at: "subproc" },
  { id: "cylinder", label: "Database", open: "[(", close: ")]", at: "cyl" },
  { id: "parallelogram", label: "Parallelogram", open: "[/", close: "/]", at: "lean-r" },
  { id: "parallelogram-alt", label: "Parallelogram (left)", open: "[\\", close: "\\]", at: "lean-l" },
  { id: "trapezoid", label: "Trapezoid", open: "[/", close: "\\]", at: "trap-b" },
  { id: "trapezoid-alt", label: "Trapezoid (upside down)", open: "[\\", close: "/]", at: "trap-t" },
  { id: "asymmetric", label: "Flag", open: ">", close: "]", at: "odd" },
];
const SHAPE_BY_ID = new Map(SHAPES.map((s) => [s.id, s]));

// Openers, longest first, and the closers each one can end with.
const OPENERS = [
  ["(((", [")))"]],
  ["([", ["])"]],
  ["((", ["))"]],
  ["[[", ["]]"]],
  ["[(", [")]"]],
  ["{{", ["}}"]],
  ["[/", ["/]", "\\]"]],
  ["[\\", ["\\]", "/]"]],
  ["(", [")"]],
  ["[", ["]"]],
  ["{", ["}"]],
  [">", ["]"]],
];

// Names for the @{ shape: … } syntax that mean the same as a bracket shape.
const AT_ALIASES = {
  rect: "rect", rectangle: "rect", proc: "rect", process: "rect", square: "rect",
  rounded: "rounded", event: "rounded",
  stadium: "stadium", pill: "stadium", terminal: "stadium",
  circle: "circle", circ: "circle",
  "dbl-circ": "double-circle", "double-circle": "double-circle",
  diam: "diamond", diamond: "diamond", decision: "diamond", question: "diamond",
  hex: "hexagon", hexagon: "hexagon", prepare: "hexagon",
  subproc: "subroutine", subprocess: "subroutine", subroutine: "subroutine", "fr-rect": "subroutine", "framed-rectangle": "subroutine",
  cyl: "cylinder", cylinder: "cylinder", database: "cylinder", db: "cylinder",
  "lean-r": "parallelogram", "lean-right": "parallelogram", "in-out": "parallelogram",
  "lean-l": "parallelogram-alt", "lean-left": "parallelogram-alt", "out-in": "parallelogram-alt",
  "trap-b": "trapezoid", trapezoid: "trapezoid", "trapezoid-bottom": "trapezoid", priority: "trapezoid",
  "trap-t": "trapezoid-alt", "trapezoid-top": "trapezoid-alt", "inv-trapezoid": "trapezoid-alt", manual: "trapezoid-alt",
  odd: "asymmetric",
};

const HEADER_RE = /^\s*(?:flowchart|graph)(?:-elk)?\b/;
// Lines that never define a node.
const SKIP_LINE_RE = /^\s*(?:%%|classDef\b|class\b|style\b|linkStyle\b|click\b|direction\b|subgraph\b|end\s*$|accTitle\b|accDescr\b)/;

/** The id mermaid gave a rendered node's <g>: "<render id>-flowchart-<node id>-<n>". */
export function nodeIdFromElement(el) {
  const match = /-flowchart-(.+)-\d+$/.exec(el?.id || "");
  return match ? match[1] : null;
}

/** True when `source` is a flowchart (or graph) these edits understand. */
export function isFlowchart(source) {
  for (const line of bodyLines(source)) {
    if (!line.text.trim() || /^\s*%%/.test(line.text)) continue;
    return HEADER_RE.test(line.text);
  }
  return false;
}

// The lines after any front matter, with their offsets in the source.
function bodyLines(source) {
  const lines = [];
  let offset = 0;
  for (const text of source.split("\n")) {
    lines.push({ text, from: offset });
    offset += text.length + 1;
  }
  let start = 0;
  while (start < lines.length && !lines[start].text.trim()) start++;
  if (lines[start]?.text.trim() === "---") {
    let end = start + 1;
    while (end < lines.length && lines[end].text.trim() !== "---") end++;
    if (end < lines.length) return lines.slice(end + 1);
  }
  return lines;
}

// Reads a "…" string starting at `i` (on the quote); returns the index after it.
function skipString(text, i) {
  const end = text.indexOf('"', i + 1);
  return end < 0 ? text.length : end + 1;
}

// A node's shape and text, if one is defined at `i` (just after its id).
function readShape(text, i) {
  if (text.startsWith("@{", i)) {
    let j = i + 2;
    let depth = 1;
    while (j < text.length && depth) {
      if (text[j] === '"') {
        j = skipString(text, j);
        continue;
      }
      if (text[j] === "{") depth++;
      else if (text[j] === "}") depth--;
      j++;
    }
    if (depth) return null;
    return { kind: "at", from: i, to: j, body: text.slice(i + 2, j - 1) };
  }
  for (const [open, closers] of OPENERS) {
    if (!text.startsWith(open, i)) continue;
    let j = i + open.length;
    const textFrom = j;
    if (text[j] === '"') j = skipString(text, j);
    for (; j < text.length; j++) {
      const close = closers.find((c) => text.startsWith(c, j));
      if (close) {
        const shape = SHAPES.find((s) => s.open === open && s.close === close);
        if (!shape) return null;
        return { kind: "bracket", from: i, to: j + close.length, shape: shape.id, textFrom, textTo: j };
      }
    }
    return null;
  }
  return null;
}

// Every node id written on a line, with its definition when it has one.
function scanLine(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (text.startsWith("%%", i)) break;
    if (ch === '"') {
      i = skipString(text, i);
      continue;
    }
    if (ch === "|") {
      // An edge label: -->|text|
      const end = text.indexOf("|", i + 1);
      i = end < 0 ? text.length : end + 1;
      continue;
    }
    if (text.startsWith(":::", i)) {
      // A class name after a node.
      i += 3;
      while (i < text.length && /[\w-]/.test(text[i])) i++;
      continue;
    }
    if (/\w/.test(ch) && (i === 0 || !/[\w-]/.test(text[i - 1]))) {
      let j = i;
      while (j < text.length && /\w/.test(text[j])) j++;
      // Ids may hold dashes, but not the start of an arrow (A-->B).
      while (text[j] === "-" && /\w/.test(text[j + 1] || "")) {
        j++;
        while (j < text.length && /\w/.test(text[j])) j++;
      }
      const id = text.slice(i, j);
      const def = readShape(text, j);
      tokens.push({ id, from: i, to: j, def });
      i = def ? def.to : j;
      continue;
    }
    i++;
  }
  return tokens;
}

// Every occurrence of every node in the flowchart, with source offsets.
function scan(source) {
  const found = [];
  let seenHeader = false;
  const subgraphs = [];
  for (const line of bodyLines(source)) {
    if (!seenHeader) {
      if (HEADER_RE.test(line.text)) seenHeader = true;
      continue;
    }
    // Which subgraph the line sits in, so new lines can land beside it.
    line.ctx = subgraphs.join("/");
    if (/^\s*subgraph\b/.test(line.text)) subgraphs.push(line.from);
    else if (/^\s*end\s*;?\s*$/.test(line.text)) subgraphs.pop();
    if (SKIP_LINE_RE.test(line.text)) continue;
    for (const token of scanLine(line.text)) {
      found.push({ ...token, line, from: line.from + token.from, to: line.from + token.to, def: token.def && shift(token.def, line.from) });
    }
  }
  return found;
}

function shift(def, by) {
  const out = { ...def, from: def.from + by, to: def.to + by };
  if (def.textFrom !== undefined) {
    out.textFrom += by;
    out.textTo += by;
  }
  return out;
}

/** Writes `text` as a node label, quoting it when mermaid would misread it. */
export function formatText(text) {
  const clean = String(text).replace(/\r?\n/g, "<br>");
  if (/^[\p{L}\p{N}][\p{L}\p{N} _.,:;!?'+*&-]*$/u.test(clean)) return clean;
  return `"${clean.replace(/"/g, "#quot;")}"`;
}

/** A label as the writer would want to read it: without quotes. */
export function readText(raw) {
  const text = raw.trim();
  const unquoted = /^"[\s\S]*"$/.test(text) ? text.slice(1, -1) : text;
  return unquoted.replace(/#quot;/g, '"');
}

// Reads `key: value` from an @{ … } body.
function atField(body, key) {
  const match = new RegExp(`(?:^|,)\\s*${key}\\s*:\\s*("(?:[^"\\\\]|\\\\.)*"|[^,}]*)`).exec(body);
  return match ? match[1].trim() : null;
}

function setAtField(body, key, value) {
  const re = new RegExp(`((?:^|,)\\s*${key}\\s*:\\s*)("(?:[^"\\\\]|\\\\.)*"|[^,}]*?)(\\s*(?:,|$))`);
  if (re.test(body)) return body.replace(re, (_, pre, _old, post) => `${pre}${value}${post}`);
  const trimmed = body.replace(/\s+$/, "");
  const sep = trimmed.trim() ? ", " : " ";
  return `${trimmed}${sep}${key}: ${value} `;
}

/** What the diagram says about node `id`: its text and shape (null when it isn't there). */
export function findNode(source, id) {
  const occurrences = scan(source).filter((t) => t.id === id);
  if (!occurrences.length) return null;
  // Like mermaid, the last definition wins.
  const def = occurrences.filter((t) => t.def).pop()?.def;
  if (!def) return { id, text: id, shape: "rect" };
  if (def.kind === "at") {
    const label = atField(def.body, "label");
    const shape = atField(def.body, "shape");
    return {
      id,
      text: label === null ? id : readText(label),
      shape: shape === null ? "rect" : AT_ALIASES[readText(shape)] || null,
    };
  }
  return { id, text: readText(source.slice(def.textFrom, def.textTo)), shape: def.shape };
}

// Applies edits (non-overlapping {from, to, insert}) from the end backwards.
function applyEdits(source, edits) {
  let out = source;
  for (const e of [...edits].sort((a, b) => b.from - a.from)) out = out.slice(0, e.from) + e.insert + out.slice(e.to);
  return out;
}

// Rewrites every definition of `id` with `change(def) → replacement`, or adds
// one after the node's last line when it has none.
function rewriteNode(source, id, { bracket, at }) {
  const occurrences = scan(source).filter((t) => t.id === id);
  if (!occurrences.length) return source;
  const defs = occurrences.filter((t) => t.def).map((t) => t.def);
  if (!defs.length) {
    const last = occurrences[occurrences.length - 1].line;
    const indent = /^\s*/.exec(last.text)[0];
    return insertAfterLine(source, last, `${indent}${id}${bracket(null)}`);
  }
  return applyEdits(
    source,
    defs.map((def) => ({ from: def.from, to: def.to, insert: def.kind === "at" ? `@{${at(def.body)}}` : bracket(def) })),
  );
}

function insertAfterLine(source, line, text) {
  const end = line.from + line.text.length;
  return source.slice(0, end) + "\n" + text + source.slice(end);
}

/** Changes node `id`'s text. */
export function setNodeText(source, id, text) {
  const label = formatText(text.trim() ? text : id);
  return rewriteNode(source, id, {
    bracket: (def) => {
      const shape = SHAPE_BY_ID.get(def?.shape || "rect");
      return `${shape.open}${label}${shape.close}`;
    },
    at: (body) => setAtField(body, "label", `"${label.replace(/^"|"$/g, "")}"`),
  });
}

/** Changes node `id`'s shape (one of SHAPES' ids), keeping its text. */
export function setNodeShape(source, id, shapeId) {
  const shape = SHAPE_BY_ID.get(shapeId);
  if (!shape) return source;
  const current = findNode(source, id);
  if (!current) return source;
  const label = formatText(current.text);
  return rewriteNode(source, id, {
    bracket: () => `${shape.open}${label}${shape.close}`,
    at: (body) => setAtField(body, "shape", shape.at),
  });
}

/** A node id that isn't used anywhere in `source`. */
export function freshId(source, base = "n") {
  const used = new Set(source.match(/\w+/g) || []);
  let n = 1;
  while (used.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

/**
 * Adds a new node joined to node `id` with an arrow, on the line after the
 * last one that mentions `id` (so it lands in the same subgraph). Returns the
 * new source and the new node's id.
 */
export function addConnectedNode(source, id, { text = "New step", shape = "rect", edgeText = "", before = false } = {}) {
  const occurrences = scan(source).filter((t) => t.id === id);
  const newId = freshId(source);
  const s = SHAPE_BY_ID.get(shape) || SHAPE_BY_ID.get("rect");
  const arrow = edgeText ? `-->|${edgeText.replace(/\|/g, "")}|` : "-->";
  const node = `${newId}${s.open}${formatText(text)}${s.close}`;
  // `before`: the new node leads into this one (added on the side the flow comes from).
  const line = before ? `${node} ${arrow} ${id}` : `${id} ${arrow} ${node}`;
  if (!occurrences.length) {
    return { source: `${source.replace(/\s*$/, "")}\n    ${line}\n`, id: newId };
  }
  const last = occurrences[occurrences.length - 1].line;
  const indent = /^\s*/.exec(last.text)[0] || "    ";
  return { source: insertAfterLine(source, last, indent + line), id: newId };
}

/** The smallest single change turning `before` into `after`, for an editor to apply. */
export function minimalChange(before, after) {
  let start = 0;
  const max = Math.min(before.length, after.length);
  while (start < max && before[start] === after[start]) start++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--;
    endAfter--;
  }
  return { from: start, to: endBefore, insert: after.slice(start, endAfter) };
}

/** The way a flowchart flows: "TB", "BT", "LR" or "RL" (TD reads as TB). */
export function flowDirection(source) {
  for (const line of bodyLines(source)) {
    if (!HEADER_RE.test(line.text)) continue;
    const m = /^\s*(?:flowchart|graph)(?:-elk)?\s+(TB|TD|BT|RL|LR)\b/.exec(line.text);
    return !m || m[1] === "TD" ? "TB" : m[1];
  }
  return "TB";
}

// The indent new top-level lines get: the first body line's, else four spaces.
function bodyIndent(source) {
  let seenHeader = false;
  for (const line of bodyLines(source)) {
    if (!seenHeader) {
      seenHeader = HEADER_RE.test(line.text);
      continue;
    }
    if (line.text.trim() && !/^\s*%%/.test(line.text)) return /^\s*/.exec(line.text)[0] || "    ";
  }
  return "    ";
}

function appendLine(source, text) {
  return `${source.replace(/\s*$/, "")}\n${bodyIndent(source)}${text}\n`;
}

/**
 * Adds a shape that isn't joined to anything. An empty diagram becomes a new
 * flowchart. Returns the new source and the new node's id.
 */
export function addNode(source, { text = "New shape", shape = "rect" } = {}) {
  const s = SHAPE_BY_ID.get(shape) || SHAPE_BY_ID.get("rect");
  const base = source.trim() ? source : "flowchart TD\n";
  const id = freshId(base);
  return { source: appendLine(base, `${id}${s.open}${formatText(text)}${s.close}`), id };
}

/**
 * Joins node `from` to node `to` with an arrow. When both sit in the same
 * subgraph the line goes there, after the later of the two; otherwise it goes
 * at the end, so neither node is pulled into the other's subgraph.
 */
export function connectNodes(source, from, to) {
  if (!from || !to || from === to) return source;
  const all = scan(source);
  const lastOf = (id) => all.filter((t) => t.id === id).pop()?.line;
  const a = lastOf(from);
  const b = lastOf(to);
  const line = `${from} --> ${to}`;
  if (a && b && a.ctx === b.ctx && a.ctx) {
    const later = a.from > b.from ? a : b;
    const indent = /^\s*/.exec(later.text)[0];
    return insertAfterLine(source, later, indent + line);
  }
  return appendLine(source, line);
}

// One link in a chain: `-->`, `---`, `-.->`, `==>`, `~~~`, `-- text -->`,
// `-->|text|`, an edge id (`e1@-->`) and the like.
const LINK_RE =
  /\s*(?:\w+@)?(?:[xo<]?-\.\s(?:[^"]|"[^"]*")*?\.+-[xo>]?|[xo<]?--\s(?:[^"-]|"[^"]*"|-(?!-))*?\s*-{2,}[-xo>]|[xo<]?==\s(?:[^"=]|"[^"]*"|=(?!=))*?\s*={2,}[=xo>]|[xo<]?(?:-{2,}|={2,})[-=xo>]|[xo<]?-?\.+-[xo>]?|~{3,})(?:\s*\|[^|]*\|)?\s*/y;
const ID_RE = /\w+(?:-\w+)*/y;

/**
 * Reads a statement line as a chain: groups of nodes (`A & B`) joined by
 * links. Null when the line is something else.
 */
function parseChain(text) {
  const groups = [];
  const links = [];
  const linkAt = [];
  let i = /^\s*/.exec(text)[0].length;
  const skipSpace = () => {
    while (i < text.length && /\s/.test(text[i])) i++;
  };
  for (;;) {
    const group = [];
    for (;;) {
      skipSpace();
      ID_RE.lastIndex = i;
      const m = ID_RE.exec(text);
      if (!m) return null;
      let j = i + m[0].length;
      if (text[j] === "@" && text[j + 1] !== "{") break; // an edge id: the link reads it
      const def = readShape(text, j);
      if (def) j = def.to;
      if (text.startsWith(":::", j)) {
        j += 3;
        while (j < text.length && /[\w-]/.test(text[j])) j++;
      }
      group.push({ id: m[0], raw: text.slice(i, j), defined: !!def });
      i = j;
      skipSpace();
      if (text[i] !== "&") break;
      i++;
    }
    if (!group.length) return null;
    groups.push(group);
    LINK_RE.lastIndex = i;
    const link = LINK_RE.exec(text);
    if (!link) break;
    links.push(link[0].trim());
    const lead = link[0].length - link[0].trimStart().length;
    linkAt.push({ from: i + lead, to: i + lead + link[0].trim().length });
    i += link[0].length;
  }
  skipSpace();
  if (text[i] === ";") i++;
  skipSpace();
  if (i < text.length && !text.startsWith("%%", i)) return null;
  return { groups, links, linkAt };
}

/**
 * Removes node `id`: its definition, every arrow to or from it, and its
 * `style`/`class`/`click` lines. Other nodes defined on the same lines stay.
 * Returns null when a line holding the node is too unusual to rewrite safely.
 */
export function deleteNode(source, id) {
  const all = scan(source);
  if (!all.some((t) => t.id === id)) return source;
  // How many lines mention each node, to know whether a bare id is still needed.
  const linesWith = new Map();
  for (const t of all) {
    const set = linesWith.get(t.id) || new Set();
    set.add(t.line.from);
    linesWith.set(t.id, set);
  }
  const edits = [];
  const removeLine = (line) => {
    const to = Math.min(source.length, line.from + line.text.length + 1);
    edits.push({ from: line.from, to, insert: "" });
  };
  const esc = id.replace(/[-]/g, "\\-");
  let seenHeader = false;
  for (const line of bodyLines(source)) {
    if (!seenHeader) {
      seenHeader = HEADER_RE.test(line.text);
      continue;
    }
    const { text } = line;
    if (new RegExp(`^\\s*(?:style|click)\\s+${esc}(?![\\w-])`).test(text)) {
      removeLine(line);
      continue;
    }
    const cls = /^(\s*class\s+)([\w,\s-]+?)(\s+[\w-]+\s*;?\s*)$/.exec(text);
    if (cls) {
      const ids = cls[2].split(",").map((s) => s.trim());
      if (!ids.includes(id)) continue;
      const kept = ids.filter((x) => x !== id);
      if (!kept.length) removeLine(line);
      else edits.push({ from: line.from, to: line.from + text.length, insert: `${cls[1]}${kept.join(",")}${cls[3]}` });
      continue;
    }
    if (SKIP_LINE_RE.test(text)) continue;
    if (!scanLine(text).some((t) => t.id === id)) continue;
    const chain = parseChain(text);
    if (!chain) return null;
    const kept = chain.groups.map((g) => g.filter((n) => n.id !== id));
    const pieces = [];
    let cur = null;
    kept.forEach((g, k) => {
      if (!g.length) {
        if (cur) pieces.push(cur);
        cur = null;
      } else if (cur) cur.push(chain.links[k - 1], g);
      else cur = [g];
    });
    if (cur) pieces.push(cur);
    const out = [];
    for (const piece of pieces) {
      if (piece.length === 1) {
        // A node left on its own: keep it when it carries a definition or
        // isn't mentioned anywhere else (or it would vanish).
        const alone = piece[0].filter((n) => n.defined || linesWith.get(n.id).size === 1);
        if (alone.length) out.push(alone.map((n) => n.raw).join(" & "));
      } else {
        out.push(piece.map((p) => (Array.isArray(p) ? p.map((n) => n.raw).join(" & ") : p)).join(" "));
      }
    }
    const indent = /^\s*/.exec(text)[0];
    if (!out.length) removeLine(line);
    else edits.push({ from: line.from, to: line.from + text.length, insert: out.map((o) => indent + o).join("\n") });
  }
  return tidyPresets(applyEdits(source, edits));
}

// ------------------------------------------------------------------ styling

/** Ready-made looks, written as `classDef` lines the first time they're used. */
export const STYLE_PRESETS = [
  { name: "Mint", fill: "#dcf5ea", stroke: "#3aa676", color: "#14532d" },
  { name: "Sky", fill: "#e0ecff", stroke: "#4c7bd9", color: "#1e3a8a" },
  { name: "Rose", fill: "#fde2e4", stroke: "#d9506a", color: "#881337" },
  { name: "Sand", fill: "#fdf0d5", stroke: "#d49a2a", color: "#78350f" },
  { name: "Lilac", fill: "#efe4fb", stroke: "#8e5bd0", color: "#4c1d95" },
  { name: "Forest", fill: "#2f6b4f", stroke: "#1d4634", color: "#ffffff" },
  { name: "Ink", fill: "#2b2f3a", stroke: "#11141a", color: "#ffffff" },
  { name: "Slate", fill: "#eceef2", stroke: "#7b8494", color: "#1f2937" },
];
const PRESET_BY_NAME = new Map(STYLE_PRESETS.map((p) => [p.name, p]));

/** The `classDef` line for a preset. */
export function presetClassDef(name) {
  const p = PRESET_BY_NAME.get(name);
  return p ? `classDef ${p.name} fill:${p.fill},stroke:${p.stroke},color:${p.color}` : null;
}

// Body lines after the header, with offsets.
function afterHeader(source) {
  const out = [];
  let seenHeader = false;
  for (const line of bodyLines(source)) {
    if (!seenHeader) seenHeader = HEADER_RE.test(line.text);
    else out.push(line);
  }
  return out;
}

const CLASSDEF_RE = /^\s*classDef\s+([\w-]+(?:\s*,\s*[\w-]+)*)\s+(.*?)\s*;?\s*$/;
const CLASS_RE = /^(\s*class\s+)([\w-]+(?:\s*,\s*[\w-]+)*)(\s+)([\w-]+)(\s*;?\s*)$/;
const STYLE_RE = /^(\s*style\s+)([\w-]+)(\s+)(.*?)(\s*;?\s*)$/;

/** Parses `fill:#f00,stroke:#333` into [[key, value], …]. */
function readProps(text) {
  return text
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const i = p.indexOf(":");
      return i < 0 ? [p, ""] : [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    });
}

/** The class names the diagram defines with `classDef`, in order. */
export function classDefNames(source) {
  const names = [];
  for (const line of afterHeader(source)) {
    const m = CLASSDEF_RE.exec(line.text);
    if (m) for (const n of m[1].split(",")) if (!names.includes(n.trim())) names.push(n.trim());
  }
  return names;
}

// Where node `id` gets classes: `:::cls` after its tokens, and `class` lines.
function classUses(source, id) {
  const uses = [];
  for (const t of scan(source)) {
    if (t.id !== id) continue;
    const at = t.def ? t.def.to : t.to;
    const m = /^:::([\w-]+)/.exec(source.slice(at));
    if (m) uses.push({ kind: "inline", from: at, to: at + m[0].length, name: m[1] });
  }
  for (const line of afterHeader(source)) {
    const m = CLASS_RE.exec(line.text);
    if (!m) continue;
    const ids = m[2].split(",").map((s) => s.trim());
    if (ids.includes(id)) uses.push({ kind: "line", line, m, ids, name: m[4] });
  }
  return uses;
}

/** The style class node `id` has (the last one given), or null. */
export function nodeClass(source, id) {
  return classUses(source, id).pop()?.name || null;
}

// Every node that uses class `name`, anywhere.
function classIsUsed(source, name) {
  if (new RegExp(`:::${name}(?![\\w-])`).test(source)) return true;
  return afterHeader(source).some((l) => CLASS_RE.exec(l.text)?.[4] === name);
}

function removeLineEdit(source, line) {
  return { from: line.from, to: Math.min(source.length, line.from + line.text.length + 1), insert: "" };
}

/**
 * Gives node `id` the style class `name` (null takes its class away). A preset
 * gets its `classDef` the first time it's used, and nodes sharing a class share
 * one `class a,b Name` line. Presets nobody uses any more are tidied away.
 */
export function setNodeClass(source, id, name) {
  if (!scan(source).some((t) => t.id === id)) return source;
  const edits = [];
  for (const use of classUses(source, id)) {
    if (use.kind === "inline") edits.push({ from: use.from, to: use.to, insert: "" });
    else {
      const kept = use.ids.filter((x) => x !== id);
      const { line, m } = use;
      if (!kept.length) edits.push(removeLineEdit(source, line));
      else edits.push({ from: line.from, to: line.from + line.text.length, insert: `${m[1]}${kept.join(",")}${m[3]}${m[4]}${m[5]}` });
    }
  }
  let out = applyEdits(source, edits);
  if (name) {
    if (!classDefNames(out).includes(name) && PRESET_BY_NAME.has(name)) out = appendLine(out, presetClassDef(name));
    const shared = afterHeader(out).find((l) => CLASS_RE.exec(l.text)?.[4] === name);
    if (shared) {
      const m = CLASS_RE.exec(shared.text);
      out = applyEdits(out, [{ from: shared.from, to: shared.from + shared.text.length, insert: `${m[1]}${m[2]},${id}${m[3]}${m[4]}${m[5]}` }]);
    } else out = appendLine(out, `class ${id} ${name}`);
  }
  return tidyPresets(out);
}

// Drops preset classDefs (exactly as written by setNodeClass) that nothing uses.
function tidyPresets(source) {
  const unused = afterHeader(source).filter((l) => {
    const m = CLASSDEF_RE.exec(l.text);
    return m && PRESET_BY_NAME.has(m[1]) && l.text.trim() === presetClassDef(m[1]) && !classIsUsed(source, m[1]);
  });
  return applyEdits(source, unused.map((l) => removeLineEdit(source, l)));
}

/** Node `id`'s own `style` properties, as an object (`{ fill: "#f00" }`). */
export function nodeStyle(source, id) {
  const props = {};
  for (const line of afterHeader(source)) {
    const m = STYLE_RE.exec(line.text);
    if (m && m[2] === id) for (const [k, v] of readProps(m[4])) props[k] = v;
  }
  return props;
}

/**
 * Sets or clears (null/"") properties on node `id`'s `style` line, adding the
 * line when needed and removing it once it's empty. Values can't hold commas.
 */
export function setNodeStyle(source, id, changes) {
  if (!scan(source).some((t) => t.id === id)) return source;
  const lines = afterHeader(source).filter((l) => STYLE_RE.exec(l.text)?.[2] === id);
  const props = new Map(Object.entries(nodeStyle(source, id)));
  for (const [k, v] of Object.entries(changes)) {
    const clean = v == null ? "" : String(v).replace(/[,;\n]/g, "").trim();
    if (clean) props.set(k, clean);
    else props.delete(k);
  }
  const body = [...props].map(([k, v]) => `${k}:${v}`).join(",");
  if (!lines.length) return body ? appendLine(source, `style ${id} ${body}`) : source;
  const [first, ...rest] = lines;
  const m = STYLE_RE.exec(first.text);
  const edits = rest.map((l) => removeLineEdit(source, l));
  edits.push(body ? { from: first.from, to: first.from + first.text.length, insert: `${m[1]}${id}${m[3]}${body}${m[5]}` } : removeLineEdit(source, first));
  return applyEdits(source, edits);
}

// ------------------------------------------------------------------- arrows

/** Line styles and arrow ends an arrow can have. */
export const LINE_STYLES = ["solid", "dotted", "thick", "invisible"];
export const ARROW_ENDS = ["arrow", "none", "circle", "cross", "both"];

/** What a link token says: its line style, arrow end, label and edge id. */
export function readLink(raw) {
  let text = raw.trim();
  let edgeId = null;
  const idm = /^(\w+)@/.exec(text);
  if (idm) {
    edgeId = idm[1];
    text = text.slice(idm[0].length);
  }
  let label = "";
  const pipe = /\|([^|]*)\|\s*$/.exec(text);
  if (pipe) {
    label = pipe[1];
    text = text.slice(0, pipe.index).trim();
  }
  if (/^~{3,}$/.test(text)) return { line: "invisible", end: "none", label: "", edgeId };
  // Text inside the link: `-- text -->`, `== text ==>`, `-. text .->`.
  const inner = /^([xo<]?)(--|==|-\.)\s+(.*?)\s+(-{2,}|={2,}|\.+-)([-=xo>]?)$/.exec(text);
  let start = "";
  let end = "";
  let line = "solid";
  if (inner) {
    start = inner[1];
    label = inner[3];
    line = inner[2] === "==" ? "thick" : inner[2] === "-." ? "dotted" : "solid";
    end = inner[5];
  } else {
    const m = /^([xo<]?)(.*?)([xo>]?)$/.exec(text);
    start = m[1];
    end = m[3];
    line = m[2].includes("=") ? "thick" : m[2].includes(".") ? "dotted" : "solid";
    // `---` ends in a plain dash; only > o x are ends.
  }
  const endName = { ">": "arrow", o: "circle", x: "cross" }[end] || "none";
  return { line, end: start === "<" && end === ">" ? "both" : endName, label: readText(label), edgeId };
}

/** Writes a link token: `-->`, `-.->|text|`, `==o`, `~~~`, … */
export function writeLink({ line = "solid", end = "arrow", label = "", edgeId = null }) {
  const id = edgeId ? `${edgeId}@` : "";
  if (line === "invisible") return `${id}~~~`;
  const tail = { arrow: ">", both: ">", circle: "o", cross: "x", none: "" }[end] ?? ">";
  const head = end === "both" ? "<" : "";
  let body;
  if (line === "dotted") body = tail ? `-.-${tail}` : "-.-";
  else if (line === "thick") body = tail ? `==${tail}` : "===";
  else body = tail ? `--${tail}` : "---";
  const text = String(label || "").replace(/[|\n]/g, " ").trim();
  const lab = text ? `|${/^[\p{L}\p{N} _.,:;!?'+*&-]*$/u.test(text) ? text : `"${text.replace(/"/g, "#quot;")}"`}|` : "";
  return `${id}${head}${body}${lab}`;
}

/**
 * Every arrow in the flowchart, in order, with the id mermaid gives its drawn
 * path (`L_a_b_0`, or the edge id from `e1@-->`) and where its link sits.
 */
export function listEdges(source) {
  const edges = [];
  const counts = new Map();
  let seenHeader = false;
  for (const line of bodyLines(source)) {
    if (!seenHeader) {
      seenHeader = HEADER_RE.test(line.text);
      continue;
    }
    if (SKIP_LINE_RE.test(line.text)) continue;
    const chain = parseChain(line.text);
    if (!chain) continue;
    chain.links.forEach((raw, k) => {
      const info = readLink(raw);
      for (const a of chain.groups[k]) {
        for (const b of chain.groups[k + 1]) {
          const base = `L_${a.id}_${b.id}_`;
          const n = counts.get(base) || 0;
          counts.set(base, n + 1);
          edges.push({
            id: info.edgeId || `${base}${n}`,
            from: a.id,
            to: b.id,
            ...info,
            line: info.line,
            raw,
            source: { line, chain, index: k, from: line.from + chain.linkAt[k].from, to: line.from + chain.linkAt[k].to },
            simple: chain.groups[k].length === 1 && chain.groups[k + 1].length === 1,
          });
        }
      }
    });
  }
  return edges;
}

/** The arrow whose drawn path has id `edgeId` (as listEdges names them). */
export function findEdge(source, edgeId) {
  return listEdges(source).find((e) => e.id === edgeId) || null;
}

/** Changes an arrow's label, line style or end. Arrows sharing an `&` link change together. */
export function setEdge(source, edgeId, changes) {
  const edge = findEdge(source, edgeId);
  if (!edge) return source;
  const next = { line: edge.line, end: edge.end, label: edge.label, edgeId: edge.edgeId, ...changes };
  const { from, to } = edge.source;
  return source.slice(0, from) + writeLink(next) + source.slice(to);
}

// Rewrites a chain line without link `k`, putting `extra` lines after it.
function splitChainAt(source, edge, extra = [], { dropLeft = false, dropRight = false } = {}) {
  const { line, chain, index: k } = edge.source;
  const all = scan(source);
  const elsewhere = (id) => all.some((t) => t.id === id && t.line.from !== line.from);
  const write = (groups, links) => {
    if (groups.length === 1) {
      const kept = groups[0].filter((n) => n.defined || !elsewhere(n.id));
      return kept.length ? kept.map((n) => n.raw).join(" & ") : null;
    }
    return groups.map((g, i) => (i ? `${links[i - 1]} ` : "") + g.map((n) => n.raw).join(" & ")).join(" ");
  };
  const indent = /^\s*/.exec(line.text)[0];
  const parts = [
    dropLeft ? null : write(chain.groups.slice(0, k + 1), chain.links.slice(0, k)),
    dropRight ? null : write(chain.groups.slice(k + 1), chain.links.slice(k + 1)),
    ...extra,
  ].filter(Boolean);
  if (!parts.length) {
    const to = Math.min(source.length, line.from + line.text.length + 1);
    return source.slice(0, line.from) + source.slice(to);
  }
  return source.slice(0, line.from) + parts.map((p) => indent + p).join("\n") + source.slice(line.from + line.text.length);
}

/** Removes one arrow. Null when it shares an `&` link with others. */
export function deleteEdge(source, edgeId) {
  const edge = findEdge(source, edgeId);
  if (!edge) return source;
  if (!edge.simple) return null;
  return splitChainAt(source, edge);
}

/** Points an arrow the other way. Null when it shares an `&` link with others. */
export function reverseEdge(source, edgeId) {
  const edge = findEdge(source, edgeId);
  if (!edge) return source;
  if (!edge.simple) return null;
  const { chain, index: k } = edge.source;
  if (chain.groups.length === 2) {
    // `a --> b` (definitions and all) becomes `b --> a`.
    const { line } = edge.source;
    const indent = /^\s*/.exec(line.text)[0];
    const rest = line.text.trimEnd().match(/;?\s*(%%.*)?$/)[0];
    const text = `${indent}${chain.groups[1][0].raw} ${chain.links[0]} ${chain.groups[0][0].raw}${rest ? ` ${rest.trim()}` : ""}`;
    return source.slice(0, line.from) + text.trimEnd() + source.slice(line.from + line.text.length);
  }
  // A node left on its own by the split moves, definition and all, onto the reversed line.
  const dropLeft = k === 0;
  const dropRight = k === chain.groups.length - 2;
  const a = chain.groups[k][0];
  const b = chain.groups[k + 1][0];
  const line = `${dropRight ? b.raw : b.id} ${chain.links[k]} ${dropLeft ? a.raw : a.id}`;
  return splitChainAt(source, edge, [line], { dropLeft, dropRight });
}
