import assert from "node:assert/strict";
import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  copyFile,
} from "node:fs/promises";
import { createHash, createPublicKey, verify } from "node:crypto";
import { unzipSync } from "fflate";

const hash = (value) => createHash("sha256").update(value).digest();
const pkg = JSON.parse(await readFile("package.json"));
const mode = process.argv[2];
if (mode === "prepare") {
  // AMO consumes versions even on a failed signing attempt. Retries get a new version.
  const run = BigInt(process.env.GITHUB_RUN_NUMBER);
  const attempt = BigInt(process.env.GITHUB_RUN_ATTEMPT);
  assert(run > 0n && run < 65536n && attempt > 0n && attempt < 100n);
  const version = `0.0.${run}.${attempt}`;
  for (const browser of ["chrome", "firefox"]) {
    const path = `dist/${browser}/manifest.json`;
    const manifest = JSON.parse(await readFile(path));
    manifest.version = version;
    await writeFile(path, JSON.stringify(manifest, null, 2));
  }
  await writeFile("package.json", JSON.stringify({ ...pkg, version }, null, 2));
  await writeFile(process.env.GITHUB_ENV, `TEST_VERSION=${version}\n`, {
    flag: "a",
  });
  console.log(
    `Test version ${version}; source version ${pkg.version}; Firefox ID fontify@xdan.cc`,
  );
} else if (mode === "verify") {
  await mkdir("verified", { recursive: true });
  const version = pkg.version;
  const records = [];
  const archives = {};
  async function archive(path, browser, signed = false) {
    const bytes = await readFile(path);
    const files = unzipSync(bytes);
    assert(files["manifest.json"], `${path}: missing root manifest`);
    const manifest = JSON.parse(Buffer.from(files["manifest.json"]));
    assert.equal(manifest.name, "Fontify");
    assert.equal(manifest.version, version);
    assert.equal(manifest.manifest_version, 3);
    if (browser === "firefox")
      assert.equal(
        manifest.browser_specific_settings.gecko.id,
        "fontify@xdan.cc",
      );
    for (const [name, content] of Object.entries(files)) {
      assert(
        !name.startsWith("/") && !name.split("/").includes(".."),
        `Unsafe path: ${name}`,
      );
      assert(
        !/(^|\/)(\.git|node_modules|\.env|.*\.(pem|key|p12|pfx))($|\/)/i.test(
          name,
        ),
        `Forbidden file: ${name}`,
      );
      assert(
        !/-----BEGIN (?:RSA |EC |ENCRYPTED |OPENSSH )?PRIVATE KEY-----/.test(
          Buffer.from(content).toString(),
        ),
        `Private key in ${name}`,
      );
      for (const secretName of [
        "CHROME_PRIVATE_KEY",
        "AMO_JWT_ISSUER",
        "AMO_JWT_SECRET",
      ]) {
        const secret = process.env[secretName];
        if (secret)
          assert(
            !Buffer.from(content).includes(Buffer.from(secret)),
            `Secret found in ${name}`,
          );
      }
    }
    if (signed) {
      for (const name of [
        "META-INF/manifest.mf",
        "META-INF/mozilla.sf",
        "META-INF/mozilla.rsa",
      ])
        assert(files[name], `Missing Mozilla signature: ${name}`);
      const original = archives.firefox;
      for (const [name, content] of Object.entries(original))
        assert.deepEqual(
          files[name],
          content,
          `Signed payload changed: ${name}`,
        );
      for (const name of Object.keys(files))
        assert(
          original[name] || name.startsWith("META-INF/"),
          `Unexpected signed file: ${name}`,
        );
    }
    return { files, bytes };
  }
  async function publish(source, name, bytes) {
    if (source) await copyFile(source, `verified/${name}`);
    else await writeFile(`verified/${name}`, bytes);
    const content = bytes || (await readFile(source));
    records.push({
      file: name,
      bytes: content.length,
      sha256: hash(content).toString("hex"),
    });
  }
  for (const browser of ["chrome", "firefox"]) {
    const path = `artifacts/fontify-${version}-${browser}.zip`;
    const { files } = await archive(path, browser);
    archives[browser] = files;
    await publish(path, `fontify-${version}-TEST-${browser}.zip`);
  }
  const crx = await readFile(`artifacts/fontify-${version}.crx`);
  assert.equal(crx.subarray(0, 4).toString(), "Cr24");
  assert.equal(crx.readUInt32LE(4), 3);
  function fields(data) {
    let offset = 0;
    function varint() {
      let value = 0,
        shift = 0;
      while (true) {
        assert(offset < data.length && shift < 35, "Invalid protobuf varint");
        const byte = data[offset++];
        value += (byte & 127) * 2 ** shift;
        if (!(byte & 128)) return value;
        shift += 7;
      }
    }
    const result = new Map();
    while (offset < data.length) {
      const tag = varint();
      assert.equal(tag & 7, 2);
      const size = varint();
      assert(offset + size <= data.length);
      const value = data.subarray(offset, offset + size);
      offset += size;
      const id = tag >>> 3;
      assert(!result.has(id), "Duplicate protobuf field");
      result.set(id, value);
    }
    return result;
  }
  const headerSize = crx.readUInt32LE(8);
  assert(headerSize > 0 && headerSize < crx.length - 12);
  const header = fields(crx.subarray(12, 12 + headerSize));
  const proof = fields(header.get(2));
  const publicKey = proof.get(1);
  const expectedKey = createPublicKey(
    await readFile(process.env.CHROME_KEY_PATH),
  ).export({ type: "spki", format: "der" });
  assert.deepEqual(
    publicKey,
    expectedKey,
    "CRX does not use configured stable key",
  );
  const signedHeader = header.get(10000);
  const id = hash(publicKey).subarray(0, 16);
  assert.deepEqual(fields(signedHeader).get(1), id);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(signedHeader.length);
  const payload = crx.subarray(12 + headerSize);
  assert(
    verify(
      "sha256",
      Buffer.concat([
        Buffer.from("CRX3 SignedData\0"),
        size,
        signedHeader,
        payload,
      ]),
      createPublicKey({ key: publicKey, format: "der", type: "spki" }),
      proof.get(2),
    ),
    "Invalid CRX signature",
  );
  assert.deepEqual(
    unzipSync(payload),
    archives.chrome,
    "CRX/ZIP payload mismatch",
  );
  await publish(null, `fontify-${version}-TEST-chrome-signed.crx`, crx);
  const signed = (await readdir("artifacts/signed")).filter((name) =>
    name.endsWith(".xpi"),
  );
  assert.equal(signed.length, 1, "Expected exactly one Mozilla-signed XPI");
  const xpi = `artifacts/signed/${signed[0]}`;
  await archive(xpi, "firefox", true);
  await publish(xpi, `fontify-${version}-TEST-firefox-signed.xpi`);
  const report = {
    version,
    chromeId: [...id.toString("hex")]
      .map((c) => String.fromCharCode(97 + parseInt(c, 16)))
      .join(""),
    firefoxId: "fontify@xdan.cc",
    crxSignatureVerified: true,
    firefoxSignatureVerification: "Required next: Firefox release AddonManager",
    records,
  };
  await writeFile(
    "verified/verification.json",
    JSON.stringify(report, null, 2),
  );
  await writeFile(
    "verified/SHA256SUMS",
    records.map((r) => `${r.sha256}  ${r.file}`).join("\n") + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} else throw new Error("Expected prepare or verify");
