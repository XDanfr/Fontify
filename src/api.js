export const api = globalThis.browser || globalThis.chrome;
export async function getSettings() {
  const { normalise } = await import("./model.js");
  return normalise((await api.storage.local.get("settings")).settings);
}
export async function saveSettings(settings) {
  const { normalise } = await import("./model.js");
  await api.storage.local.set({ settings: normalise(settings) });
}
