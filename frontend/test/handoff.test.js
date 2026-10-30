import { test } from "node:test";
import assert from "node:assert/strict";
import { factoryLink, handoffHash, readHandoff } from "../src/handoff.js";

test("a diagram survives the trip through the link", () => {
  const source = "flowchart TD\n  A[Démarrer 🚀] --> B{Ok?}\n  B -->|yes| C";
  const link = factoryLink(source, { base: "https://mermaid.example/", title: "Robot arm" });
  assert.match(link, /^https:\/\/mermaid\.example\/diagrams\/new\/edit#source=[A-Za-z0-9_-]+&title=Robot%20arm$/);
  assert.deepEqual(readHandoff(new URL(link).hash), { source, title: "Robot arm", back: null });
});

test("no title and no base", () => {
  assert.equal(factoryLink("graph TD; A-->B"), `/diagrams/new/edit#${handoffHash("graph TD; A-->B")}`);
  assert.deepEqual(readHandoff("#" + handoffHash("graph TD; A-->B")), { source: "graph TD; A-->B", title: null, back: null });
});

test("anything else in the fragment is ignored", () => {
  assert.equal(readHandoff(""), null);
  assert.equal(readHandoff("#top"), null);
  assert.equal(readHandoff("#source=%%%"), null);
  assert.equal(readHandoff("#source=__8"), null); // not UTF-8
});

test("a link can say where to send the diagram back", () => {
  const back = { origin: "https://www.kevsrobots.com", ref: "abc-123", label: "your project" };
  const link = factoryLink("graph TD; A-->B", { base: "https://mermaid.example", back });
  assert.deepEqual(readHandoff(new URL(link).hash).back, back);
  const noLabel = factoryLink("graph TD", { back: { origin: "http://localhost:4000", ref: "r" } });
  assert.deepEqual(readHandoff(noLabel.slice(noLabel.indexOf("#"))).back, { origin: "http://localhost:4000", ref: "r", label: "localhost:4000" });
});

test("only a web origin can be sent back to", () => {
  for (const origin of ["javascript:alert(1)", "https://a.example/path", "file:///x", "not a url"]) {
    const link = factoryLink("graph TD", { back: { origin, ref: "r" } });
    assert.equal(readHandoff(link.slice(link.indexOf("#"))).back, null, origin);
  }
});
