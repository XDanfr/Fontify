export const DEFAULTS = {
  version: 1,
  enabled: true,
  theme: "dark",
  onlineFonts: true,
  monospaceEnabled: false,
  serif: { family: "", weight: 400 },
  sansSerif: { family: "", weight: 400 },
  monospace: { family: "JetBrains Mono", weight: 400 },
  regular: { family: "Outfit", weight: 400 },
  bold: { family: "", weight: 700 },
  italic: { family: "", weight: 400 },
  exceptions: { sites: [], fonts: [], selectors: [] },
  rules: [],
  favourites: [
    "Outfit",
    "Inter",
    "Atkinson Hyperlegible",
    "Lora",
    "Space Grotesk",
  ],
};
export function normalise(input = {}) {
  const s = structuredClone(DEFAULTS);
  if (!input || typeof input !== "object") return s;
  for (const k of ["enabled", "onlineFonts", "monospaceEnabled"])
    if (typeof input[k] === "boolean") s[k] = input[k];
  if (["dark", "light", "auto"].includes(input.theme)) s.theme = input.theme;
  for (const k of [
    "regular",
    "bold",
    "italic",
    "serif",
    "sansSerif",
    "monospace",
  ]) {
    if (typeof input[k]?.family === "string" && input[k].family.length <= 200)
      s[k].family = input[k].family;
    if (Number.isFinite(+input[k]?.weight))
      s[k].weight =
        Math.round(Math.max(100, Math.min(900, +input[k].weight)) / 100) * 100;
  }
  for (const k of ["sites", "fonts", "selectors"])
    s.exceptions[k] = (
      Array.isArray(input.exceptions?.[k]) ? input.exceptions[k] : []
    )
      .filter((v) => typeof v === "string" && v.length < 500)
      .slice(0, 500);
  s.rules = (Array.isArray(input.rules) ? input.rules : [])
    .filter(
      (r) =>
        r &&
        typeof r.id === "string" &&
        ["font", "block"].includes(r.kind) &&
        typeof r.target === "string" &&
        typeof r.site === "string" &&
        typeof r.family === "string",
    )
    .map((r) => ({
      ...r,
      weight:
        Math.round(Math.max(100, Math.min(900, +r.weight || 400)) / 100) * 100,
    }))
    .slice(0, 500);
  s.favourites = (
    Array.isArray(input.favourites) ? input.favourites : s.favourites
  )
    .filter((x) => typeof x === "string")
    .slice(0, 200);
  return s;
}
export function matchesSite(host, pattern) {
  const p = pattern
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  return (
    p === "*" ||
    (p.startsWith("*.")
      ? host === p.slice(2) || host.endsWith(p.slice(1))
      : host === p)
  );
}
export function firstFamily(stack) {
  return stack
    .split(",")[0]
    .trim()
    .replace(/^['"]|['"]$/g, "");
}
export function isMonospace(stack) {
  return /(^|[,\s"'])(monospace|ui-monospace|[\w-]*mono[\w-]*|consolas|courier(?: new)?|menlo|monaco|lucida console)(?=[,\s"']|$)/i.test(
    stack,
  );
}
export function isIcon(stack, text = "") {
  return (
    /icon|awesome|material (symbols|icons)|wingdings|glyph|octicon|symbol/i.test(
      stack,
    ) ||
    (/^[\s\uE000-\uF8FF]+$/.test(text) && text.trim().length > 0)
  );
}
export function classifyFont(stack, categories = {}) {
  const families = stack.split(",").map(firstFamily);
  for (const family of families) {
    const name = family.toLowerCase(),
      category = categories[name];
    if (category === "serif") return "serif";
    if (category === "sans-serif") return "sansSerif";
    if (category === "monospace" || isMonospace(family)) return "monospace";
    if (
      /^(georgia|times(?: new roman)?|cambria|garamond|palatino(?: linotype)?|baskerville|constantia|book antiqua|didot|bodoni(?: mt)?)$/.test(
        name,
      )
    )
      return "serif";
    if (name === "serif" || name === "ui-serif") return "serif";
    if (
      name === "sans-serif" ||
      name === "ui-sans-serif" ||
      name === "system-ui"
    )
      return "sansSerif";
  }
  return "sansSerif";
}
export function profileFor(style, s, category = "sansSerif") {
  const base =
    category === "monospace"
      ? s.monospace
      : s[category]?.family
        ? s[category]
        : s.regular;
  const italic =
    style.fontStyle === "italic" || style.fontStyle.startsWith("oblique");
  if (category === "monospace")
    return { ...base, style: italic ? "italic" : "normal", category };
  if (italic)
    return {
      ...s.italic,
      family: s.italic.family || base.family,
      style: "italic",
      category,
    };
  if (+style.fontWeight >= 600)
    return {
      ...s.bold,
      family: s.bold.family || base.family,
      style: "normal",
      category,
    };
  return { ...base, style: "normal", category };
}
export function resolveRule(s, host, family, element) {
  return [...s.rules]
    .reverse()
    .find(
      (r) =>
        matchesSite(host, r.site) &&
        (r.kind === "font"
          ? r.target.toLowerCase() === family.toLowerCase()
          : safeMatches(element, r.target)),
    );
}
export function safeMatches(el, selector) {
  try {
    return el.matches(selector) || !!el.closest(selector);
  } catch {
    return false;
  }
}
export function alias(family) {
  return (
    "Fontify_" +
    Array.from(family)
      .map((c) => c.codePointAt(0).toString(16))
      .join("_")
  );
}
export function fontKey(family, weight, style) {
  return JSON.stringify([family, weight, style]);
}
