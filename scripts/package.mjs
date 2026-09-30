import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { generateKeyPairSync, createPrivateKey } from "node:crypto";
import { zipSync } from "fflate";
import crx3 from "crx3";
const { version } = JSON.parse(await readFile("package.json"));
await mkdir("artifacts", { recursive: true });
async function zipDirectory(root) {
  const files = {};
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else
        files[relative(root, path).replaceAll("\\", "/")] = [
          new Uint8Array(await readFile(path)),
          { mtime: new Date("2026-01-01") },
        ];
    }
  }
  await walk(root);
  return zipSync(files, { level: 9 });
}
for (const browser of ["chrome", "firefox"]) {
  const zip = await zipDirectory(`dist/${browser}`);
  await writeFile(`artifacts/fontify-${version}-${browser}.zip`, zip);
  if (browser === "firefox")
    await writeFile(`artifacts/fontify-${version}-unsigned.xpi`, zip);
}
const keyPath = process.env.CHROME_KEY_PATH || "artifacts/development-key.pem";
try {
  createPrivateKey(await readFile(keyPath));
} catch (error) {
  if (process.env.CHROME_KEY_PATH || error.code !== "ENOENT") throw error;
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  await writeFile(keyPath, privateKey, { mode: 0o600 });
}
await crx3(["dist/chrome"], {
  keyPath,
  crxPath: `artifacts/fontify-${version}.crx`,
});
console.log(
  "Created Chrome ZIP/CRX3 and Firefox ZIP/unsigned XPI. Private keys are never release assets.",
);
if (!process.env.CHROME_KEY_PATH)
  console.log(
    "Development CRX key generated locally; configure CHROME_PRIVATE_KEY in Actions for a stable extension identity.",
  );
