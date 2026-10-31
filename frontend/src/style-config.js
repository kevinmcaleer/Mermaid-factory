// The Style panel's settings (and the toolbar theme) written into the code
// as front-matter config, and read back out of it.
//
// A diagram saved in Mermaid Factory keeps its theme and style beside the
// code. A diagram that goes back to another page ("Save to <label>") only
// takes its code, so the style rides in the code's front matter there:
//
//   ---
//   config:
//     theme: forest
//     look: handDrawn
//     flowchart:
//       curve: step
//   ---
//   flowchart TD
//
// Only settings that differ from the defaults are written. Reading takes
// those keys out again (they live in the Style panel while the diagram is
// open here) and leaves everything else in the front matter as it was.
// Front matter this can't follow line by line (a `config: { … }` on one
// line, say) is left alone.

const FENCE = /^---[ \t]*$/;
const CONFIG_LINE = /^config:[ \t]*(?:#.*)?$/;
const KEY_LINE = /^([ \t]*)([A-Za-z_][\w-]*):(?:[ \t]+(.*?))?[ \t]*$/;
const SCALAR_KEYS = ["theme", "look", "layout", "fontFamily"];

const indentOf = (line) => /^[ \t]*/.exec(line)[0].length;
const isBlank = (line) => !line.trim() || line.trim().startsWith("#");

function readScalar(text) {
  if (text === undefined || text === "") return null;
  if (text.startsWith('"')) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
  if (text.startsWith("'")) {
    const m = /^'((?:[^']|'')*)'$/.exec(text);
    return m ? m[1].replace(/''/g, "'") : null;
  }
  if (/^[[{|>&*!]/.test(text)) return null;
  return text.replace(/[ \t]+#.*$/, "") || null;
}

const writeScalar = (value) => (/^[A-Za-z0-9_.-]+$/.test(value) ? value : JSON.stringify(value));

/** Splits off front matter: { lines, rest } (lines between the fences), or null. */
function splitFrontMatter(source) {
  const lead = /^\s*/.exec(source)[0];
  const lines = source.slice(lead.length).split("\n");
  if (!FENCE.test(lines[0].replace(/\r$/, ""))) return null;
  for (let i = 1; i < lines.length; i++) {
    if (FENCE.test(lines[i].replace(/\r$/, ""))) {
      return { lines: lines.slice(1, i).map((l) => l.replace(/\r$/, "")), rest: lines.slice(i + 1).join("\n") };
    }
  }
  return null;
}

const joinFrontMatter = (lines, rest) =>
  lines.some((l) => l.trim()) ? `---\n${lines.join("\n")}\n---\n${rest}` : rest;

/** Index range [start, end) of the lines indented under line `at`. */
function blockEnd(lines, at) {
  const base = indentOf(lines[at]);
  let end = at + 1;
  while (end < lines.length && (isBlank(lines[end]) || indentOf(lines[end]) > base)) end++;
  // Trailing blank lines belong to whatever comes next.
  while (end > at + 1 && !lines[end - 1].trim()) end--;
  return end;
}

/** Child key lines of the block at `at`: [{ index, key, value, end }]. */
function children(lines, at) {
  const end = blockEnd(lines, at);
  const out = [];
  let indent = null;
  for (let i = at + 1; i < end; i++) {
    if (isBlank(lines[i])) continue;
    const m = KEY_LINE.exec(lines[i]);
    indent ??= indentOf(lines[i]);
    if (indentOf(lines[i]) !== indent) continue;
    if (!m) return null; // a list item or something else this doesn't follow
    out.push({ index: i, key: m[2], value: m[3], end: blockEnd(lines, i) });
  }
  return { items: out, indent, end };
}

/**
 * Takes the theme and style settings out of the code's front matter.
 * Returns { source, theme, config } where theme is null when the code
 * doesn't set one and config has look/layout/curve/fontFamily as set.
 */
export function liftStyle(source) {
  const none = { source, theme: null, config: {} };
  const fm = splitFrontMatter(source);
  if (!fm) return none;
  const lines = [...fm.lines];
  const at = lines.findIndex((l) => CONFIG_LINE.test(l));
  if (at < 0) return none;
  const block = children(lines, at);
  if (!block) return none;

  let theme = null;
  const config = {};
  const drop = new Set();
  for (const item of block.items) {
    if (SCALAR_KEYS.includes(item.key) && item.end === item.index + 1) {
      const value = readScalar(item.value);
      if (value === null) continue;
      if (item.key === "theme") theme = value;
      else config[item.key] = value;
      drop.add(item.index);
    } else if (item.key === "flowchart" && !item.value) {
      const sub = children(lines, item.index);
      if (!sub) continue;
      const curve = sub.items.find((s) => s.key === "curve" && s.end === s.index + 1);
      const value = curve && readScalar(curve.value);
      if (!value) continue;
      config.curve = value;
      drop.add(curve.index);
      if (sub.items.length === 1) for (let i = item.index; i < sub.end; i++) drop.add(i);
    }
  }
  if (!drop.size) return none;
  if (block.items.every((item) => drop.has(item.index))) for (let i = at; i < block.end; i++) drop.add(i);
  const kept = lines.filter((_, i) => !drop.has(i));
  return { source: joinFrontMatter(kept, fm.rest), theme, config };
}

/**
 * The code with `theme` and `config`'s style settings written into its front
 * matter (replacing any it had). Defaults (theme "default", empty settings)
 * aren't written.
 */
export function withStyle(source, theme, config = {}) {
  const lifted = liftStyle(source);
  const base = lifted.source;
  const scalars = [];
  if (theme && theme !== "default") scalars.push(["theme", theme]);
  for (const key of ["look", "layout", "fontFamily"]) if (config[key]) scalars.push([key, config[key]]);
  const curve = config.curve || null;
  if (!scalars.length && !curve) return base;

  const fm = splitFrontMatter(base);
  const lines = fm ? [...fm.lines] : [];
  const rest = fm ? fm.rest : base.replace(/^\s*\n/, "");
  const at = lines.findIndex((l) => CONFIG_LINE.test(l));
  const block = at >= 0 ? children(lines, at) : null;
  // A config this can't add to safely (on one line, say): leave it be.
  if ((at >= 0 && !block) || (at < 0 && lines.some((l) => /^config:/.test(l)))) return source;

  if (at < 0) {
    const add = ["config:", ...scalars.map(([k, v]) => `  ${k}: ${writeScalar(v)}`)];
    if (curve) add.push("  flowchart:", `    curve: ${writeScalar(curve)}`);
    return joinFrontMatter([...lines, ...add], rest);
  }

  const pad = " ".repeat(block.indent ?? 2);
  const add = scalars.map(([k, v]) => `${pad}${k}: ${writeScalar(v)}`);
  if (curve) {
    const flow = block.items.find((item) => item.key === "flowchart" && !item.value);
    const sub = flow && children(lines, flow.index);
    if (sub) {
      const subPad = " ".repeat(sub.indent ?? indentOf(lines[flow.index]) + 2);
      lines.splice(flow.index + 1, 0, `${subPad}curve: ${writeScalar(curve)}`);
    } else {
      add.push(`${pad}flowchart:`, `${pad}${pad}curve: ${writeScalar(curve)}`);
    }
  }
  lines.splice(at + 1, 0, ...add);
  return joinFrontMatter(lines, rest);
}

/** True when the code picks its own theme (front matter or an init directive). */
export function setsOwnTheme(source) {
  if (liftStyle(source).theme) return true;
  return /%%\{\s*init\s*:[\s\S]*?["']?theme["']?\s*:/.test(source);
}
