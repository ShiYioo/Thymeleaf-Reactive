/**
 * Real-browser end-to-end HMR regression.
 *
 * Boots the counter example (Spring Boot + starter) with the real SSE HMR
 * channel, drives it with a local Chrome/Edge via puppeteer-core, edits the
 * SFC on disk, and asserts the browser hot-updates the component without a
 * page reload while preserving interactive state.
 *
 * Requirements:
 * - `./gradlew :examples:counter:bootJar` (run automatically when the jar is missing)
 * - a local Chrome or Edge executable (override with E2E_BROWSER)
 * - a Java 25 runtime for the example app (auto-discovered from ~/.jdks, override with E2E_JAVA)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, platform } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exampleDir = path.join(repoRoot, "examples", "counter");
const jarPath = path.join(exampleDir, "build", "libs", "counter-0.1.0-SNAPSHOT.jar");
const sfcPath = path.join(exampleDir, "src", "main", "resources", "templates", "components", "Counter.vue");
const port = Number(process.env.E2E_PORT ?? 18080);
const baseUrl = `http://localhost:${port}`;

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
    const candidates = require("node:fs").readdirSync(jdksDir)
      .filter(dir => existsSync(path.join(jdksDir, dir, java)))
      .sort((left, right) => versionOf(right) - versionOf(left));
    if (candidates.length) return path.join(jdksDir, candidates[0], java);
  }
  return exe("java");
}

function spawnDetached(command, args, options = {}) {
  const child = spawn(command, args, { stdio: "ignore", ...options });
  child.on("error", error => console.error(`[e2e] failed to start ${command}:`, error.message));
  return child;
}

function stopTree(child) {
  if (!child || child.exitCode !== null) return;
  if (isWindows) {
    try { spawnDetached("taskkill", ["/pid", String(child.pid), "/T", "/F"]); } catch { /* best effort */ }
  } else {
    try { child.kill("SIGTERM"); } catch { /* best effort */ }
  }
}

async function waitForServer(timeoutMillis = 120_000) {
  const deadline = Date.now() + timeoutMillis;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch { /* not up yet */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`example server did not come up at ${baseUrl}`);
}

test("browser hot-swaps an edited SFC over SSE without a page reload", { timeout: 300_000 }, async t => {
  const browserPath = findBrowser();
  assert.ok(browserPath, "no Chrome/Edge found; set E2E_BROWSER to the browser executable");
  if (!existsSync(jarPath)) {
    console.log("[e2e] building example jar via gradlew :examples:counter:bootJar ...");
    await new Promise((resolve, reject) => {
      const gradle = spawn(isWindows ? "gradlew.bat" : "./gradlew",
        [":examples:counter:bootJar"], { cwd: repoRoot, shell: isWindows, stdio: "inherit" });
      gradle.on("exit", code => (code === 0 ? resolve() : reject(new Error(`gradle exited with ${code}`))));
      gradle.on("error", reject);
    });
  }

  let serverLog = "";
  const server = spawn(findJava(), ["-jar", jarPath, `--server.port=${port}`], {
    cwd: exampleDir,
    stdio: ["ignore", "pipe", "pipe"]
  });
  server.stdout.on("data", chunk => { serverLog = `${serverLog}${chunk}`.slice(-2000); });
  server.stderr.on("data", chunk => { serverLog = `${serverLog}${chunk}`.slice(-2000); });
  server.on("error", error => console.error("[e2e] failed to start the example server:", error.message));
  t.after(() => stopTree(server));
  try {
    await waitForServer();
  } catch (error) {
    console.error(`[e2e] server log tail:\n${serverLog}`);
    throw error;
  }

  const originalSfc = readFileSync(sfcPath, "utf8");
  t.after(() => writeFileSync(sfcPath, originalSfc));

  const browser = await puppeteer.launch({
    executablePath: browserPath,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"]
  });
  t.after(() => browser.close());

  const page = await browser.newPage();
  page.on("pageerror", error => console.error("[e2e] page error:", error.message));
  page.on("console", message => {
    if (message.type() === "error") console.error("[e2e] console error:", message.text());
  });

  await page.goto(baseUrl, { waitUntil: "networkidle2" });
  // Adoption re-renders the root with the SFC template, which drops the
  // server-rendered data-tr-* binding attributes. Its presence means the
  // browser is running the SFC through the VDOM, ready for HMR.
  await page.waitForFunction(() => window.ThymeleafReactive && document.querySelector("main p") && !document.querySelector("main [data-tr-text]"), { polling: 200, timeout: 20_000 });
  await page.evaluate(() => { window.__e2eNoReload = true; });

  // The rendered page must be interactive through the reactive state.
  const countText = () => page.evaluate(() => document.querySelector("main p")?.textContent?.trim());
  assert.equal(await countText(), "0");
  await page.click("main button");
  await page.waitForFunction(() => document.querySelector("main p")?.textContent?.trim() === "1", { polling: 100, timeout: 5_000 });

  // Edit the SFC on disk and let the real SSE channel hot-swap it.
  const hotTemplate = originalSfc.replace("<p>{{ count }}</p>", '<p class="e2e-hot">{{ count }} hot</p>');
  assert.notEqual(hotTemplate, originalSfc, "expected to modify the counter SFC paragraph");
  writeFileSync(sfcPath, hotTemplate);

  await page.waitForFunction(() => Boolean(document.querySelector("main .e2e-hot")), { polling: 200, timeout: 20_000 });

  // The swap happened in place: no navigation, state preserved, still interactive.
  assert.equal(await page.evaluate(() => window.__e2eNoReload), true);
  assert.match(await countText(), /^1 hot$/);
  await page.click("main button");
  await page.waitForFunction(() => document.querySelector("main .e2e-hot")?.textContent?.trim() === "2 hot", { polling: 100, timeout: 5_000 });

  writeFileSync(sfcPath, originalSfc);
  await page.waitForFunction(() => !document.querySelector("main .e2e-hot"), { polling: 200, timeout: 20_000 });
  assert.equal(await page.evaluate(() => window.__e2eNoReload), true);
  assert.match(await countText(), /^2$/);
});
