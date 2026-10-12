import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createPublicKey } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const pem = privateKey.export({ type: "pkcs8", format: "pem" });
for (const [name, input] of Object.entries({
  PEM: pem,
  escaped: pem.replaceAll("\n", "\\n"),
  base64PEM: Buffer.from(pem).toString("base64"),
  base64DER: privateKey
    .export({ type: "pkcs8", format: "der" })
    .toString("base64"),
  JSON: JSON.stringify(pem),
})) {
  test(`stored ${name} preserves the RSA identity`, () => {
    const dir = mkdtempSync(join(tmpdir(), "fontify-key-"));
    try {
      const result = spawnSync(
        process.execPath,
        ["scripts/configure-signing-key.mjs"],
        {
          env: {
            ...process.env,
            CHROME_PRIVATE_KEY: input,
            RUNNER_TEMP: dir,
            GITHUB_ENV: join(dir, "env"),
          },
          encoding: "utf8",
        },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(
        createPublicKey(readFileSync(join(dir, "fontify.pem"))).export({
          type: "spki",
          format: "der",
        }),
        publicKey.export({ type: "spki", format: "der" }),
      );
      assert(!result.stdout.includes(pem));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
test("invalid key fails without generating a replacement", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/configure-signing-key.mjs"],
    {
      env: { ...process.env, CHROME_PRIVATE_KEY: "invalid-key" },
      encoding: "utf8",
    },
  );
  assert.notEqual(result.status, 0);
  assert(result.stderr.includes("No replacement key was generated"));
});
