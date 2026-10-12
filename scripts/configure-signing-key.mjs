import { createPrivateKey } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

let value = process.env.CHROME_PRIVATE_KEY?.trim();
if (!value) throw new Error("CHROME_PRIVATE_KEY is required");
if (value.startsWith('"')) {
  try {
    value = JSON.parse(value);
  } catch {
    /* Try the original representation below. */
  }
}
value = value
  .replaceAll("\\r\\n", "\n")
  .replaceAll("\\n", "\n")
  .replaceAll("\r\n", "\n");
const candidates = [{ key: value }];
if (/^[A-Za-z0-9+/=\s]+$/.test(value)) {
  const decoded = Buffer.from(value.replaceAll(/\s/g, ""), "base64");
  candidates.push(
    { key: decoded },
    { key: decoded, format: "der", type: "pkcs8" },
    { key: decoded, format: "der", type: "pkcs1" },
  );
}
let key;
for (const candidate of candidates) {
  try {
    key = createPrivateKey(candidate);
    break;
  } catch {
    /* Never log key material or decoder inputs. */
  }
}
if (!key)
  throw new Error(
    "CHROME_PRIVATE_KEY must contain an unencrypted RSA private key: PEM, base64 PEM, or base64 DER. No replacement key was generated.",
  );
if (
  key.asymmetricKeyType !== "rsa" ||
  key.asymmetricKeyDetails.modulusLength < 2048
)
  throw new Error(
    "Chrome signing requires an RSA private key of at least 2048 bits",
  );
const path = join(process.env.RUNNER_TEMP, "fontify.pem");
await writeFile(path, key.export({ format: "pem", type: "pkcs8" }), {
  mode: 0o600,
});
await writeFile(process.env.GITHUB_ENV, `CHROME_KEY_PATH=${path}\n`, {
  flag: "a",
});
console.log(
  "Validated stored RSA key and wrote temporary PEM without changing its identity.",
);
