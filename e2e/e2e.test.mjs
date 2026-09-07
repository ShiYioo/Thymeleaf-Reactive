/**
 * Real-browser end-to-end HMR regression.
 *
 * Boots the counter example (Spring Boot + starter) with the real SSE HMR
 * channel and drives it with a local Chrome/Edge via puppeteer-core.
 *
 * Covered HMR scenarios:
 * 1. SFC template edits hot-swap the mounted component without a reload
 *    while preserving interactive state (counter).
 * 2. KeepAlive/Transition subtrees: cached branches survive toggles and
 *    template-only HMR; a script edit rebuilds the component and resets
 *    its setup state (tabs).
 *
 * Requirements:
 * - `./gradlew :examples:counter:bootJar` (run automatically when the jar is missing)
 * - a local Chrome or Edge executable (override with E2E_BROWSER)
 * - a Java 25 runtime for the example app (auto-discovered from ~/.jdks, override with E2E_JAVA)
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, openSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { homedir, platform } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exampleDir = path.join(repoRoot, "examples", "counter");
const templatesDir = path.join(exampleDir, "src", "main", "resources", "templates");
const version = (() => {
  try { return JSON.parse(readFileSync(path.join(repoRoot, "thymeleaf-reactive-runtime", "package.json"), "utf8")).version; }
  catch { return "0.1.0"; }
})();
// Gradle and npm versions are finalized together; find the boot jar whatever suffix it carries.
function findJar() {
  const libsDir = path.join(exampleDir, "build", "libs");
  if (!existsSync(libsDir)) return undefined;
  const jars = readdirSync(libsDir).filter(name => /^counter-\d+\.\d+\.\d+(?:-.*)?\.jar$/.test(name) && !name.endsWith("-plain.jar"));
  return jars.length ? path.join(libsDir, jars.sort().at(-1)) : undefined;
}
const jarPath = findJar() ?? path.join(exampleDir, "build", "libs", `counter-${version}.jar`);
const counterSfcPath = path.join(templatesDir, "components", "Counter.vue");
const tabsSfcPath = path.join(templatesDir, "components", "Tabs.vue");
let port = Number(process.env.E2E_PORT ?? 0);
let baseUrl = `http://localhost:${port}`;

const findFreePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1", () => {
    const address = probe.address();
    probe.close(() => resolve(address.port));
  });
  probe.on("error", reject);
});

const isWindows = platform() === "win32";
const exe = name => (isWindows ? `${name}.exe` : name);

function findBrowser() {
  if (process.env.E2E_BROWSER) return process.env.E2E_BROWSER;
  const candidates = isWindows
    ? [
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
        "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
        "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
        "C:/Program Files/Microsoft/Edge/Application/msedge.exe"
      ]
    : [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium",
        "/usr/bin/google-chrome"
      ];
  return candidates.find(candidate => existsSync(candidate));
}

function findJava() {
  if (process.env.E2E_JAVA) return process.env.E2E_JAVA;
  const jdksDir = path.join(homedir(), ".jdks");
  if (existsSync(jdksDir)) {
    const java = path.join("bin", exe("java"));
    const versionOf = name => Number(name.match(/(\d+)/)?.[1] ?? 0);
    const candidates = readdirSync(jdksDir)
      .filter(dir => existsSync(path.join(jdksDir, dir, java)))
      .sort((left, right) => versionOf(right) - versionOf(left));
    if (candidates.length) return path.join(jdksDir, candidates[0], java);
  }
  return exe("java");
}

function stopTree(child) {
  console.error(`[e2e] stopTree called for pid=${child?.pid} at ${new Date().toISOString()}`);
  if (!child || child.exitCode !== null) return;
  if (isWindows) {
    try { spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* best effort */ }
  } else {
    try { child.kill("SIGTERM"); } catch { /* best effort */ }
  }
}

let server;
after(() => stopTree(server));

before(async () => {
  console.error(`[e2e] before() start ${new Date().toISOString()}`);
  assert.ok(findBrowser(), "no Chrome/Edge found; set E2E_BROWSER to the browser executable");
  if (!existsSync(jarPath)) {
    console.log("[e2e] building example jar via gradlew :examples:counter:bootJar ...");
    await new Promise((resolve, reject) => {
      const gradle = spawn(isWindows ? "gradlew.bat" : "./gradlew",
        [":examples:counter:bootJar"], { cwd: repoRoot, shell: isWindows, stdio: "inherit" });
      gradle.on("exit", code => (code === 0 ? resolve() : reject(new Error(`gradle exited with ${code}`))));
      gradle.on("error", reject);
    });
  }
  if (!port) {
    port = await findFreePort();
    baseUrl = `http://localhost:${port}`;
  }
  const serverLogFile = openSync(path.join(repoRoot, "e2e", "server.log"), "w");
  server = spawn(`${findJava()} -jar "${jarPath}" --server.port=${port}`, [], {
    cwd: exampleDir,
    shell: true,
    stdio: ["ignore", serverLogFile, serverLogFile]
  });
  server.on("error", error => console.error("[e2e] failed to start the example server:", error.message));
  server.on("exit", (code, signal) => console.error(`[e2e] example server exited at ${new Date().toISOString()} code=${code} signal=${signal}`));
  console.error(`[e2e] server spawned pid=${server.pid} at ${new Date().toISOString()}`);
  console.error(`[e2e] java=${findJava()}`);
  console.error(`[e2e] jar=${jarPath} exists=${existsSync(jarPath)}`);
  await new Promise((resolve, reject) => {
    const onExit = code => {
      clearTimeout(deadline);
      const tail = readFileSync(path.join(repoRoot, "e2e", "server.log"), "utf8").slice(-1500);
      reject(new Error(`example server exited early with ${code}:
${tail}`));
    };
    const deadline = setTimeout(() => {
      server.off("exit", onExit);
      reject(new Error("example server did not come up in 120s"));
    }, 120_000);
    server.on("exit", onExit);
    const poll = setInterval(async () => {
      try {
        const response = await fetch(baseUrl);
        if (response.ok) {
          clearTimeout(deadline);
          server.off("exit", onExit);
          clearInterval(poll);
          resolve();
        }
      } catch { /* not up yet */ }
    }, 400);
  });
});

async function openPage(browser, urlPath) {
  const page = await browser.newPage();
  page.on("pageerror", error => console.error("[e2e] page error:", error.message));
  page.on("console", message => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      console.error("[e2e] console error:", message.text());
    }
  });
  await page.goto(`${baseUrl}${urlPath}`, { waitUntil: "networkidle2" });
  const rawWaitForFunction = page.waitForFunction.bind(page);
  page.waitForFunction = (fn, options, ...args) => rawWaitForFunction(fn, options, ...args).catch(error => {
    console.error(`[e2e] wait failed after ${options?.timeout}ms: ${String(fn).slice(0, 140)}`);
    throw error;
  });
  await new Promise(resolve => setTimeout(resolve, 3000));
  if (process.env.E2E_DEBUG) {
    console.error(`[e2e] page ${urlPath}:`, await page.evaluate(() => JSON.stringify({
      url: location.href, api: Boolean(window.ThymeleafReactive),
      tabs: Boolean(document.querySelector(".tabs")), main: Boolean(document.querySelector("main")),
      trText: Boolean(document.querySelector("[data-tr-text]")),
      body: document.body.innerHTML.slice(0, 250)
    })));
  }
  return page;
}

const waitFor = (page, fn, timeoutMillis = 20_000) =>
  page.waitForFunction(fn, { polling: 200, timeout: timeoutMillis });

test("browser hot-swaps an edited SFC over SSE without a page reload", { timeout: 300_000 }, async t => {
  const browser = await puppeteer.launch({
    executablePath: findBrowser(),
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"]
  });
  t.after(() => browser.close());

  const page = await openPage(browser, "/");
  // Adoption re-renders the root with the SFC template, which drops the
  // server-rendered data-tr-* binding attributes. Its presence means the
  // browser is running the SFC through the VDOM, ready for HMR.
  await waitFor(page, () => window.ThymeleafReactive && document.querySelector("main p") && !document.querySelector("main [data-tr-text]"));
  await page.evaluate(() => { window.__e2eNoReload = true; });

  const countText = () => page.evaluate(() => document.querySelector("main p")?.textContent?.trim());
  assert.equal(await countText(), "0");
  await page.click("main button");
  await waitFor(page, () => document.querySelector("main p")?.textContent?.trim() === "1", 5_000);

  const originalSfc = readFileSync(counterSfcPath, "utf8");
  t.after(() => writeFileSync(counterSfcPath, originalSfc));
  const hotTemplate = originalSfc.replace("<p>{{ count }}</p>", '<p class="e2e-hot">{{ count }} hot</p>');
  assert.notEqual(hotTemplate, originalSfc, "expected to modify the counter SFC paragraph");
  writeFileSync(counterSfcPath, hotTemplate);

  await waitFor(page, () => Boolean(document.querySelector("main .e2e-hot")));

  assert.equal(await page.evaluate(() => window.__e2eNoReload), true);
  assert.match(await countText(), /^1 hot$/);
  await page.click("main button");
  await waitFor(page, () => document.querySelector("main .e2e-hot")?.textContent?.trim() === "2 hot", 5_000);

  writeFileSync(counterSfcPath, originalSfc);
  await waitFor(page, () => !document.querySelector("main .e2e-hot"));
  assert.equal(await page.evaluate(() => window.__e2eNoReload), true);
  assert.match(await countText(), /^2$/);
});

test("KeepAlive and Transition subtrees survive template HMR; script edits rebuild", { timeout: 300_000 }, async t => {
  const browser = await puppeteer.launch({
    executablePath: findBrowser(),
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"]
  });
  t.after(() => browser.close());

  const page = await openPage(browser, "/tabs");
  // Adoption re-renders the server root with the SFC template (which drops
  // the data-tr-* binding attributes), so its presence means the component
  // is running through the VDOM, ready for HMR.
  await waitFor(page, () => window.ThymeleafReactive && document.querySelector(".tabs") && !document.querySelector("[data-tr-text]")).catch(async error => {
    console.error("[e2e] tabs diagnostics:", await page.evaluate(() => JSON.stringify({
      api: Boolean(window.ThymeleafReactive), tabs: Boolean(document.querySelector(".tabs")),
      trText: Boolean(document.querySelector("[data-tr-text]")), url: location.href,
      body: document.body.innerHTML.slice(0, 200)
    })));
    throw error;
  });
  await page.evaluate(() => { window.__e2eNoReload = true; });

  // Transition appear (object form): the enter hooks run on the initial
  // mount and override the props-level hook of the same name.
  await waitFor(page, () => Array.isArray(window.__appearEvents) && window.__appearEvents.includes("appear-after"));
  const appearEvents = await page.evaluate(() => window.__appearEvents);
  assert.deepEqual(appearEvents, ["appear-before", "appear-after"]);
  assert.equal(await page.evaluate(() => document.querySelector(".tabs-version")?.textContent), "v1");

  // KeepAlive: type into branch A, switch to B, switch back — the cached
  // subtree restores the typed value.
  await page.type("input[aria-label='kept-input']", "kept-value");
  await page.click(".to-b");
  await waitFor(page, () => document.querySelector(".tabs p")?.textContent === "Branch B", 5_000);
  await page.click(".to-a");
  await waitFor(page, () => Boolean(document.querySelector("input[aria-label='kept-input']")), 5_000);
  assert.equal(await page.evaluate(() => document.querySelector("input").value), "kept-value");

  // Transition out-in: switching to B shows the B view once the swap lands.
  await page.click(".to-b");
  await waitFor(page, () => document.querySelector("strong")?.textContent === "B view", 5_000);

  // Template-only HMR: the swap is in place, script state (active tab and
  // version) survives, and the KeepAlive cache keeps the typed value.
  const originalTabs = readFileSync(tabsSfcPath, "utf8");
  t.after(() => writeFileSync(tabsSfcPath, originalTabs));
  const templateHot = originalTabs.replace('<div class="tabs">', '<div class="tabs e2e-tabs-hot">');
  assert.notEqual(templateHot, originalTabs, "expected to modify the tabs SFC template");
  writeFileSync(tabsSfcPath, templateHot);
  await waitFor(page, () => Boolean(document.querySelector(".e2e-tabs-hot")));

  assert.equal(await page.evaluate(() => window.__e2eNoReload), true);
  assert.equal(await page.evaluate(() => document.querySelector(".tabs-version")?.textContent), "v1");
  assert.equal(await page.evaluate(() => document.querySelector("strong")?.textContent), "B view");
  await page.click(".to-a");
  await waitFor(page, () => Boolean(document.querySelector("input[aria-label='kept-input']")), 5_000);
  assert.equal(await page.evaluate(() => document.querySelector("input").value), "kept-value");

  // Script HMR: the setup re-runs, resetting the state to its new defaults.
  const scriptHot = originalTabs.replace("const version = ref('v1');", "const version = ref('v2');");
  assert.notEqual(scriptHot, originalTabs, "expected to modify the tabs SFC script");
  writeFileSync(tabsSfcPath, scriptHot);
  await waitFor(page, () => document.querySelector(".tabs-version")?.textContent === "v2");

  assert.equal(await page.evaluate(() => window.__e2eNoReload), true);
  assert.ok(await page.evaluate(() => Boolean(document.querySelector("input"))), "rebuilt component starts on branch A");
  // The KeepAlive cache survives the rebuild (patch transfers it), so the
  // cached input comes back with its typed value intact.
  assert.equal(await page.evaluate(() => document.querySelector("input").value), "kept-value");

  writeFileSync(tabsSfcPath, originalTabs);
  await waitFor(page, () => document.querySelector(".tabs-version")?.textContent === "v1");
});
