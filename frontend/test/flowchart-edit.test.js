import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addConnectedNode,
  addNode,
  deleteEdge,
  listEdges,
  readLink,
  reverseEdge,
  setDirection,
  setEdge,
  writeLink,
  classDefNames,
  nodeClass,
  nodeStyle,
  setNodeClass,
  setNodeStyle,
  connectNodes,
  deleteNode,
  flowDirection,
  findNode,
  formatText,
  isFlowchart,
  minimalChange,
  nodeIdFromElement,
  setNodeShape,
  setNodeText,
} from "../src/flowchart-edit.js";

const chart = `flowchart TD
    %% A[not this one]
    A[Start] --> B(Round)
    B -->|"yes [sure]"| C{Decide?}
    C --> D
    subgraph S [Group]
      E[[Sub]]
    end
    classDef hot fill:#f00
`;

test("recognises flowcharts, after front matter too", () => {
  assert.equal(isFlowchart(chart), true);
  assert.equal(isFlowchart("---\ntitle: x\n---\ngraph LR\nA-->B"), true);
  assert.equal(isFlowchart("sequenceDiagram\nA->>B: hi"), false);
});

test("reads a rendered node's id", () => {
  assert.equal(nodeIdFromElement({ id: "mf-render-3-flowchart-my-node-12" }), "my-node");
  assert.equal(nodeIdFromElement({ id: "something-else" }), null);
});

test("finds a node's text and shape", () => {
  assert.deepEqual(findNode(chart, "A"), { id: "A", text: "Start", shape: "rect" });
  assert.deepEqual(findNode(chart, "B"), { id: "B", text: "Round", shape: "rounded" });
  assert.deepEqual(findNode(chart, "C"), { id: "C", text: "Decide?", shape: "diamond" });
  assert.deepEqual(findNode(chart, "D"), { id: "D", text: "D", shape: "rect" });
  assert.deepEqual(findNode(chart, "E"), { id: "E", text: "Sub", shape: "subroutine" });
  assert.equal(findNode(chart, "Z"), null);
});

test("changes text in place, leaving comments and edge labels alone", () => {
  const out = setNodeText(chart, "A", "Begin here");
  assert.match(out, /A\[Begin here\] --> B\(Round\)/);
  assert.match(out, /%% A\[not this one\]/);
  assert.equal(setNodeText(chart, "C", "Is it (really) ok?").includes('C{"Is it (really) ok?"}'), true);
  assert.equal(findNode(setNodeText(chart, "C", 'say "hi"'), "C").text, 'say "hi"');
});

test("gives a bare node a definition on the line after its last use", () => {
  const out = setNodeText(chart, "D", "Done");
  assert.match(out, /C --> D\n    D\[Done\]\n/);
  assert.deepEqual(findNode(out, "D"), { id: "D", text: "Done", shape: "rect" });
});

test("changes shape, keeping the text", () => {
  assert.match(setNodeShape(chart, "A", "circle"), /A\(\(Start\)\) --> B/);
  assert.match(setNodeShape(chart, "B", "stadium"), /B\(\[Round\]\)/);
  assert.match(setNodeShape(chart, "B", "trapezoid"), /B\[\/Round\\\]/);
  assert.equal(findNode(setNodeShape(chart, "C", "hexagon"), "C").shape, "hexagon");
  assert.equal(findNode(setNodeShape(chart, "D", "rounded"), "D").shape, "rounded");
});

test("handles the @{ } shape syntax", () => {
  const src = 'flowchart LR\n  A@{ shape: diam, label: "Check" } --> B\n';
  assert.deepEqual(findNode(src, "A"), { id: "A", text: "Check", shape: "diamond" });
  const out = setNodeShape(setNodeText(src, "A", "Look"), "A", "cylinder");
  assert.match(out, /A@\{ shape: cyl, label: "Look" \} --> B/);
});

test("adds a connected node beside the node's last line", () => {
  const { source, id } = addConnectedNode(chart, "E", { text: "Next", shape: "circle" });
  assert.equal(id, "n1");
  assert.match(source, /E\[\[Sub\]\]\n      E --> n1\(\(Next\)\)\n    end/);
  const again = addConnectedNode(source, "n1");
  assert.equal(again.id, "n2");
  assert.match(again.source, /n1 --> n2\[New step\]/);
});

test("quotes labels only when needed", () => {
  assert.equal(formatText("Hello world"), "Hello world");
  assert.equal(formatText("a [b]"), '"a [b]"');
  assert.equal(formatText("end"), "end");
});

test("finds the smallest change", () => {
  assert.deepEqual(minimalChange("abcdef", "abXYef"), { from: 2, to: 4, insert: "XY" });
  assert.deepEqual(minimalChange("same", "same"), { from: 4, to: 4, insert: "" });
});

test("adds a node on the side the flow comes from", () => {
  const { source, id } = addConnectedNode("flowchart LR\n    a --> b\n", "a", { before: true });
  assert.equal(id, "n1");
  assert.equal(source, "flowchart LR\n    a --> b\n    n1[New step] --> a\n");
});

test("adds a shape on its own, or starts a flowchart", () => {
  assert.deepEqual(addNode("flowchart LR\n  a --> b"), { source: "flowchart LR\n  a --> b\n  n1[New shape]\n", id: "n1" });
  assert.equal(addNode("").source, "flowchart TD\n    n1[New shape]\n");
});

test("reads the flow direction", () => {
  assert.equal(flowDirection("graph LR\nA-->B"), "LR");
  assert.equal(flowDirection("flowchart TD\nA-->B"), "TB");
  assert.equal(flowDirection("flowchart\nA-->B"), "TB");
});

test("connects nodes: inside a shared subgraph, else at the end", () => {
  const src = "flowchart TD\n    a --> b\n    subgraph S\n      p\n      q\n    end\n";
  assert.equal(connectNodes(src, "p", "q"), "flowchart TD\n    a --> b\n    subgraph S\n      p\n      q\n      p --> q\n    end\n");
  assert.equal(connectNodes(src, "a", "q"), src + "    a --> q\n");
  assert.equal(connectNodes(src, "a", "a"), src);
});

test("deletes a node, its arrows and its styling, keeping its neighbours", () => {
  const src = `flowchart LR
    a["Buy Parts"] --> b --> c
    b & d --> e
    x -.-> b
    b -- yes --> y
    b e1@==> z
    w -->|no| b
    w --> v
    style b fill:#f00
    class a,b hot
    class b hot
    click b "https://example.com"
`;
  assert.equal(
    deleteNode(src, "b"),
    `flowchart LR
    a["Buy Parts"]
    c
    d --> e
    x
    y
    z
    w --> v
    class a hot
`,
  );
  // Bare ids that live on elsewhere aren't left behind as their own lines.
  assert.equal(deleteNode("flowchart TD\n  a[A] --> b\n  b --> c\n  c --> a\n", "b"), "flowchart TD\n  a[A]\n  c --> a\n");
});

test("won't guess at lines it can't read", () => {
  assert.equal(deleteNode("flowchart TD\n  a --> b ??? c\n", "b"), null);
});

test("styles a node with a preset class, sharing one class line", () => {
  let src = "flowchart LR\n    a[A] --> b:::hot --> c\n    classDef hot fill:#f00\n";
  src = setNodeClass(src, "a", "Rose");
  src = setNodeClass(src, "c", "Rose");
  assert.equal(
    src,
    "flowchart LR\n    a[A] --> b:::hot --> c\n    classDef hot fill:#f00\n    classDef Rose fill:#fde2e4,stroke:#d9506a,color:#881337\n    class a,c Rose\n",
  );
  assert.equal(nodeClass(src, "b"), "hot");
  assert.deepEqual(classDefNames(src), ["hot", "Rose"]);
  // Switching b to Rose takes off :::hot; the user's own classDef stays.
  src = setNodeClass(src, "b", "Rose");
  assert.match(src, /a\[A\] --> b --> c/);
  assert.match(src, /class a,c,b Rose/);
  assert.match(src, /classDef hot/);
  // Once nobody uses the preset, its classDef goes too.
  for (const id of ["a", "b", "c"]) src = setNodeClass(src, id, null);
  assert.equal(src, "flowchart LR\n    a[A] --> b --> c\n    classDef hot fill:#f00\n");
});

test("sets and clears a node's own style properties", () => {
  let src = "flowchart TD\n  a --> b\n";
  src = setNodeStyle(src, "a", { fill: "#fff", stroke: "#000" });
  assert.equal(src, "flowchart TD\n  a --> b\n  style a fill:#fff,stroke:#000\n");
  src = setNodeStyle(src, "a", { fill: null, "stroke-dasharray": "6 4" });
  assert.deepEqual(nodeStyle(src, "a"), { stroke: "#000", "stroke-dasharray": "6 4" });
  src = setNodeStyle(src, "a", { stroke: "", "stroke-dasharray": null });
  assert.equal(src, "flowchart TD\n  a --> b\n");
});

test("deleting the last node with a preset removes its classDef", () => {
  const src = setNodeClass("flowchart TD\n  a --> b\n", "b", "Sky");
  assert.equal(deleteNode(src, "b"), "flowchart TD\n  a\n");
});

test("lists arrows with the ids mermaid draws them with", () => {
  const src = "flowchart LR\n    a[A] -- yes --> b --> c\n    a & b -.-> d\n    x e1@==>|go| y\n    a --> b\n";
  assert.deepEqual(
    listEdges(src).map((e) => [e.id, e.line, e.end, e.label, e.simple]),
    [
      ["L_a_b_0", "solid", "arrow", "yes", true],
      ["L_b_c_0", "solid", "arrow", "", true],
      ["L_a_d_0", "dotted", "arrow", "", false],
      ["L_b_d_0", "dotted", "arrow", "", false],
      ["e1", "thick", "arrow", "go", true],
      ["L_a_b_1", "solid", "arrow", "", true],
    ],
  );
});

test("reads and writes every link form", () => {
  const cases = {
    "---": "---", "-->": "-->", "<-->": "<-->", "-.->": "-.->", "-.-": "-.-", "==>": "==>", "===": "===",
    "==o": "==o", "--x": "--x", "~~~": "~~~", "-->|hi|": "-->|hi|", "-- hi there -->": "-->|hi there|",
    "== big ==>": "==>|big|", "-. dots .->": "-.->|dots|", "e2@-->": "e2@-->",
  };
  for (const [from, to] of Object.entries(cases)) assert.equal(writeLink(readLink(from)), to, from);
});

test("changes, reverses and deletes arrows", () => {
  const src = "flowchart LR\n    a[A] -->|order| b[B] --> c[C]\n";
  assert.equal(setEdge(src, "L_b_c_0", { line: "dotted", end: "circle", label: "then" }), "flowchart LR\n    a[A] -->|order| b[B] -.-o|then| c[C]\n");
  assert.equal(setEdge(src, "L_a_b_0", { label: "" }), "flowchart LR\n    a[A] --> b[B] --> c[C]\n");
  assert.equal(reverseEdge(src, "L_b_c_0"), "flowchart LR\n    a[A] -->|order| b[B]\n    c[C] --> b\n");
  assert.equal(reverseEdge("flowchart TD\n  a[A] --> b\n", "L_a_b_0"), "flowchart TD\n  b --> a[A]\n");
  assert.equal(deleteEdge(src, "L_a_b_0"), "flowchart LR\n    a[A]\n    b[B] --> c[C]\n");
  assert.equal(deleteEdge("flowchart TD\n  a & b --> c\n", "L_a_c_0"), null);
});

test("sets the direction on the header", () => {
  assert.equal(setDirection("flowchart LR\n  a --> b", "TD"), "flowchart TD\n  a --> b");
  assert.equal(setDirection("---\ntitle: x\n---\ngraph\n  a --> b", "RL"), "---\ntitle: x\n---\ngraph RL\n  a --> b");
});
