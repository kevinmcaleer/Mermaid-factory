import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addConnectedNode,
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
