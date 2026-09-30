import { api } from "./api.js";
import { alias, fontKey } from "./model.js";
export function openFontDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("fontify-fonts", 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore("fonts", { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function fontDB(action, value) {
  const db = await openFontDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(
        "fonts",
        action === "getAll" || action === "get" ? "readonly" : "readwrite",
      );
      const store = tx.objectStore("fonts");
      const r = action === "getAll" ? store.getAll() : store[action](value);
      tx.oncomplete = () => resolve(r.result);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function customList() {
  return (await fontDB("getAll"))
    .filter((f) => f.custom)
    .map(({ id, family, name, size }) => ({ id, family, name, size }));
}
export async function importFont(file) {
  if (!/\.(ttf|otf)$/i.test(file.name) || file.size > 15 * 1024 * 1024)
    throw new Error("Choose a TTF or OTF file smaller than 15 MB.");
  const buffer = await file.arrayBuffer();
  const magic = new DataView(buffer).getUint32(0);
  if (![0x00010000, 0x4f54544f, 0x74727565].includes(magic))
    throw new Error("This file is not a valid TTF or OTF font.");
  const id = crypto.randomUUID();
  const face = new FontFace(alias(`custom:${id}`), buffer);
  await face.load();
  const data = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  const family = file.name.replace(/\.(ttf|otf)$/i, "");
  await fontDB("put", {
    id: `custom:${id}`,
    family,
    name: file.name,
    size: file.size,
    custom: true,
    data,
  });
  return { id: `custom:${id}`, family };
}
export async function loadFace(profile) {
  const response = await api.runtime.sendMessage({ type: "font", ...profile });
  if (response?.error) throw new Error(response.error);
  const faces = response.faces || [];
  for (const f of faces) {
    const face = new FontFace(alias(profile.family), `url(${f.data})`, {
      weight: f.weight || String(profile.weight),
      style: f.style || profile.style || "normal",
      ...(f.unicodeRange ? { unicodeRange: f.unicodeRange } : {}),
    });
    await face.load();
    document.fonts.add(face);
  }
  return alias(profile.family);
}
export async function fetchGoogleFont({
  family,
  weight = 400,
  style = "normal",
}) {
  const key = fontKey(family, weight, style);
  const cached = await fontDB("get", key);
  if (cached) return cached.faces;
  const endpoint = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:ital,wght@${style === "italic" ? 1 : 0},${weight}&display=swap`;
  const r = await fetch(endpoint);
  if (!r.ok)
    throw new Error(
      "Google Fonts could not provide that style or weight. Try another weight.",
    );
  const css = await r.text();
  const faces = [];
  for (const match of css.matchAll(/@font-face\s*\{([^}]+)\}/g)) {
    const block = match[1],
      url = block.match(/url\(([^)]+)\)/)?.[1]?.replace(/['"]/g, "");
    if (!url || new URL(url).hostname !== "fonts.gstatic.com") continue;
    const response = await fetch(url);
    if (!response.ok) throw new Error("Font download failed.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    faces.push({
      data: `data:font/woff2;base64,${btoa(binary)}`,
      weight:
        block.match(/font-weight:\s*([^;]+)/)?.[1]?.trim() || String(weight),
      style: block.match(/font-style:\s*([^;]+)/)?.[1]?.trim() || style,
      unicodeRange: block.match(/unicode-range:\s*([^;]+)/)?.[1]?.trim(),
    });
  }
  if (!faces.length) throw new Error("No font faces were returned.");
  await fontDB("put", { id: key, faces, custom: false });
  return faces;
}
