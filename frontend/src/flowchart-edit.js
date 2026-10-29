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
  for (const line of bodyLines(source)) {
    if (!seenHeader) {
      if (HEADER_RE.test(line.text)) seenHeader = true;
      continue;
    }
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
export function addConnectedNode(source, id, { text = "New step", shape = "rect", edgeText = "" } = {}) {
  const occurrences = scan(source).filter((t) => t.id === id);
  const newId = freshId(source);
  const s = SHAPE_BY_ID.get(shape) || SHAPE_BY_ID.get("rect");
  const arrow = edgeText ? `-->|${edgeText.replace(/\|/g, "")}|` : "-->";
  const line = `${id} ${arrow} ${newId}${s.open}${formatText(text)}${s.close}`;
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
