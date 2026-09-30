import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fontMetadata } from "../src/font-metadata.js";
test("variable Outfit metadata retains its real weight range", async () => {
  const bytes = await readFile("public/fonts/outfit.ttf");
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
  assert.deepEqual(fontMetadata(buffer), {
    weight: "100 900",
    style: "normal",
  });
});
test("truncated uploads are rejected", () => {
  assert.throws(() => fontMetadata(new ArrayBuffer(2)), /valid TTF/);
  const bytes = new ArrayBuffer(28);
  const view = new DataView(bytes);
  view.setUint32(0, 0x00010000);
  view.setUint16(4, 1);
  view.setUint32(20, 9999);
  assert.throws(() => fontMetadata(bytes), /invalid table/);
});
