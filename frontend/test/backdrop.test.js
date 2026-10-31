import { test } from "node:test";
import assert from "node:assert/strict";
import { BACKGROUNDS, inkCss, paperCss, paperFor, withBackdrop } from "../src/backdrop.js";

const SVG =
  '<svg id="mf-render-3" width="100%" xmlns="http://www.w3.org/2000/svg" class="flowchart" style="max-width: 120px;" viewBox="-8 -8 120 80" role="graphics-document document">' +
  "<style>#mf-render-3 .node rect{fill:#ECECFF;}</style><g><text>Hi</text></g></svg>";

test("three choices: none, blue and black blueprint", () => {
  assert.deepEqual(
    BACKGROUNDS.map((b) => b.value),
    ["", "blueprint", "blueprint-dark"],
  );
  assert.equal(paperFor(""), null);
  assert.equal(paperFor("toString"), null);
  assert.ok(paperFor("blueprint"));
});

test("no background leaves the SVG alone", () => {
  assert.equal(withBackdrop(SVG, ""), SVG);
  assert.equal(withBackdrop(SVG, "nonsense"), SVG);
  assert.deepEqual(paperCss(""), {});
});

test("a blueprint adds paper behind and ink after mermaid's style", () => {
  const out = withBackdrop(SVG, "blueprint");
  assert.match(out, /viewBox="-32 -32 168 128"/);
  assert.match(out, /max-width: 168px/);
  const paper = out.indexOf('class="mf-paper"');
  const theirs = out.indexOf("<style>#mf-render-3 .node rect{fill:#ECECFF;}</style>");
  const ink = out.indexOf("<style>#mf-render-3{");
  assert.ok(paper > 0 && paper < theirs && theirs < ink, "paper first, then mermaid's style, then the ink");
  assert.match(out, /id="mf-render-3-bp-major"/);
  assert.match(out, /fill:#1f4f8f/);
});

test("paper: false only adds the ink (the page shows the paper)", () => {
  const out = withBackdrop(SVG, "blueprint-dark", { paper: false });
  assert.doesNotMatch(out, /mf-paper/);
  assert.match(out, /viewBox="-8 -8 120 80"/);
  assert.ok(out.includes(inkCss("blueprint-dark", "mf-render-3")));
});

test("ink is scoped to the SVG and never !important (classDef colours win)", () => {
  const css = inkCss("blueprint", "d1");
  assert.ok(css.split("}").filter(Boolean).every((rule) => rule.trim().startsWith("#d1")));
  assert.doesNotMatch(css, /!important/);
});

test("the grid follows the view's zoom and pan", () => {
  const css = paperCss("blueprint", { scale: 2, x: 5, y: -3 });
  assert.equal(css.backgroundColor, "#1f4f8f");
  assert.match(css.backgroundSize, /^200px 200px, 200px 200px, 40px 40px, 40px 40px$/);
  assert.equal(css.backgroundPosition, "5px -3px");
});
