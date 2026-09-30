import { api, getSettings, saveSettings } from "./api.js";
import { fontDB, fetchGoogleFont } from "./fonts.js";
import { DEFAULTS, fontKey } from "./model.js";
const inflight = new Map();
async function font(message) {
  const s = await getSettings();
  if (message.family.startsWith("custom:")) {
    const f = await fontDB("get", message.family);
    if (!f) throw new Error("Custom font is missing.");
    return [
      {
        data: f.data,
        weight: f.weight || "400",
        style: f.style || "normal",
      },
    ];
  }
  const catalogue = await (
    await fetch(api.runtime.getURL("catalogue.json"))
  ).json();
  const entry = catalogue.families.find((f) => f.family === message.family);
  if (!entry) throw new Error("Choose a font from the catalogue.");
  if (!entry.styles.includes(message.style))
    message = { ...message, style: entry.styles[0] };
  const availableWeights =
    message.style === "italic"
      ? entry.italicWeights || entry.weights
      : entry.weights;
  if (availableWeights.length && !availableWeights.includes(message.weight)) {
    const weight = availableWeights.reduce((nearest, value) =>
      Math.abs(value - message.weight) < Math.abs(nearest - message.weight)
        ? value
        : nearest,
    );
    message = { ...message, weight };
  }
  const cached = await fontDB(
    "get",
    fontKey(message.family, message.weight, message.style),
  );
  if (cached) return cached.faces;
  if (!s.onlineFonts)
    throw new Error(
      "Downloads are paused. Use a cached or custom font, or enable Google Fonts downloads.",
    );
  return fetchGoogleFont(message);
}
async function pruneRequests() {
  const stored = await api.storage.local.get(null);
  const stale = Object.keys(stored).filter(
    (key) =>
      key.startsWith("request:") &&
      (!stored[key]?.created || Date.now() - stored[key].created > 3600000),
  );
  if (stale.length) await api.storage.local.remove(stale);
}
void pruneRequests().catch((error) =>
  console.debug("Fontify request cleanup:", error.message),
);
async function menus() {
  await api.contextMenus.removeAll();
  api.contextMenus.create({
    id: "fontify",
    title: "Fontify",
    contexts: ["selection"],
  });
  for (const [id, title] of [
    ["font", "Override this font…"],
    ["block", "Override this text / code block…"],
    ["preserve", "Keep this font unchanged"],
  ])
    api.contextMenus.create({
      id,
      parentId: "fontify",
      title,
      contexts: ["selection"],
    });
}
api.runtime.onInstalled.addListener(async () => {
  if (!(await api.storage.local.get("settings")).settings)
    await saveSettings(DEFAULTS);
  await menus();
});
api.runtime.onStartup.addListener(menus);
api.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type !== "font") return;
  if (
    typeof message.family !== "string" ||
    message.family.length > 200 ||
    ![100, 200, 300, 400, 500, 600, 700, 800, 900].includes(+message.weight) ||
    !["normal", "italic"].includes(message.style)
  ) {
    respond({ error: "Invalid font request." });
    return;
  }
  const key = fontKey(message.family, message.weight, message.style);
  if (!inflight.has(key))
    inflight.set(
      key,
      font(message).finally(() => inflight.delete(key)),
    );
  inflight.get(key).then(
    (faces) => respond({ faces }),
    (error) => respond({ error: error.message }),
  );
  return true;
});
api.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    const target = await api.tabs.sendMessage(
      tab.id,
      { type: "describe" },
      { frameId: info.frameId || 0 },
    );
    if (!target) return;
    if (info.menuItemId === "preserve") {
      const s = await getSettings();
      if (!s.exceptions.fonts.includes(target.family))
        s.exceptions.fonts.push(target.family);
      await saveSettings(s);
      return;
    }
    const id = crypto.randomUUID();
    await api.storage.local.set({
      [`request:${id}`]: {
        ...target,
        kind: info.menuItemId,
        tabId: tab.id,
        created: Date.now(),
      },
    });
    await api.tabs.create({
      url: api.runtime.getURL(`options.html#override=${id}`),
    });
  } catch (error) {
    console.warn("Fontify context action:", error.message);
  }
});
