import { readFile, writeFile } from "node:fs/promises";
// Public Google Fonts metadata: no API key and no remote executable code.
let raw;
if (process.argv[2]) raw = await readFile(process.argv[2], "utf8");
else {
  const response = await fetch("https://fonts.google.com/metadata/fonts");
  if (!response.ok)
    throw new Error(`Catalogue request failed: ${response.status}`);
  raw = await response.text();
}
const metadata = JSON.parse(raw.replace(/^\)\]\}'\s*/, ""));
const families = metadata.familyMetadataList
  .map((f) => {
    const keys = Object.keys(f.fonts);
    const normal = keys
      .filter((k) => !k.includes("i"))
      .map(Number)
      .filter(Number.isFinite);
    const italic = keys
      .filter((k) => k.includes("i"))
      .map((k) => Number(k.replace("i", "")))
      .filter(Number.isFinite);
    return {
      family: f.family,
      category: f.category,
      weights: normal.length ? normal : italic,
      styles: [
        ...(normal.length ? ["normal"] : []),
        ...(italic.length ? ["italic"] : []),
      ],
      ...(italic.length ? { italicWeights: italic } : {}),
    };
  })
  .sort((a, b) => a.family.localeCompare(b.family));
if (families.length < 1000)
  throw new Error(
    "Unexpectedly small catalogue; refusing to replace snapshot.",
  );
await writeFile(
  "data/catalogue.json",
  JSON.stringify(
    {
      updated: new Date().toISOString().slice(0, 10),
      source: "https://fonts.google.com/metadata/fonts",
      families,
    },
    null,
    2,
  ) + "\n",
);
console.log(`Saved ${families.length} Google Fonts families.`);
