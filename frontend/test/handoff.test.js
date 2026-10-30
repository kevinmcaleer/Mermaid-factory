import { test } from "node:test";
import assert from "node:assert/strict";
import { factoryLink, handoffHash, readHandoff } from "../src/handoff.js";

test("a diagram survives the trip through the link", () => {
  const source = "flowchart TD\n  A[Démarrer 🚀] --> B{Ok?}\n  B -->|yes| C";
  const link = factoryLink(source, { base: "https://mermaid.example/", title: "Robot arm" });
  assert.match(link, /^https:\/\/mermaid\.example\/diagrams\/new\/edit#source=[A-Za-z0-9_-]+&title=Robot%20arm$/);
  assert.deepEqual(readHandoff(new URL(link).hash), { source, title: "Robot arm" });
});

test("no title and no base", () => {
  assert.equal(factoryLink("graph TD; A-->B"), `/diagrams/new/edit#${handoffHash("graph TD; A-->B")}`);
  assert.deepEqual(readHandoff("#" + handoffHash("graph TD; A-->B")), { source: "graph TD; A-->B", title: null });
});

test("anything else in the fragment is ignored", () => {
  assert.equal(readHandoff(""), null);
  assert.equal(readHandoff("#top"), null);
  assert.equal(readHandoff("#source=%%%"), null);
  assert.equal(readHandoff("#source=__8"), null); // not UTF-8
});
