import { test } from "node:test";
import assert from "node:assert/strict";
import { liftStyle, setsOwnTheme, withStyle } from "../src/style-config.js";

const CODE = "flowchart TD\n  A --> B\n";

test("defaults leave the code as it is", () => {
  assert.equal(withStyle(CODE, "default", {}), CODE);
  assert.equal(withStyle(CODE, null, {}), CODE);
});

test("style goes into new front matter, compactly", () => {
  const out = withStyle(CODE, "forest", { look: "handDrawn", curve: "step" });
  assert.equal(out, "---\nconfig:\n  theme: forest\n  look: handDrawn\n  flowchart:\n    curve: step\n---\n" + CODE);
});

test("round trip: lifting gives back the code and the settings", () => {
  const config = { look: "handDrawn", layout: "elk", fontFamily: '"Trebuchet MS", sans-serif', curve: "basis" };
  const out = withStyle(CODE, "dark", config);
  assert.deepEqual(liftStyle(out), { source: CODE, theme: "dark", config });
});

test("other front matter and config stay", () => {
  const source = "---\ntitle: Robot arm\nconfig:\n    themeVariables:\n        primaryColor: '#ff0'\n    flowchart:\n        htmlLabels: false\n---\n" + CODE;
  const out = withStyle(source, "default", { look: "handDrawn", curve: "linear" });
  assert.equal(
    out,
    "---\ntitle: Robot arm\nconfig:\n    look: handDrawn\n    themeVariables:\n        primaryColor: '#ff0'\n    flowchart:\n        curve: linear\n        htmlLabels: false\n---\n" + CODE,
  );
  assert.deepEqual(liftStyle(out), { source, theme: null, config: { look: "handDrawn", curve: "linear" } });
});

test("saving again replaces the old settings rather than adding more", () => {
  const once = withStyle(CODE, "forest", { look: "handDrawn" });
  assert.equal(withStyle(once, "neutral", { look: "classic" }), withStyle(CODE, "neutral", { look: "classic" }));
  assert.equal(withStyle(once, "default", {}), CODE);
});

test("a title-only front matter gets a config block", () => {
  const source = "---\ntitle: Hello\n---\n" + CODE;
  assert.equal(withStyle(source, "default", { look: "handDrawn" }), "---\ntitle: Hello\nconfig:\n  look: handDrawn\n---\n" + CODE);
});

test("quoted values are read back", () => {
  const source = "---\nconfig:\n  theme: 'forest' \n  look: handDrawn # sketchy\n  fontFamily: \"Comic Sans MS\"\n---\n" + CODE;
  assert.deepEqual(liftStyle(source), { source: CODE, theme: "forest", config: { look: "handDrawn", fontFamily: "Comic Sans MS" } });
});

test("front matter it can't follow is left alone", () => {
  const source = "---\nconfig: { theme: forest }\n---\n" + CODE;
  assert.deepEqual(liftStyle(source), { source, theme: null, config: {} });
  assert.equal(withStyle(source, "dark", { look: "handDrawn" }), source);
  assert.deepEqual(liftStyle(CODE), { source: CODE, theme: null, config: {} });
});

test("setsOwnTheme", () => {
  assert.equal(setsOwnTheme(CODE), false);
  assert.equal(setsOwnTheme(withStyle(CODE, "default", { look: "handDrawn" })), false);
  assert.equal(setsOwnTheme(withStyle(CODE, "forest", {})), true);
  assert.equal(setsOwnTheme("%%{init: {'theme': 'dark'}}%%\n" + CODE), true);
});
