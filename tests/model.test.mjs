import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalise,
  matchesSite,
  isMonospace,
  isIcon,
  profileFor,
  firstFamily,
  alias,
  resolveRule,
} from "../src/model.js";
test("settings validation and independent defaults", () => {
  const s = normalise({
    regular: { family: "Lora", weight: 9999 },
    exceptions: { sites: ["*.example.com", null] },
  });
  assert.equal(s.regular.weight, 900);
  assert.deepEqual(s.exceptions.sites, ["*.example.com"]);
  s.rules.push({});
  assert.equal(normalise().rules.length, 0);
  assert.equal(normalise(null).enabled, true);
});
test("site matching has hostname boundaries", () => {
  assert(matchesSite("docs.example.com", "*.example.com"));
  assert(matchesSite("example.com", "*.example.com"));
  assert(!matchesSite("badexample.com", "*.example.com"));
  assert(!matchesSite("other.example.com", "example.com"));
});
test("monospace and icons are protected", () => {
  for (const name of [
    "monospace",
    '"JetBrains Mono", monospace',
    "Consolas",
    "Courier New",
    "ui-monospace",
    "Menlo",
  ])
    assert(isMonospace(name), name);
  assert(!isMonospace("Outfit, sans-serif"));
  assert(isIcon("Material Symbols Rounded"));
  assert(isIcon("Arial", "\ue000"));
  assert(!isIcon("Outfit", "Hello"));
});
test("bold/italic profiles and rule precedence", () => {
  const s = normalise();
  s.italic.family = "Lora";
  assert.equal(
    profileFor({ fontStyle: "italic", fontWeight: "700" }, s).family,
    "Lora",
  );
  assert.equal(
    profileFor({ fontStyle: "normal", fontWeight: "700" }, s).weight,
    700,
  );
  s.rules = [
    { id: "a", kind: "font", site: "*", target: "Arial", family: "Inter" },
    {
      id: "b",
      kind: "font",
      site: "example.com",
      target: "Arial",
      family: "Lora",
    },
  ];
  assert.equal(resolveRule(s, "example.com", "Arial", {}).family, "Lora");
});
test("font aliases cannot inject CSS", () => {
  assert.equal(firstFamily('"Open Sans", Arial'), "Open Sans");
  assert.match(alias('";}evil'), /^Fontify_[0-9a-f_]+$/);
});
