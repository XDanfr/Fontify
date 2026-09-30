import { api, getSettings } from "./api.js";
import {
  firstFamily,
  isMonospace,
  isIcon,
  profileFor,
  classifyFont,
  resolveRule,
  matchesSite,
  safeMatches,
  alias,
  fontKey,
} from "./model.js";
import { loadFace } from "./fonts.js";
const originals = new Map(),
  installed = new Set(),
  failures = new Map();
let settings,
  timer,
  running = false,
  rerun = false,
  contextTarget,
  contextSnapshot,
  generation = 0;
const host = location.hostname;
const properties = [
  "font-family",
  "font-weight",
  "font-style",
  "font-synthesis",
];
const observer = new MutationObserver((records) => {
  if (
    records.some(
      (r) =>
        !(r.target instanceof Element) ||
        !r.target.closest("[data-fontify-owned]"),
    )
  )
    schedule();
});
function observe() {
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class", "style"],
  });
  for (const root of shadowRoots())
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });
}
function shadowRoots(root = document) {
  const roots = [];
  for (const el of root.querySelectorAll("*"))
    if (el.shadowRoot) {
      roots.push(el.shadowRoot, ...shadowRoots(el.shadowRoot));
    }
  return roots;
}
function elements() {
  return [document, ...shadowRoots()].flatMap((root) => [
    ...root.querySelectorAll("*"),
  ]);
}
function restore() {
  for (const [el, snapshot] of originals) {
    for (const p of properties) {
      // Honour a page changing an inline value after Fontify applied it.
      if (el.style.getPropertyValue(p) !== snapshot.applied[p])
        snapshot.values[p] = [
          el.style.getPropertyValue(p),
          el.style.getPropertyPriority(p),
        ];
      const [value, priority] = snapshot.values[p];
      if (value) el.style.setProperty(p, value, priority);
      else el.style.removeProperty(p);
    }
  }
  originals.clear();
}
function measuredMono(style) {
  if (isMonospace(style.fontFamily)) return true;
  // Also detect fixed-pitch custom fonts whose names don't say 'Mono'.
  const canvas =
    measuredMono.canvas ||
    (measuredMono.canvas = document.createElement("canvas"));
  const ctx = canvas.getContext("2d");
  ctx.font = `${style.fontStyle} ${style.fontWeight} 32px ${style.fontFamily}`;
  return (
    Math.abs(
      ctx.measureText("iiiiiiii").width - ctx.measureText("WWWWWWWW").width,
    ) < 0.1
  );
}
function protectedElement(el, style) {
  return (
    /^(SCRIPT|STYLE|NOSCRIPT|SVG|PATH|CANVAS|MATH|IFRAME|OBJECT)$/.test(
      el.tagName,
    ) ||
    !!el.closest("svg,math,[data-fontify-owned]") ||
    isIcon(style.fontFamily, el.textContent) ||
    settings.exceptions.fonts.some(
      (f) => f.toLowerCase() === firstFamily(style.fontFamily).toLowerCase(),
    ) ||
    settings.exceptions.selectors.some((s) => safeMatches(el, s))
  );
}
function directText(el) {
  return (
    [...el.childNodes].some(
      (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim(),
    ) || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)
  );
}
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(apply, 180);
}
async function apply() {
  if (running) {
    rerun = true;
    return;
  }
  running = true;
  const token = ++generation;
  observer.disconnect();
  restore();
  try {
    if (
      !settings?.enabled ||
      settings.exceptions.sites.some((s) => matchesSite(host, s))
    )
      return;
    const plans = [],
      preserved = [];
    for (const el of elements()) {
      if (!directText(el)) continue;
      const style = getComputedStyle(el);
      const values = Object.fromEntries(
        properties.map((p) => [
          p,
          [el.style.getPropertyValue(p), el.style.getPropertyPriority(p)],
        ]),
      );
      const preserve = () =>
        preserved.push({
          el,
          values,
          applied: Object.fromEntries(
            properties.map((p) => [p, style.getPropertyValue(p)]),
          ),
        });
      if (protectedElement(el, style)) {
        preserve();
        continue;
      }
      const rule = resolveRule(
        settings,
        host,
        firstFamily(style.fontFamily),
        el,
      );
      const mono = !!el.closest("pre,code,kbd,samp") || measuredMono(style);
      const category = mono
        ? "monospace"
        : classifyFont(style.fontFamily, GOOGLE_FONT_CATEGORIES);
      if (!rule && mono && !settings.monospaceEnabled) {
        preserve();
        continue;
      }
      const profile = rule
        ? {
            family: rule.family,
            category,
            weight: rule.weight,
            style: style.fontStyle === "italic" ? "italic" : "normal",
          }
        : profileFor(style, settings, category);
      plans.push({ el, profile, values });
    }
    observe();
    const unique = new Map(
      plans.map(({ profile }) => [
        fontKey(profile.family, profile.weight, profile.style),
        profile,
      ]),
    );
    await Promise.all(
      [...unique].map(async ([key, profile]) => {
        if (installed.has(key) || Date.now() - (failures.get(key) || 0) < 30000)
          return;
        try {
          await loadFace(profile);
          installed.add(key);
          failures.delete(key);
        } catch (error) {
          failures.set(key, Date.now());
          console.debug("Fontify:", error.message);
        }
      }),
    );
    if (token !== generation || rerun) return;
    observer.disconnect();
    for (const { el, profile, values } of plans) {
      if (
        !el.isConnected ||
        !installed.has(fontKey(profile.family, profile.weight, profile.style))
      )
        continue;
      const applied = {
        "font-family": `"${alias(profile.family)}", ${categoryFallback(profile.category)}`,
        "font-weight": String(profile.weight),
        "font-style": profile.style,
        "font-synthesis": "weight style",
      };
      for (const [p, value] of Object.entries(applied)) {
        el.style.setProperty(p, value, "important");
        applied[p] = el.style.getPropertyValue(p);
      }
      originals.set(el, { values, applied, restyled: true });
    }
    // A skipped child still inherits a changed parent: pin its original typography.
    for (const { el, values, applied } of preserved) {
      let parent = el.parentElement || el.getRootNode().host;
      while (parent && !originals.get(parent)?.restyled)
        parent = parent.parentElement || parent.getRootNode().host;
      if (!parent || !el.isConnected) continue;
      for (const [p, value] of Object.entries(applied)) {
        el.style.setProperty(p, value, "important");
        applied[p] = el.style.getPropertyValue(p);
      }
      originals.set(el, { values, applied, restyled: false });
    }
  } finally {
    observe();
    running = false;
    if (rerun) {
      rerun = false;
      schedule();
    }
  }
}
function categoryFallback(category) {
  return category === "monospace"
    ? "monospace"
    : category === "serif"
      ? "serif"
      : "sans-serif";
}
function selectorFor(el) {
  const parts = [];
  while (el && el !== document.documentElement) {
    if (el.id) {
      parts.unshift(`#${CSS.escape(el.id)}`);
      break;
    }
    const siblings = el.parentElement
      ? [...el.parentElement.children].filter((s) => s.tagName === el.tagName)
      : [];
    parts.unshift(
      `${el.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(el) + 1})`,
    );
    el = el.parentElement;
  }
  return parts.join(" > ");
}
document.addEventListener(
  "contextmenu",
  (event) => {
    const selection = getSelection();
    let node = selection?.anchorNode;
    contextTarget = selection?.toString().trim()
      ? node?.parentElement
      : event.composedPath()[0];
    if (!(contextTarget instanceof Element)) return;
    observer.disconnect();
    restore();
    const style = getComputedStyle(contextTarget);
    const block =
      contextTarget.closest(
        "pre,code,blockquote,p,li,h1,h2,h3,h4,h5,h6,td,article",
      ) || contextTarget;
    contextSnapshot = {
      family: firstFamily(style.fontFamily),
      stack: style.fontFamily,
      selector: selectorFor(block),
      site: host,
      text: (selection?.toString() || contextTarget.textContent || "").slice(
        0,
        160,
      ),
      shadow: contextTarget.getRootNode() instanceof ShadowRoot,
    };
    // A context action is based on the site's original font, not Fontify's alias.
    observe();
    schedule();
  },
  true,
);
api.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type === "describe") respond(contextSnapshot);
  if (message.type === "status")
    respond({
      enabled: settings?.enabled,
      excluded: settings?.exceptions.sites.some((s) => matchesSite(host, s)),
      count: [...originals.values()].filter((v) => v.restyled).length,
      failures: failures.size,
      site: host,
    });
});
api.storage.onChanged.addListener(async (changes, area) => {
  if (area === "local" && (changes.settings || changes.fontsChanged)) {
    settings = await getSettings();
    failures.clear();
    generation++;
    rerun = running;
    schedule();
  }
});
getSettings().then((s) => {
  settings = s;
  observe();
  apply();
});
