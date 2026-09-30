import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
const font = (await readFile("public/fonts/outfit.ttf")).toString("base64");
const fixture = `<!doctype html><html><head><style>body{font-family:Arial,sans-serif}.mono{font-family:monospace}.icons{font-family:'Material Icons',sans-serif}.retained{font-family:Georgia}</style></head><body><p id="normal">Hello Fontify <span id="kept">Preserve inherited text</span> <strong id="bold">Bold text</strong> <em id="italic">Italic text</em></p><p class="mono" id="mono">A monospace label</p><pre id="code"><code>const premium = true;</code></pre><span class="icons" id="icon">home</span><p id="inline" style="font-family:Georgia;font-weight:300!important">Keep my original style</p><div id="shadow-host"></div><script>const shadow=document.querySelector('#shadow-host').attachShadow({mode:'open'});shadow.innerHTML='<p id="shadow-text">Shadow text</p>';</script></body></html>`;
const server = createServer((req, res) => {
  res.setHeader("content-type", "text/html");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src 'none'",
  );
  res.end(fixture);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(join(tmpdir(), "fontify-test-"));
const extension = resolve("dist/chrome");
let context;
const errors = [];
try {
  context = await chromium.launchPersistentContext(profile, {
    headless: true,
    channel: "chromium",
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      "--no-sandbox",
    ],
    viewport: { width: 1240, height: 1000 },
  });
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  // Deterministic remote responses exercise the real download/cache pipeline without network dependency.
  await worker.evaluate(
    ({ font }) => {
      const original = globalThis.fetch.bind(globalThis);
      globalThis.fetch = async function (url, ...args) {
        const value = String(url);
        if (value.startsWith("https://fonts.googleapis.com")) {
          const parsed = new URL(value);
          const italic = parsed.searchParams.get("family").includes("@1,");
          const weight = parsed.searchParams.get("family").split(",").at(-1);
          if (
            parsed.searchParams.get("family").startsWith("Bungee:") &&
            (weight !== "400" || italic)
          )
            return new Response("Unsupported face", { status: 400 });
          return new Response(
            `@font-face {font-family:Fixture;font-style:${italic ? "italic" : "normal"};font-weight:${weight};src:url(https://fonts.gstatic.com/fixture.ttf);}`,
          );
        }
        if (value === "https://fonts.gstatic.com/fixture.ttf")
          return new Response(
            Uint8Array.from(atob(font), (c) => c.charCodeAt(0)),
          );
        return original(url, ...args);
      };
    },
    { font },
  );
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  await page.waitForFunction(() =>
    getComputedStyle(document.querySelector("#normal")).fontFamily.includes(
      "Fontify_",
    ),
  );
  assert.equal(
    await page
      .locator("#bold")
      .evaluate((el) => getComputedStyle(el).fontWeight),
    "700",
  );
  assert.equal(
    await page
      .locator("#italic")
      .evaluate((el) => getComputedStyle(el).fontStyle),
    "italic",
  );
  for (const selector of ["#mono", "#code code", "#icon"])
    assert(
      !(await page
        .locator(selector)
        .evaluate((el) =>
          getComputedStyle(el).fontFamily.includes("Fontify_"),
        )),
      `${selector} should be protected`,
    );
  await page.waitForFunction(() =>
    getComputedStyle(
      document.querySelector("#shadow-host").shadowRoot.querySelector("p"),
    ).fontFamily.includes("Fontify_"),
  );
  await page.evaluate(() => {
    const p = document.createElement("p");
    p.id = "dynamic";
    p.textContent = "New dynamic text";
    document.body.append(p);
  });
  await page.waitForFunction(() =>
    getComputedStyle(document.querySelector("#dynamic")).fontFamily.includes(
      "Fontify_",
    ),
  );
  const options = await context.newPage();
  options.on("pageerror", (e) => errors.push(e.message));
  await options.goto(`chrome-extension://${id}/options.html`);
  await options
    .getByRole("heading", { name: "Make yourself at font." })
    .waitFor();
  assert.deepEqual(
    await options
      .locator('select[aria-label="Font weight"]')
      .evaluateAll((els) => els.slice(0, 3).map((el) => el.value)),
    ["400", "700", "400"],
  );
  await options.waitForFunction(() =>
    document.fonts.check("19px Fontify_4f_75_74_66_69_74"),
  );
  // Category profiles apply by original typography, independently of the default font.
  await options
    .getByRole("button", { name: "Choose serif font", exact: true })
    .click();
  await options.getByRole("searchbox", { name: "Search fonts" }).fill("Lora");
  await options
    .locator(".font-result .choose")
    .filter({ has: options.locator("b", { hasText: /^Lora$/ }) })
    .click();
  await page.waitForFunction(() =>
    getComputedStyle(document.querySelector("#inline")).fontFamily.includes(
      "Fontify_4c_6f_72_61",
    ),
  );
  await options
    .getByRole("button", { name: "Choose sans-serif font", exact: true })
    .click();
  await options.getByRole("searchbox", { name: "Search fonts" }).fill("Roboto");
  await options
    .locator(".font-result .choose")
    .filter({ has: options.locator("b", { hasText: /^Roboto$/ }) })
    .click();
  await page.waitForFunction(() =>
    getComputedStyle(document.querySelector("#normal")).fontFamily.includes(
      "Fontify_52_6f_62_6f_74_6f",
    ),
  );
  await options
    .getByRole("switch", {
      name: "Replace code and monospace fonts",
      exact: true,
    })
    .click();
  await page.waitForFunction(() =>
    getComputedStyle(document.querySelector("#code code")).fontFamily.includes(
      "Fontify_4a_65_74_42_72_61_69_6e_73_20_4d_6f_6e_6f",
    ),
  );
  assert(
    (
      await page
        .locator("#mono")
        .evaluate((el) => getComputedStyle(el).fontFamily)
    ).includes("Fontify_4a_65_74_42_72_61_69_6e_73_20_4d_6f_6e_6f"),
  );
  assert(
    !(
      await page
        .locator("#icon")
        .evaluate((el) => getComputedStyle(el).fontFamily)
    ).includes("Fontify_"),
  );
  await options
    .getByRole("switch", {
      name: "Replace code and monospace fonts",
      exact: true,
    })
    .click();
  await page.waitForFunction(
    () =>
      !getComputedStyle(
        document.querySelector("#code code"),
      ).fontFamily.includes("Fontify_"),
  );
  // Clear the category override to exercise legacy default-font behaviour below.
  await options
    .getByRole("button", { name: "Choose sans-serif font", exact: true })
    .click();
  await options.getByRole("button", { name: /Use default typeface/ }).click();
  const fallback = await options.evaluate(() =>
    chrome.runtime.sendMessage({
      type: "font",
      family: "Bungee",
      weight: 700,
      style: "italic",
    }),
  );
  assert(!fallback.error);
  assert.equal(fallback.faces[0].weight, "400");
  assert.equal(fallback.faces[0].style, "normal");
  const italicOnly = await options.evaluate(() =>
    chrome.runtime.sendMessage({
      type: "font",
      family: "Molle",
      weight: 800,
      style: "normal",
    }),
  );
  assert(!italicOnly.error);
  assert.equal(italicOnly.faces[0].weight, "400");
  assert.equal(italicOnly.faces[0].style, "italic");
  await mkdir("test-results", { recursive: true });
  await options.screenshot({
    path: "test-results/options-dark.png",
    fullPage: true,
  });
  await options
    .getByRole("button", { name: "Switch to light theme", exact: true })
    .click();
  await options.waitForFunction(
    () => document.querySelector("m3e-theme").scheme === "light",
  );
  await options.screenshot({
    path: "test-results/options-light.png",
    fullPage: true,
  });
  await options
    .getByRole("button", { name: "Choose regular font", exact: true })
    .click();
  await options
    .getByRole("searchbox", { name: "Search fonts" })
    .fill("Atkinson");
  assert((await options.locator(".font-result .choose").count()) >= 1);
  await options.getByRole("button", { name: "Close font picker" }).click();
  await options.getByRole("button", { name: "Font library" }).click();
  await options.getByRole("button", { name: "Explore fonts" }).click();
  await options.getByRole("searchbox", { name: "Search fonts" }).fill("Inter");
  await options
    .locator(".font-result .choose")
    .filter({ has: options.locator("b", { hasText: /^Inter$/ }) })
    .click();
  await page.waitForFunction(() =>
    getComputedStyle(document.querySelector("#normal")).fontFamily.includes(
      "Fontify_49_6e_74_65_72",
    ),
  );
  await options.getByRole("button", { name: "Exceptions" }).click();
  await options.locator("#exception-type").selectOption("selectors");
  await options.locator("#exception-value").fill("#inline");
  await options
    .getByRole("button", { name: "Add exception", exact: true })
    .click();
  await page.waitForFunction(() =>
    getComputedStyle(document.querySelector("#inline")).fontFamily.includes(
      "Georgia",
    ),
  );
  assert.equal(
    await page
      .locator("#inline")
      .evaluate((el) => el.style.getPropertyPriority("font-weight")),
    "important",
  );
  await options.locator("#exception-value").fill("#kept");
  await options
    .getByRole("button", { name: "Add exception", exact: true })
    .click();
  await page.waitForFunction(() =>
    getComputedStyle(document.querySelector("#kept")).fontFamily.includes(
      "Arial",
    ),
  );
  await options.getByRole("button", { name: "Font library" }).click();
  await options
    .getByLabel("Upload custom fonts")
    .setInputFiles("public/fonts/outfit.ttf");
  await options
    .locator(".list-item")
    .filter({ hasText: "outfit.ttf" })
    .waitFor();
  await options
    .locator(".list-item")
    .filter({ hasText: "outfit.ttf" })
    .getByRole("button", { name: "Use", exact: true })
    .click();
  await page.waitForFunction(() =>
    getComputedStyle(document.querySelector("#normal")).fontFamily.includes(
      "Fontify_63_75_73_74_6f_6d_3a",
    ),
  );
  // Exercise the same describe request used by the native context menu.
  await page.locator("#code code").evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    el.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, composed: true }),
    );
  });
  const target = await options.evaluate(async () => {
    const [tab] = (await chrome.tabs.query({})).filter((t) =>
      t.url?.startsWith("http://127.0.0.1"),
    );
    return chrome.tabs.sendMessage(tab.id, { type: "describe" });
  });
  assert.equal(target.family, "monospace");
  assert(target.selector.includes("#code"));
  await options.evaluate(async (target) => {
    await chrome.storage.local.set({
      "request:fixture": { ...target, kind: "block", created: Date.now() },
    });
  }, target);
  await options.goto(`chrome-extension://${id}/options.html#override=fixture`);
  await options.getByRole("heading", { name: "Override monospace" }).waitFor();
  await options
    .getByRole("button", { name: "Save override", exact: true })
    .click();
  await page.waitForFunction(() =>
    getComputedStyle(document.querySelector("#code code")).fontFamily.includes(
      "Fontify_",
    ),
  );
  await page.reload();
  await page.waitForFunction(() =>
    getComputedStyle(document.querySelector("#code code")).fontFamily.includes(
      "Fontify_",
    ),
  );
  await options.getByRole("button", { name: "Typography" }).click();
  await options
    .getByRole("switch", { name: "Enable Fontify", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      !getComputedStyle(document.querySelector("#normal")).fontFamily.includes(
        "Fontify_",
      ),
  );
  assert.equal(
    await page.locator("#inline").evaluate((el) => el.style.fontFamily),
    "Georgia",
  );
  assert.equal(
    await page.locator("#inline").evaluate((el) => el.style.fontWeight),
    "300",
  );
  await options
    .getByRole("switch", { name: "Enable Fontify", exact: true })
    .click();
  await page.waitForFunction(() =>
    getComputedStyle(document.querySelector("#normal")).fontFamily.includes(
      "Fontify_",
    ),
  );
  const popup = await context.newPage();
  popup.on("pageerror", (e) => errors.push(e.message));
  await popup.setViewportSize({ width: 390, height: 660 });
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.getByRole("button", { name: "All settings ↗" }).waitFor();
  await popup.screenshot({
    path: "test-results/popup-light.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: extension API, dynamic/shadow text, code/icon protection, live profiles, custom upload, exceptions, persisted block override, reversible pause, picker and light/dark UI.",
  );
} finally {
  await context?.close();
  server.close();
  await rm(profile, { recursive: true, force: true });
}
