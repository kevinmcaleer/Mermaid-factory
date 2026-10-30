// A lightweight Mermaid syntax highlighter for CodeMirror 6 (stream parser).
// It doesn't validate anything; mermaid.js does that on render.

import { HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

const DIAGRAM_KEYWORDS = new Set([
  "flowchart", "flowchart-elk", "graph", "sequenceDiagram", "classDiagram", "stateDiagram",
  "stateDiagram-v2", "erDiagram", "journey", "gantt", "pie", "quadrantChart", "requirementDiagram",
  "gitGraph", "C4Context", "C4Container", "C4Component", "C4Dynamic", "C4Deployment", "mindmap",
  "timeline", "sankey", "sankey-beta", "xychart", "xychart-beta", "block", "block-beta", "packet",
  "packet-beta", "kanban", "architecture-beta", "architecture", "radar-beta", "treemap", "treemap-beta",
  "venn-beta", "ishikawa", "ishikawa-beta", "wardley-beta", "railroad-beta", "treeView-beta",
  "usecase-beta", "cynefin-beta", "swimlane-beta", "eventmodeling", "agentflow-beta", "info",
]);

const KEYWORDS = new Set([
  "subgraph", "end", "direction", "participant", "actor", "as", "loop", "alt", "else", "opt", "par",
  "and", "rect", "critical", "break", "note", "Note", "over", "left", "right", "of", "activate",
  "deactivate", "autonumber", "box", "create", "destroy", "class", "classDef", "style", "linkStyle",
  "click", "call", "href", "state", "title", "section", "dateFormat", "axisFormat", "excludes",
  "includes", "todayMarker", "tickInterval", "weekday", "commit", "branch", "checkout", "merge",
  "cherry-pick", "id", "type", "tag", "order", "accTitle", "accDescr", "showData", "namespace",
  "x-axis", "y-axis", "quadrant-1", "quadrant-2", "quadrant-3", "quadrant-4", "line", "bar",
  "columns", "space", "group", "service", "junction", "requirement", "element", "satisfies",
  "traces", "contains", "derives", "refines", "verifies", "copies", "Person", "System",
  "System_Ext", "Container", "ContainerDb", "Component", "Rel", "BiRel", "Boundary",
  "Enterprise_Boundary", "System_Boundary", "Container_Boundary", "UpdateRelStyle", "TB", "TD",
  "BT", "RL", "LR", "axis", "curve", "max", "min", "set", "sets", "union",
]);

// The plain stream parser (no CodeMirror classes), for a host editor with its
// own copy of CodeMirror to wrap in its own StreamLanguage.
export const mermaidStream = {
  name: "mermaid",
  token(stream) {
    if (stream.eatSpace()) return null;

    if (stream.match("%%{")) {
      stream.skipToEnd();
      return "meta";
    }
    if (stream.match("%%")) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.sol() && stream.match(/^---\s*$/)) return "meta";
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return "string";
    if (stream.match(/^`[^`]*`?/)) return "string";
    // Arrows and links: -->, ==>, -.->, ->>, --x, <-->, --|text|-->, etc.
    if (stream.match(/^(?:<?[-=.]{1,}[->ox)]+|<<?[-=.]+>?|[ox<]?-{2,}[ox>]?|~~~|\|[^|]*\|)/)) {
      return "operator";
    }
    if (stream.match(/^::?:?/)) return "punctuation";
    if (stream.match(/^[\[\](){}<>]+/)) return "bracket";
    if (stream.match(/^-?\d+(?:\.\d+)?%?/)) return "number";
    if (stream.match(/^#[0-9a-fA-F]{3,8}\b/)) return "number";
    const word = stream.match(/^[A-Za-z_][\w-]*/);
    if (word) {
      const text = word[0];
      const atLineStart = stream.start === stream.indentation();
      if (atLineStart && DIAGRAM_KEYWORDS.has(text)) return "heading";
      if (KEYWORDS.has(text)) return "keyword";
      return "variableName";
    }
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: "%%" } },
};

export const mermaidLanguage = StreamLanguage.define(mermaidStream);

const lightStyle = HighlightStyle.define([
  { tag: t.heading, color: "#d6336c", fontWeight: "700" },
  { tag: t.keyword, color: "#7c3aed" },
  { tag: t.operatorKeyword, color: "#0284c7" },
  { tag: t.operator, color: "#0284c7", fontWeight: "600" },
  { tag: t.string, color: "#15803d" },
  { tag: t.number, color: "#c2410c" },
  { tag: t.comment, color: "#8b93a3", fontStyle: "italic" },
  { tag: t.meta, color: "#a16207" },
  { tag: t.bracket, color: "#64748b" },
  { tag: t.punctuation, color: "#64748b" },
], { themeType: "light" });

const darkStyle = HighlightStyle.define(
  [
    { tag: t.heading, color: "#ff7aa2", fontWeight: "700" },
    { tag: t.keyword, color: "#c4a5ff" },
    { tag: t.operator, color: "#5cc8ff", fontWeight: "600" },
    { tag: t.string, color: "#7ee0a1" },
    { tag: t.number, color: "#ffb37a" },
    { tag: t.comment, color: "#7d8597", fontStyle: "italic" },
    { tag: t.meta, color: "#e9c46a" },
    { tag: t.bracket, color: "#9aa3b5" },
    { tag: t.punctuation, color: "#9aa3b5" },
  ],
  { themeType: "dark" },
);

export function mermaid() {
  return [mermaidLanguage, syntaxHighlighting(lightStyle), syntaxHighlighting(darkStyle)];
}
