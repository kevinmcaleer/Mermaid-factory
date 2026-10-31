import { test } from "node:test";
import assert from "node:assert/strict";
import { convertDiagram, diagramDirection, flowchartKeyword } from "../src/convert.js";

const kev = `graph LR
a[Buy Parts] --> b[Print 3D parts]
b --> c[Assmeble] --> f[Set servo ID's ]
f --> d[Wire up electronics]
d --> e[train robot]
e --> n1[Enjoy!]
`;

test("flowchart output declares nodes on their first edge, unquoted", () => {
  const state = convertDiagram(kev, "flowchart", "state");
  const back = convertDiagram(state, "state", "flowchart", { keyword: "graph" });
  assert.equal(
    back,
    `graph LR
    a[Buy Parts] --> b[Print 3D parts]
    b --> c[Assmeble]
    c --> f[Set servo ID's]
    f --> d[Wire up electronics]
    d --> e[train robot]
    e --> n1[Enjoy!]
`,
  );
});

test("direction survives a type without one via hints", () => {
  const mind = convertDiagram(kev, "flowchart", "mindmap");
  const back = convertDiagram(mind, "mindmap", "flowchart", { direction: diagramDirection(kev) });
  assert.match(back, /^flowchart LR\n/);
  assert.match(back, /n1\[Buy Parts\] --> n2\[Print 3D parts\]/);
});

test("direction carries into state, class and er", () => {
  assert.match(convertDiagram(kev, "flowchart", "state"), /^stateDiagram-v2\n    direction LR\n/);
  assert.match(convertDiagram(kev, "flowchart", "class"), /^classDiagram\n    direction LR\n/);
  assert.match(convertDiagram(kev, "flowchart", "er"), /^erDiagram\n    direction LR\n/);
  const td = convertDiagram("flowchart TD\nA --> B\n", "flowchart", "state");
  assert.match(td, /direction TB/);
  assert.doesNotMatch(convertDiagram("stateDiagram-v2\nA --> B\n", "state", "class"), /direction/);
  assert.match(convertDiagram("stateDiagram-v2\n  direction LR\n  A --> B\n", "state", "flowchart"), /^flowchart LR\n/);
});

test("defaults to flowchart TD with no direction anywhere", () => {
  assert.match(convertDiagram("stateDiagram-v2\nA --> B\n", "state", "flowchart"), /^flowchart TD\n    A --> B\n$/);
});

test("labels are quoted only when Mermaid needs it", () => {
  const out = convertDiagram(
    'stateDiagram-v2\nstate "Pick (fast)" as P\nstate "Plain words" as Q\nstate "a|b" as R\nP --> Q : go [now]\nQ --> R : ok\n',
    "state",
    "flowchart",
  );
  assert.match(out, /P\["Pick \(fast\)"\] -->\|"go \[now\]"\| Q\[Plain words\]/);
  assert.match(out, /Q -->\|ok\| R\["a#124;b"\]|Q -->\|ok\| R\["a\|b"\]/);
});

test("nodes with no edges are still declared", () => {
  const out = convertDiagram("classDiagram\nclass Lonely\nclass A\nA --> B\n", "class", "flowchart");
  assert.equal(out, "flowchart TD\n    Lonely\n    A --> B\n");
});

test("diagramDirection and flowchartKeyword", () => {
  assert.equal(diagramDirection(kev), "LR");
  assert.equal(diagramDirection("flowchart\nA-->B"), "");
  assert.equal(diagramDirection("classDiagram\n  direction RL\n  A --> B"), "RL");
  assert.equal(diagramDirection("flowchart TD\n  subgraph S\n    direction LR\n    A\n  end"), "TD");
  assert.equal(flowchartKeyword(kev), "graph");
  assert.equal(flowchartKeyword("---\ntitle: x\n---\nflowchart LR\nA"), "flowchart");
});
