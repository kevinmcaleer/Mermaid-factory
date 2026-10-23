// Best-effort conversion of a diagram's content from one type to another.
//
// Each supported type is parsed into one of three shared models and written
// back out from it:
//   graph  (flowchart, state, sequence, class, er): nodes + labelled edges
//   tree   (mindmap, kanban, timeline): nested labelled items
//   series (pie, xychart): labelled numbers
// Graph and tree convert into each other; series only convert among
// themselves. Anything else returns null and the caller falls back to the
// starter template. Comments, styling and type-specific details are dropped.
// Pure functions only (no DOM), so this runs in tests too.

const FAMILY = {
  flowchart: "graph",
  state: "graph",
  sequence: "graph",
  class: "graph",
  er: "graph",
  mindmap: "tree",
  kanban: "tree",
  timeline: "tree",
  pie: "series",
  xychart: "series",
};

/** True when `from` content can be carried into a `to` diagram. */
export function canConvert(from, to) {
  const a = FAMILY[from];
  const b = FAMILY[to];
  if (!a || !b || from === to) return false;
  return a === b || (a !== "series" && b !== "series");
}

/** Convert the diagram body (no front matter) from one type to another.
 *  Returns the new code, or null when there's nothing to carry over. */
export function convertDiagram(body, from, to) {
  if (!canConvert(from, to)) return null;
  const lines = cleanLines(body);
  const model = PARSERS[from](lines);
  const target = FAMILY[to];
  let input;
  if (FAMILY[from] === target) input = model;
  else if (target === "tree") input = graphToTree(model);
  else input = treeToGraph(model);
  if (isEmpty(input)) return null;
  return WRITERS[to](input);
}

function isEmpty(model) {
  if (model.nodes) return model.nodes.size === 0;
  if (model.roots) return model.roots.length === 0;
  return model.items.length === 0;
}

/** Drop front matter, the header line, comments and directives; keep indentation. */
function cleanLines(body) {
  const out = [];
  let inDirective = false;
  let headerSeen = false;
  body = body.replace(/\r\n/g, "\n").replace(/^\s*---[ \t]*\n[\s\S]*?\n---[ \t]*(?:\n|$)/, "");
  for (const raw of body.split("\n")) {
    const text = raw.trim();
    if (inDirective) {
      if (text.includes("}%%")) inDirective = false;
      continue;
    }
    if (text.startsWith("%%{")) {
      inDirective = !text.includes("}%%");
      continue;
    }
    if (!text || text.startsWith("%%")) continue;
    if (!headerSeen) {
      headerSeen = true;
      out.header = text;
      continue;
    }
    out.push(raw.replace(/\s+$/, ""));
  }
  if (!out.header) out.header = "";
  return out;
}

// ---------------------------------------------------------------- models

function newGraph() {
  return { title: "", nodes: new Map(), edges: [] };
}

function addNode(g, id, label, kind) {
  const node = g.nodes.get(id);
  if (!node) g.nodes.set(id, { id, label: label || id, kind });
  else if (label && node.label === node.id) node.label = label;
  return id;
}

/** Turn a graph into a forest: roots are nodes nothing points at. Each node
 *  appears once, under the first parent that reaches it. State start/end
 *  markers are left out. */
function graphToTree(g) {
  const ids = [...g.nodes.keys()].filter((id) => !g.nodes.get(id).kind);
  const children = new Map(ids.map((id) => [id, []]));
  const incoming = new Set();
  for (const e of g.edges) {
    if (e.from === e.to || !children.has(e.from) || !children.has(e.to)) continue;
    children.get(e.from).push(e.to);
    incoming.add(e.to);
  }
  const seen = new Set();
  const build = (id) => {
    seen.add(id);
    const item = { label: g.nodes.get(id).label, children: [] };
    for (const k of children.get(id)) if (!seen.has(k)) item.children.push(build(k));
    return item;
  };
  const roots = [];
  for (const id of ids) if (!incoming.has(id) && !seen.has(id)) roots.push(build(id));
  for (const id of ids) if (!seen.has(id)) roots.push(build(id)); // cycles
  return { title: g.title, roots };
}

/** Turn a forest into a graph with an edge from each item to its children. */
function treeToGraph(t) {
  const g = newGraph();
  g.title = t.title;
  let n = 0;
  const walk = (item, parent) => {
    const id = `n${++n}`;
    addNode(g, id, item.label);
    if (parent) g.edges.push({ from: parent, to: id, label: "" });
    item.children.forEach((c) => walk(c, id));
  };
  t.roots.forEach((r) => walk(r, null));
  return g;
}

// ------------------------------------------------------------- utilities

const unquote = (s) => s.trim().replace(/^"([\s\S]*)"$/, "$1").replace(/^`([\s\S]*)`$/, "$1").trim();
const plain = (s) =>
  unquote(s)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/#quot;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** Make a label safe inside double quotes. */
const quoted = (s) => `"${plain(s).replace(/"/g, "#quot;")}"`;
/** Make a label safe as bare text: no brackets, colons or quotes. */
const bare = (s) =>
  plain(s)
    .replace(/[()[\]{}<>"`:;#]/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "Item";

/** Map arbitrary node ids onto safe ones, keeping simple ids as they are. */
function idMapper(reserved = []) {
  const map = new Map();
  const used = new Set();
  const lower = new Set(reserved.map((w) => w.toLowerCase()));
  let n = 0;
  return (id) => {
    if (map.has(id)) return map.get(id);
    let safe = /^[A-Za-z][A-Za-z0-9_]*$/.test(id) && !lower.has(id.toLowerCase()) ? id : "";
    if (!safe || used.has(safe)) {
      do safe = `n${++n}`;
      while (used.has(safe));
    }
    map.set(id, safe);
    used.add(safe);
    return safe;
  };
}

function titleLine(lines) {
  const i = lines.findIndex((l) => /^\s*title\b/.test(l));
  if (i < 0) return "";
  const [line] = lines.splice(i, 1);
  return plain(line.trim().replace(/^title\s*/, ""));
}

// --------------------------------------------------------------- parsers

const SHAPES = [
  ["@{", "}"],
  ["(((", ")))"],
  ["([", "])"],
  ["[[", "]]"],
  ["[(", ")]"],
  ["((", "))"],
  ["{{", "}}"],
  ["[/", "/]"],
  ["[/", "\\]"],
  ["[\\", "\\]"],
  ["[\\", "/]"],
  ["[", "]"],
  ["(", ")"],
  ["{", "}"],
  [">", "]"],
];

/** Read `id` plus an optional shape like [label] at `pos`. */
function readNode(text, pos) {
  const m = /^\s*([\p{L}\p{N}_]+(?:[-.][\p{L}\p{N}_]+)*)/u.exec(text.slice(pos));
  if (!m) return null;
  const id = m[1];
  pos += m[0].length;
  let label = "";
  for (const [open, close] of SHAPES) {
    if (!text.startsWith(open, pos)) continue;
    const end = findClose(text, pos + open.length, close);
    if (end < 0) continue;
    const inner = text.slice(pos + open.length, end);
    label = open === "@{" ? (/label\s*:\s*("[^"]*"|[^,}]+)/.exec(inner)?.[1] ?? "") : inner;
    pos = end + close.length;
    break;
  }
  const cls = /^:::[\w-]+/.exec(text.slice(pos));
  if (cls) pos += cls[0].length;
  return { id, label: plain(label), pos };
}

/** Find `close`, skipping over a "quoted" section. */
function findClose(text, from, close) {
  let i = from;
  while (i < text.length) {
    if (text[i] === '"') {
      const q = text.indexOf('"', i + 1);
      if (q < 0) return -1;
      i = q + 1;
      continue;
    }
    if (text.startsWith(close, i)) return i;
    i++;
  }
  return -1;
}

const LINK_RE =
  /^\s*(?:[<ox]?(?:-{2,}|={2,}|-\.+-?)[->ox]?\|([^|]*)\||[<ox]?(?:--|==|-\.)\s+(.+?)\s+(?:-{2,}|={2,}|\.+-)[->ox]|[<ox]?(?:-{2,}|={2,}|-\.+-?)[->ox]?|~~~)(?:\|([^|]*)\|)?/;

function parseFlowchart(lines) {
  const g = newGraph();
  g.title = titleLine(lines);
  const skip = /^(style|classDef|class|click|linkStyle|direction|end|accTitle|accDescr)\b/;
  for (const raw of lines) {
    for (let stmt of raw.split(";")) {
      stmt = stmt.trim();
      // Subgraphs are flattened: their nodes and edges are kept, the grouping isn't.
      if (!stmt || skip.test(stmt) || /^subgraph\b/.test(stmt)) continue;
      parseFlowStatement(g, stmt);
    }
  }
  return g;
}

function parseFlowStatement(g, stmt) {
  let pos = 0;
  let prev = null;
  let pendingLabel = null;
  while (pos < stmt.length) {
    const group = [];
    for (;;) {
      const node = readNode(stmt, pos);
      if (!node) return;
      group.push(addNode(g, node.id, node.label));
      pos = node.pos;
      const amp = /^\s*&\s*/.exec(stmt.slice(pos));
      if (!amp) break;
      pos += amp[0].length;
    }
    if (prev) for (const a of prev) for (const b of group) g.edges.push({ from: a, to: b, label: pendingLabel || "" });
    const link = LINK_RE.exec(stmt.slice(pos));
    if (!link) return;
    pos += link[0].length;
    pendingLabel = plain(link[1] ?? link[2] ?? link[3] ?? "");
    prev = group;
  }
}

function parseState(lines) {
  const g = newGraph();
  g.title = titleLine(lines);
  let inNote = false;
  const endpoint = (raw, side) => {
    const name = raw.trim().replace(/:::[\w-]+$/, "");
    if (name === "[*]") return addNode(g, side === "from" ? "[*]start" : "[*]end", side === "from" ? "Start" : "End", side === "from" ? "start" : "end");
    return addNode(g, name);
  };
  for (const raw of lines) {
    const text = raw.trim();
    if (inNote) {
      if (/^end note$/.test(text)) inNote = false;
      continue;
    }
    if (/^note\b/.test(text)) {
      inNote = !text.includes(":");
      continue;
    }
    if (/^(direction|classDef|class|style|accTitle|accDescr|--|})\b/.test(text) || text === "}" || text === "--") continue;
    let m = /^state\s+"([^"]*)"\s+as\s+(\S+)/.exec(text);
    if (m) {
      addNode(g, m[2], plain(m[1]));
      continue;
    }
    m = /^state\s+([^\s{]+)/.exec(text);
    if (m) {
      if (!/<<\w+>>/.test(text)) addNode(g, m[1]);
      continue;
    }
    m = /^(\S+)\s*-->\s*([^:]+?)\s*(?::\s*(.*))?$/.exec(text);
    if (m) {
      g.edges.push({ from: endpoint(m[1], "from"), to: endpoint(m[2], "to"), label: plain(m[3] || "") });
      continue;
    }
    m = /^([^\s:]+)\s*:\s*(.+)$/.exec(text);
    if (m) {
      const id = addNode(g, m[1]);
      const node = g.nodes.get(id);
      if (node.label === id) node.label = plain(m[2]);
      continue;
    }
    if (/^[^\s:]+$/.test(text)) addNode(g, text.replace(/:::[\w-]+$/, ""));
  }
  return g;
}

const SEQ_ARROW = /^(.+?)\s*(<<-->>|<<->>|-->>|->>|-->|->|--x|-x|--\)|-\))\s*[+-]?\s*(.+?)\s*:\s*(.*)$/;

function parseSequence(lines) {
  const g = newGraph();
  g.title = titleLine(lines);
  for (const raw of lines) {
    const text = raw.trim().replace(/^create\s+/, "");
    let m = /^(?:participant|actor)\s+(.+?)(?:\s+as\s+(.+))?$/.exec(text);
    if (m) {
      addNode(g, m[1].replace(/@\{.*\}$/, "").trim(), plain(m[2] || ""));
      continue;
    }
    m = SEQ_ARROW.exec(text);
    if (m) g.edges.push({ from: addNode(g, m[1].trim()), to: addNode(g, m[3].trim()), label: plain(m[4]) });
  }
  return g;
}

const CLASS_ARROW = /^(\S+?)\s*(?:"[^"]*"\s*)?(<\|--|--\|>|\*--|--\*|o--|--o|<--|-->|<\|\.\.|\.\.\|>|<\.\.|\.\.>|--|\.\.)\s*(?:"[^"]*"\s*)?(\S+?)\s*(?::\s*(.*))?$/;

function parseClass(lines) {
  const g = newGraph();
  g.title = titleLine(lines);
  let depth = 0;
  const name = (s) => s.replace(/~[^~]*~/g, "").replace(/:::[\w-]+$/, "");
  for (const raw of lines) {
    const text = raw.trim();
    if (depth > 0) {
      if (text.endsWith("{")) depth++;
      if (text === "}") depth--;
      continue;
    }
    let m = /^class\s+([^\s{["]+)(?:\["([^"]*)"\])?/.exec(text);
    if (m) {
      addNode(g, name(m[1]), plain(m[2] || ""));
      if (text.endsWith("{")) depth = 1;
      continue;
    }
    if (/^namespace\b/.test(text) || text === "}") continue;
    m = CLASS_ARROW.exec(text);
    if (m) g.edges.push({ from: addNode(g, name(m[1])), to: addNode(g, name(m[3])), label: plain(m[4] || "") });
  }
  return g;
}

function parseEr(lines) {
  const g = newGraph();
  g.title = titleLine(lines);
  let inBody = false;
  const entity = (s) => {
    const m = /^"?([^"[\s]+)"?(?:\[\s*"?([^\]"]*)"?\s*\])?$/.exec(s.trim());
    return m ? addNode(g, m[1], plain(m[2] || "")) : addNode(g, s.trim());
  };
  for (const raw of lines) {
    const text = raw.trim();
    if (inBody) {
      if (text === "}") inBody = false;
      continue;
    }
    let m = /^(\S+?)\s+(\S*(?:--|\.\.)\S*)\s+(\S+)\s*:\s*(.+)$/.exec(text);
    if (m) {
      g.edges.push({ from: entity(m[1]), to: entity(m[3]), label: plain(m[4]) });
      continue;
    }
    m = /^(\S+?(?:\[[^\]]*\])?)\s*\{$/.exec(text);
    if (m) {
      entity(m[1]);
      inBody = true;
      continue;
    }
    if (/^(direction|style|classDef|class)\b/.test(text)) continue;
    if (/^[^\s:{}]+$/.test(text)) entity(text);
  }
  return g;
}

/** Indentation-based trees (mindmap, kanban). */
function parseIndented(lines, labelOf) {
  const roots = [];
  const stack = [];
  for (const raw of lines) {
    const text = raw.trim();
    if (text.startsWith("::icon") || text.startsWith(":::")) continue;
    const indent = raw.length - raw.trimStart().length;
    const item = { label: labelOf(text), children: [], indent };
    while (stack.length && stack.at(-1).indent >= indent) stack.pop();
    (stack.length ? stack.at(-1).children : roots).push(item);
    stack.push(item);
  }
  const strip = (i) => ({ label: i.label, children: i.children.map(strip) });
  return roots.map(strip);
}

function nodeText(text) {
  const node = readNode(text, 0);
  if (node && node.pos > 0 && node.label) return node.label;
  // Mindmap's bang and cloud shapes: id))text(( and id)text(
  const m = /^[\w-]*\s*\)+([\s\S]*?)\(+$/.exec(text);
  if (m) return plain(m[1]);
  return plain(text.replace(/\s*@\{[\s\S]*\}$/, ""));
}

function parseMindmap(lines) {
  return { title: "", roots: parseIndented(lines, nodeText) };
}

function parseKanban(lines) {
  return { title: titleLine(lines), roots: parseIndented(lines, nodeText) };
}

function parseTimeline(lines) {
  const title = titleLine(lines);
  const roots = [];
  for (const raw of lines) {
    const text = raw.trim();
    if (/^section\b/.test(text)) continue;
    const parts = text.split(/\s*:\s*/);
    if (text.startsWith(":")) {
      const last = roots.at(-1);
      if (last) parts.slice(1).forEach((p) => p && last.children.push({ label: plain(p), children: [] }));
      continue;
    }
    roots.push({
      label: plain(parts[0]),
      children: parts.slice(1).filter(Boolean).map((p) => ({ label: plain(p), children: [] })),
    });
  }
  return { title, roots };
}

function parsePie(lines) {
  let title = titleLine(lines);
  const inline = /^pie(?:\s+showData)?\s+title\s+(.+)$/.exec(lines.header);
  if (inline) title = plain(inline[1]);
  const items = [];
  for (const raw of lines) {
    const m = /^\s*"([^"]*)"\s*:\s*(-?[\d.]+)/.exec(raw);
    if (m) items.push({ label: m[1], value: Number(m[2]) });
  }
  return { title, items };
}

function parseXychart(lines) {
  const title = titleLine(lines);
  let labels = [];
  let values = null;
  const list = (s) => s.split(",").map((x) => plain(x)).filter((x) => x !== "");
  for (const raw of lines) {
    const text = raw.trim();
    let m = /^x-axis\b.*?\[(.*)\]/.exec(text);
    if (m) labels = list(m[1]);
    m = /^(?:bar|line)\b.*?\[(.*)\]/.exec(text);
    if (m && !values) values = list(m[1]).map((v) => Number(v) || 0);
  }
  values = values || [];
  const items = values.map((value, i) => ({ label: labels[i] ?? `Item ${i + 1}`, value }));
  return { title, items };
}

const PARSERS = {
  flowchart: parseFlowchart,
  state: parseState,
  sequence: parseSequence,
  class: parseClass,
  er: parseEr,
  mindmap: parseMindmap,
  kanban: parseKanban,
  timeline: parseTimeline,
  pie: parsePie,
  xychart: parseXychart,
};

// --------------------------------------------------------------- writers

const indent = (s) => `    ${s}`;
const withTitle = (head, title) => [head, ...(title ? [indent(`title ${bare(title)}`)] : [])];

function writeFlowchart(g) {
  const id = idMapper(["end", "graph", "subgraph", "style", "class", "classDef", "click", "linkStyle", "default", "flowchart"]);
  const out = ["flowchart TD"];
  for (const node of g.nodes.values()) {
    if (node.kind === "start" || node.kind === "end") out.push(indent(`${id(node.id)}((${quoted(node.label)}))`));
    else out.push(indent(`${id(node.id)}[${quoted(node.label)}]`));
  }
  for (const e of g.edges) {
    const label = plain(e.label) ? `|${quoted(e.label)}|` : "";
    out.push(indent(`${id(e.from)} -->${label} ${id(e.to)}`));
  }
  return out.join("\n") + "\n";
}

function writeState(g) {
  const id = idMapper(["state", "note", "end", "direction", "class", "classDef", "style"]);
  const ref = (key) => (g.nodes.get(key).kind === "start" || g.nodes.get(key).kind === "end" ? "[*]" : id(key));
  const out = ["stateDiagram-v2"];
  for (const node of g.nodes.values()) {
    if (node.kind) continue;
    const safe = id(node.id);
    if (plain(node.label) !== safe) out.push(indent(`state ${quoted(node.label)} as ${safe}`));
    else out.push(indent(safe));
  }
  for (const e of g.edges) {
    const label = plain(e.label) ? ` : ${bare(e.label)}` : "";
    out.push(indent(`${ref(e.from)} --> ${ref(e.to)}${label}`));
  }
  return out.join("\n") + "\n";
}

function writeSequence(g) {
  const id = idMapper(["participant", "actor", "as", "end", "loop", "alt", "else", "opt", "par", "and", "rect", "note", "over", "box", "create", "destroy", "activate", "deactivate", "autonumber", "critical", "break", "title", "links", "link", "properties", "details"]);
  const out = withTitle("sequenceDiagram", g.title);
  for (const node of g.nodes.values()) {
    const safe = id(node.id);
    const label = bare(node.label);
    out.push(indent(label === safe ? `participant ${safe}` : `participant ${safe} as ${label}`));
  }
  for (const e of g.edges) out.push(indent(`${id(e.from)}->>${id(e.to)}: ${plain(e.label) ? bare(e.label) : " "}`));
  return out.join("\n") + "\n";
}

function writeClass(g) {
  const id = idMapper(["class", "namespace", "note", "direction", "style", "classDef", "cssClass", "click", "link", "callback"]);
  const out = ["classDiagram"];
  for (const node of g.nodes.values()) {
    const safe = id(node.id);
    out.push(indent(plain(node.label) === safe ? `class ${safe}` : `class ${safe}[${quoted(node.label)}]`));
  }
  for (const e of g.edges) {
    const label = plain(e.label) ? ` : ${bare(e.label)}` : "";
    out.push(indent(`${id(e.from)} --> ${id(e.to)}${label}`));
  }
  return out.join("\n") + "\n";
}

function writeEr(g) {
  const id = idMapper(["direction", "style", "classDef", "class", "erDiagram"]);
  const out = ["erDiagram"];
  for (const node of g.nodes.values()) {
    const safe = id(node.id);
    out.push(indent(plain(node.label) === safe ? safe : `${safe}[${quoted(node.label)}]`));
  }
  for (const e of g.edges) out.push(indent(`${id(e.from)} ||--o{ ${id(e.to)} : ${quoted(plain(e.label) || "relates to")}`));
  return out.join("\n") + "\n";
}

/** A tree with a single root; extra roots go under the title (or "Diagram"). */
function singleRoot(t) {
  if (t.roots.length === 1) return t.roots[0];
  return { label: t.title || "Diagram", children: t.roots };
}

/** Top-level groups; a lone root (say, a mindmap's centre) becomes the title. */
function groups(t) {
  if (t.roots.length === 1 && t.roots[0].children.length) return { title: t.roots[0].label, roots: t.roots[0].children };
  return t;
}

function writeMindmap(t) {
  const out = ["mindmap"];
  const root = singleRoot(t);
  out.push(`  root((${bare(root.label)}))`);
  const walk = (item, depth) => {
    out.push(`${"  ".repeat(depth + 2)}${bare(item.label)}`);
    item.children.forEach((c) => walk(c, depth + 1));
  };
  root.children.forEach((c) => walk(c, 0));
  return out.join("\n") + "\n";
}

function writeKanban(t) {
  t = groups(t);
  const out = ["kanban"];
  let n = 0;
  const flatten = (items) => items.flatMap((i) => [i, ...flatten(i.children)]);
  for (const column of t.roots) {
    out.push(indent(`col${++n}[${bare(column.label)}]`));
    for (const card of flatten(column.children)) out.push(indent(indent(`t${++n}[${bare(card.label)}]`)));
  }
  return out.join("\n") + "\n";
}

function writeTimeline(t) {
  t = groups(t);
  const out = withTitle("timeline", t.title);
  const flatten = (items) => items.flatMap((i) => [i, ...flatten(i.children)]);
  for (const period of t.roots) {
    const events = flatten(period.children).map((e) => bare(e.label));
    out.push(indent([bare(period.label), ...events].join(" : ")));
  }
  return out.join("\n") + "\n";
}

function writePie(s) {
  const out = withTitle("pie", s.title);
  for (const item of s.items) out.push(indent(`${quoted(item.label)} : ${Math.abs(item.value) || 0}`));
  return out.join("\n") + "\n";
}

function writeXychart(s) {
  const out = s.title ? ["xychart", indent(`title ${quoted(s.title)}`)] : ["xychart"];
  out.push(indent(`x-axis [${s.items.map((i) => quoted(i.label)).join(", ")}]`));
  out.push(indent(`bar [${s.items.map((i) => i.value).join(", ")}]`));
  return out.join("\n") + "\n";
}

const WRITERS = {
  flowchart: writeFlowchart,
  state: writeState,
  sequence: writeSequence,
  class: writeClass,
  er: writeEr,
  mindmap: writeMindmap,
  kanban: writeKanban,
  timeline: writeTimeline,
  pie: writePie,
  xychart: writeXychart,
};
