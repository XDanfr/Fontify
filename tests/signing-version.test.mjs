import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
const script = resolve("scripts/signed-dry-run.mjs");
function prepare(run, attempt) {
  const dir = mkdtempSync(join(tmpdir(), "fontify-version-"));
  try {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ version: "1.1.0" }),
    );
    for (const browser of ["chrome", "firefox"]) {
      mkdirSync(join(dir, "dist", browser), { recursive: true });
      writeFileSync(
        join(dir, "dist", browser, "manifest.json"),
        JSON.stringify({
          version: "1.1.0",
          browser_specific_settings: { gecko: { id: "fontify@xdan.cc" } },
        }),
      );
    }
    const result = spawnSync(process.execPath, [script, "prepare"], {
      cwd: dir,
      env: {
        ...process.env,
        GITHUB_RUN_NUMBER: String(run),
        GITHUB_RUN_ATTEMPT: String(attempt),
        GITHUB_ENV: join(dir, "env"),
      },
      encoding: "utf8",
    });
    const manifests = ["chrome", "firefox"].map((browser) =>
      JSON.parse(readFileSync(join(dir, "dist", browser, "manifest.json"))),
    );
    return { result, manifests };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
test("dispatch and retry allocate distinct versions and retain the Firefox identity", () => {
  const first = prepare(7, 1);
  const retry = prepare(7, 2);
  const next = prepare(8, 1);
  for (const item of [first, retry, next]) {
    assert.equal(item.result.status, 0, item.result.stderr);
    assert.equal(item.manifests[0].version, item.manifests[1].version);
    assert.equal(
      item.manifests[1].browser_specific_settings.gecko.id,
      "fontify@xdan.cc",
    );
  }
  assert.equal(
    new Set([first, retry, next].map((item) => item.manifests[0].version)).size,
    3,
  );
});
test("invalid counters fail before changing manifests", () => {
  for (const counters of [
    [65536, 1],
    [1, 100],
    [0, 1],
    [1, 0],
  ]) {
    const item = prepare(...counters);
    assert.notEqual(item.result.status, 0);
    assert(item.manifests.every((manifest) => manifest.version === "1.1.0"));
  }
});
