/** Read standard SFNT descriptors so static and variable uploads keep their real capabilities. */
export function fontMetadata(buffer) {
  const view = new DataView(buffer);
  if (
    buffer.byteLength < 12 ||
    ![0x00010000, 0x4f54544f, 0x74727565].includes(view.getUint32(0))
  )
    throw new Error("This file is not a valid TTF or OTF font.");
  const tables = new Map();
  for (let i = 0; i < view.getUint16(4); i++) {
    const start = 12 + i * 16;
    if (start + 16 > view.byteLength)
      throw new Error("The font table directory is incomplete.");
    const tag = String.fromCharCode(...new Uint8Array(buffer, start, 4));
    const offset = view.getUint32(start + 8),
      length = view.getUint32(start + 12);
    if (offset + length > view.byteLength)
      throw new Error("The font contains an invalid table.");
    tables.set(tag, { offset, length });
  }
  let weight = "400",
    style = "normal";
  const os2 = tables.get("OS/2"),
    head = tables.get("head");
  if (os2?.length >= 6)
    weight = String(
      Math.max(1, Math.min(1000, view.getUint16(os2.offset + 4) || 400)),
    );
  if (os2?.length >= 64)
    style = view.getUint16(os2.offset + 62) & 1 ? "italic" : "normal";
  else if (head?.length >= 46)
    style = view.getUint16(head.offset + 44) & 2 ? "italic" : "normal";
  const fvar = tables.get("fvar");
  if (fvar?.length >= 16) {
    const start = fvar.offset + view.getUint16(fvar.offset + 4),
      count = view.getUint16(fvar.offset + 8),
      size = view.getUint16(fvar.offset + 10);
    if (size >= 20)
      for (let i = 0; i < count; i++) {
        const p = start + i * size;
        if (p + 20 > fvar.offset + fvar.length) break;
        const tag = String.fromCharCode(...new Uint8Array(buffer, p, 4));
        if (tag === "wght") {
          const min = view.getInt32(p + 4) / 65536,
            max = view.getInt32(p + 12) / 65536;
          if (min >= 1 && max <= 1000 && max >= min) weight = `${min} ${max}`;
        }
      }
  }
  return { weight, style };
}
