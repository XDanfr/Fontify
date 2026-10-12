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
async function capture(page, options) {
  await page.bringToFront();
  await page.screenshot({ ...options, animations: "disabled" });
}
async function checkContrast(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  const failures = await page.evaluate(() => {
    const luminance = (rgb) =>
      rgb
        .slice(0, 3)
        .map((v) => {
          const c = v / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        })
        .reduce((total, c, i) => total + c * [0.2126, 0.7152, 0.0722][i], 0);
    const colour = (value) =>
      value.match(/[\d.]+/g)?.map(Number) || [0, 0, 0, 0];
    const parent = (el) => el.parentElement || el.getRootNode().host;
    const failures = [];
    const visit = (root) => {
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) visit(el.shadowRoot);
        if (!el.getClientRects().length || el.closest("[inert]") || el.disabled)
          continue;
        if (
          ![...el.childNodes].some(
            (node) =>
              node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
          )
        )
          continue;
        const style = getComputedStyle(el);
        if (style.visibility === "hidden") continue;
        const foreground = colour(style.color);
        let background = [255, 255, 255];
        for (let ancestor = el; ancestor; ancestor = parent(ancestor)) {
          const c = colour(getComputedStyle(ancestor).backgroundColor);
          if (c[3] === undefined || c[3] === 1) {
            background = c;
            break;
          }
        }
        const a = luminance(foreground),
          b = luminance(background);
        const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        const large =
          parseFloat(style.fontSize) >= 24 ||
          (parseFloat(style.fontSize) >= 18.66 && +style.fontWeight >= 700);
        if (ratio < (large ? 3 : 4.5))
          failures.push({
            text: el.textContent.trim().slice(0, 50),
            ratio: +ratio.toFixed(2),
            foreground,
            background,
          });
      }
    };
    visit(document);
    return failures;
  });
  assert.deepEqual(failures, [], "Text contrast must pass WCAG AA");
}
async function checkTargets(page) {
  const small = await page
    .locator("button,m3e-button,m3e-icon-button,input,select")
    .evaluateAll((elements) =>
      elements
        .filter(
          (el) =>
            el.getClientRects().length &&
            !el.closest("[inert]") &&
            !el.disabled &&
            el.getBoundingClientRect().height < 44,
        )
        .map((el) => ({
          label: el.getAttribute("aria-label") || el.textContent.trim(),
          height: el.getBoundingClientRect().height,
        })),
    );
  assert.deepEqual(small, [], "Controls need a 44px target height");
}
try {
  context = await chromium.launchPersistentContext(profile, {
    headless: true,
    channel: "chromium",
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      "--window-size=1240,1000",
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
  await capture(options, {
    path: "test-results/options-dark.png",
    fullPage: true,
  });
  await options
    .getByRole("button", { name: "Switch to light theme", exact: true })
    .click();
  await options.waitForFunction(
    () => document.querySelector("m3e-theme").scheme === "light",
  );
  await capture(options, {
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
  await options
    .getByRole("button", { name: "Choose regular font", exact: true })
    .click();
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
  await popup.setViewportSize({ width: 520, height: 660 });
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.getByRole("button", { name: "All settings ↗" }).waitFor();
  await capture(popup, {
    path: "test-results/popup-light.png",
    fullPage: true,
  });
  // The specimen must show the selected profile, including the card glyphs.
  await options.waitForFunction(() =>
    getComputedStyle(
      document.querySelector("#glyph-regular"),
    ).fontFamily.includes("Fontify_"),
  );
  await options
    .getByLabel("Your preview text")
    .fill("Hamburgefontsiv 0123456789");
  assert.equal(
    await options.locator("#sample-heading").textContent(),
    "Hamburgefontsiv 0123456789",
  );
  await options.getByLabel("Preview size").fill("24");
  assert.equal(await options.locator("output").textContent(), "24px");
  await options.getByRole("button", { name: "Overrides", exact: true }).click();
  await options.getByRole("button", { name: "Edit", exact: true }).click();
  await options.waitForFunction(
    () => !!document.activeElement.closest('[role="dialog"]'),
  );
  await options
    .getByRole("button", { name: "Choose rule font", exact: true })
    .click();
  await options.keyboard.press("Escape");
  assert.equal(await options.getByRole("dialog").count(), 1);
  await options.keyboard.press("Escape");
  assert.equal(await options.getByRole("dialog").count(), 0);
  assert.equal(
    await options.evaluate(() => document.activeElement.textContent.trim()),
    "Edit",
  );
  await options.getByRole("button", { name: "Edit", exact: true }).click();
  await options.getByLabel("Font weight").selectOption("500");
  await options.getByRole("button", { name: "Save changes" }).click();
  await options.waitForFunction(async () => {
    const { settings } = await chrome.storage.local.get("settings");
    return settings.rules.some((rule) => rule.weight === 500);
  });
  await options
    .getByRole("button", { name: "Preferences", exact: true })
    .click();
  await options.emulateMedia({ colorScheme: "light" });
  await options.getByLabel("Colour mode").selectOption("auto");
  await options
    .getByRole("button", { name: "Switch to dark theme", exact: true })
    .click();
  await options.waitForFunction(
    () => document.querySelector("m3e-theme").scheme === "dark",
  );
  await options.getByLabel("Colour mode").selectOption("auto");
  await options.emulateMedia({ colorScheme: "dark" });
  await options
    .getByRole("button", { name: "Switch to light theme", exact: true })
    .click();
  await options.waitForFunction(
    () => document.querySelector("m3e-theme").scheme === "light",
  );
  await options
    .getByRole("switch", { name: "Allow Google Fonts downloads", exact: true })
    .click();
  await options
    .getByRole("switch", { name: "Allow Google Fonts downloads", exact: true })
    .click();
  const downloadPromise = options.waitForEvent("download");
  await options.getByRole("button", { name: "Export backup" }).click();
  const download = await downloadPromise;
  const backupPath = await download.path();
  options.on("dialog", (dialog) => dialog.accept());
  await options.locator("#backup-file").setInputFiles(backupPath);
  await options
    .getByText("Your collection is restored", { exact: true })
    .waitFor();
  await options.getByRole("button", { name: "Clear cache" }).click();
  await options
    .getByText("Google font cache cleared. Custom fonts are safe.", {
      exact: true,
    })
    .waitFor();
  for (const theme of ["light", "dark"]) {
    await options
      .getByRole("button", { name: "Preferences", exact: true })
      .click();
    await options.getByLabel("Colour mode").selectOption(theme);
    await options.waitForFunction(
      (theme) => document.querySelector("m3e-theme").scheme === theme,
      theme,
    );
    for (const width of [1240, 768, 390, 320]) {
      await options.setViewportSize({ width, height: 800 });
      for (const name of [
        "Typography",
        "Font library",
        "Exceptions",
        "Overrides",
        "Preferences",
      ]) {
        await options.getByRole("button", { name, exact: true }).click();
        assert(
          await options.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          `${name}: overflow at ${width}px in ${theme}`,
        );
        await checkContrast(options);
        await checkTargets(options);
        await capture(options, {
          path: `test-results/${name.toLowerCase().replaceAll(" ", "-")}-${theme}-${width}.png`,
          fullPage: false,
          animations: "disabled",
        });
      }
    }
  }
  await options
    .getByRole("button", { name: "Typography", exact: true })
    .click();
  await options
    .getByRole("button", { name: "Choose regular font", exact: true })
    .click();
  await options.getByRole("button", { name: "Show more", exact: true }).click();
  assert((await options.locator(".font-result").count()) > 60);
  await options.getByRole("searchbox", { name: "Search fonts" }).fill("Abel");
  await options.getByRole("button", { name: "Save Abel", exact: true }).click();
  await options.getByRole("button", { name: "★ Saved", exact: true }).click();
  await options
    .getByRole("button", { name: "Unsave Abel", exact: true })
    .click();
  await options.getByRole("heading", { name: "No fonts found." }).waitFor();
  await options.getByRole("button", { name: "All", exact: true }).click();
  await options
    .getByRole("searchbox", { name: "Search fonts" })
    .fill("no-such-font-1234");
  await options.getByRole("heading", { name: "No fonts found." }).waitFor();
  await options.keyboard.press("Escape");
  assert.equal(
    await options.evaluate(() =>
      document.activeElement.getAttribute("aria-label"),
    ),
    "Choose regular font",
  );
  for (const slot of ["bold", "italic", "code / monospace"]) {
    await options
      .getByRole("button", { name: `Choose ${slot} font`, exact: true })
      .click();
    await options.getByRole("button", { name: "All", exact: true }).click();
    await options
      .getByRole("searchbox", { name: "Search fonts" })
      .fill("Outfit");
    await options
      .locator(".font-result .choose")
      .filter({ has: options.locator("b", { hasText: /^Outfit$/ }) })
      .click();
  }
  await options
    .getByRole("button", { name: "Exceptions", exact: true })
    .click();
  await options.locator("#exception-type").selectOption("sites");
  await options.locator("#exception-value").fill("not a hostname");
  await options
    .getByRole("button", { name: "Add exception", exact: true })
    .click();
  await options
    .getByText("Use a hostname, such as example.com or *.example.com.", {
      exact: true,
    })
    .waitFor();
  await options.locator("#exception-type").selectOption("fonts");
  await options.locator("#exception-value").fill("Georgia");
  await options
    .getByRole("button", { name: "Add exception", exact: true })
    .click();
  await options
    .getByRole("button", { name: "Remove exception Georgia", exact: true })
    .click();
  await options.getByRole("button", { name: "Overrides", exact: true }).click();
  await options.getByRole("button", { name: "Edit", exact: true }).click();
  await options.getByRole("button", { name: "Cancel", exact: true }).click();
  await options.getByRole("button", { name: /Remove override/ }).click();
  await options
    .getByRole("heading", { name: "No saved overrides yet" })
    .waitFor();
  await options
    .getByRole("button", { name: "Font library", exact: true })
    .click();
  await options
    .getByRole("button", { name: "Choose regular font", exact: true })
    .click();
  for (const name of [
    "Sans",
    "Serif",
    "Display",
    "Handwriting",
    "Mono",
    "Custom",
    "★ Saved",
    "All",
  ]) {
    const filterButton = options.getByRole("button", { name, exact: true });
    await filterButton.click();
    assert.equal(await filterButton.getAttribute("aria-pressed"), "true");
    assert(
      await options.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await checkContrast(options);
  }
  await options.getByRole("button", { name: "Done", exact: true }).click();
  await worker.evaluate(async () => {
    const tab = (await chrome.tabs.query({})).find((tab) =>
      tab.url?.startsWith("http://127.0.0.1"),
    );
    await chrome.tabs.update(tab.id, { active: true });
  });
  await popup.reload();
  await popup.getByRole("button", { name: "Pause here", exact: true }).click();
  await popup.getByRole("button", { name: "Resume here", exact: true }).click();
  for (const theme of ["light", "dark"]) {
    await options
      .getByRole("button", { name: "Preferences", exact: true })
      .click();
    await options.getByLabel("Colour mode").selectOption(theme);
    await popup.waitForFunction(
      (theme) => document.querySelector("m3e-theme").scheme === theme,
      theme,
    );
    await popup.setViewportSize({ width: 320, height: 600 });
    assert(
      await popup.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await checkContrast(popup);
    await checkTargets(popup);
    await capture(popup, {
      path: `test-results/popup-${theme}-320.png`,
      fullPage: true,
    });
    await popup
      .getByRole("button", { name: "Choose regular font", exact: true })
      .click();
    await popup.getByRole("searchbox", { name: "Search fonts" }).fill("Lora");
    await popup.keyboard.press("Shift+Tab");
    await popup.keyboard.press("Shift+Tab");
    assert(
      await popup.evaluate(
        () => !!document.activeElement.closest('[role="dialog"]'),
      ),
    );
    await popup.keyboard.press("Escape");
  }
  await popup
    .getByRole("button", { name: "All settings ↗", exact: true })
    .click();
  await options
    .getByRole("button", { name: "Preferences", exact: true })
    .click();
  await options
    .getByRole("button", { name: "Reset settings", exact: true })
    .click();
  await options.getByText("Settings reset", { exact: true }).waitFor();
  await options
    .getByRole("button", { name: "Font library", exact: true })
    .click();
  await options.getByRole("button", { name: /^Remove outfit$/i }).click();
  await options
    .getByRole("heading", { name: "No uploaded fonts yet" })
    .waitFor();
  const failedOptions = await context.newPage();
  await failedOptions.addInitScript(() => {
    const original = fetch;
    let fail = true;
    globalThis.fetch = (...args) => {
      if (String(args[0]).endsWith("catalogue.json") && fail) {
        fail = false;
        return Promise.reject(new Error("Test library unavailable"));
      }
      return original(...args);
    };
  });
  await failedOptions.goto(`chrome-extension://${id}/options.html`);
  await failedOptions
    .getByRole("heading", { name: "Fontify could not open" })
    .waitFor();
  await failedOptions
    .getByRole("button", { name: "Try again", exact: true })
    .click();
  await failedOptions
    .getByRole("heading", { name: "Make yourself at font." })
    .waitFor();
  await options
    .getByRole("button", { name: "Typography", exact: true })
    .click();
  for (const [slot, family] of [
    ["regular", "Bungee"],
    ["bold", "Lora"],
    ["italic", "Roboto"],
  ]) {
    await options
      .getByRole("button", { name: `Choose ${slot} font`, exact: true })
      .click();
    await options.getByRole("searchbox", { name: "Search fonts" }).fill(family);
    await options
      .locator(".font-result .choose")
      .filter({
        has: options.locator("b", { hasText: new RegExp(`^${family}$`) }),
      })
      .click();
  }
  await options.waitForFunction(() => {
    const family = (selector) =>
      getComputedStyle(document.querySelector(selector)).fontFamily;
    return (
      family(".hero .muted").includes("Fontify_42_75_6e_67_65_65") &&
      family("h1").includes("Fontify_4c_6f_72_61") &&
      family("#sample-italic").includes("Fontify_52_6f_62_6f_74_6f") &&
      family('input[type="range"]').includes("Fontify_42_75_6e_67_65_65")
    );
  });
  await options
    .getByRole("button", { name: "Font library", exact: true })
    .click();
  await options.waitForFunction(() =>
    getComputedStyle(
      document.querySelector("m3e-button").shadowRoot.querySelector(".label"),
    ).fontFamily.includes("Fontify_42_75_6e_67_65_65"),
  );
  const symbols = await options
    .locator(".nav-icon .symbol")
    .evaluateAll(async (elements) =>
      Promise.all(
        elements.map(async (el) => {
          const url =
            getComputedStyle(el).maskImage.match(/url\("?([^"\)]+)/)[1];
          const response = await fetch(url);
          return response.ok && (await response.text()).startsWith("<svg");
        }),
      ),
    );
  assert.equal(symbols.length, 10);
  assert(symbols.every(Boolean), "Both icon states must load locally");
  await options
    .getByRole("button", { name: "Choose regular font", exact: true })
    .click();
  await options.getByRole("searchbox", { name: "Search fonts" }).fill("Outfit");
  await options
    .locator(".font-result .choose")
    .filter({ has: options.locator("b", { hasText: /^Outfit$/ }) })
    .click();
  await options.emulateMedia({ reducedMotion: "reduce" });
  await options
    .getByRole("button", { name: "Choose regular font", exact: true })
    .click();
  assert.equal(
    await options
      .locator(".picker")
      .evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  await options.keyboard.press("Escape");
  assert.equal(
    await options
      .locator(".nav-icon")
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration),
    "0s",
  );
  // Toolbar sizing is different from opening popup.html in an ordinary tab.
  await worker.evaluate(() => chrome.action.openPopup());
  const browserSession = await context.browser().newBrowserCDPSession();
  const { targetInfos } = await browserSession.send("Target.getTargets");
  const nativeTarget = targetInfos.find(
    (target) =>
      !target.attached && target.url === `chrome-extension://${id}/popup.html`,
  );
  assert(nativeTarget, "Native toolbar popup must open");
  const { sessionId } = await browserSession.send("Target.attachToTarget", {
    targetId: nativeTarget.targetId,
    flatten: false,
  });
  const resultPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Native popup metrics timed out")),
      10000,
    );
    const handler = (event) => {
      const message = JSON.parse(event.message);
      if (event.sessionId === sessionId && message.id === 1) {
        clearTimeout(timer);
        browserSession.off("Target.receivedMessageFromTarget", handler);
        resolve(message);
      }
    };
    browserSession.on("Target.receivedMessageFromTarget", handler);
  });
  await browserSession.send("Target.sendMessageToTarget", {
    sessionId,
    message: JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: {
        returnByValue: true,
        awaitPromise: true,
        expression: `new Promise((resolve) => {
        const check = () => {
          const settings = [...document.querySelectorAll('m3e-button')].find(el => el.textContent.includes('All settings'));
          if (!settings) return setTimeout(check, 50);
          resolve({ width: innerWidth, contentWidth: document.documentElement.clientWidth, body: document.body.getBoundingClientRect().width,
            height: innerHeight, toolbar: document.body.classList.contains('toolbar-popup'),
            settingsBottom: settings.getBoundingClientRect().bottom,
            overflow: document.documentElement.scrollWidth > innerWidth });
        }; check();
      })`,
      },
    }),
  });
  const native = (await resultPromise).result.result.value;
  assert.equal(native.contentWidth, 520);
  assert(native.width >= native.contentWidth);
  assert.equal(native.body, 520);
  assert(native.toolbar && !native.overflow);
  assert(
    native.settingsBottom <= native.height,
    "Quick settings must remain visible in the native popup",
  );
  await browserSession.send("Target.closeTarget", {
    targetId: nativeTarget.targetId,
  });
  await browserSession.detach();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: extension behaviour; uploads and restoration; overrides, exceptions and pause; backups and reset; picker search, filters and favourites; dialog keyboard focus; system theme toggle; startup recovery; light/dark contrast, target sizes and overflow at 1240/768/390/320px.",
  );
} finally {
  await context?.close();
  server.close();
  await rm(profile, { recursive: true, force: true });
}
