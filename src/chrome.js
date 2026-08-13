const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright-core");

function chromeCandidates() {
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      path.join(process.env.HOME || "", "Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    ];
  }

  if (process.platform === "win32") {
    return [
      path.join(process.env.PROGRAMFILES || "", "Google/Chrome/Application/chrome.exe"),
      path.join(process.env["PROGRAMFILES(X86)"] || "", "Google/Chrome/Application/chrome.exe"),
      path.join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe")
    ];
  }

  return ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/snap/bin/chromium"];
}

function findChrome() {
  return chromeCandidates().find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForDebugging(port, child, timeout = 20_000) {
  const endpoint = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Chrome closed before its automation connection was ready.");
    try {
      const response = await fetch(`${endpoint}/json/version`);
      if (response.ok) return endpoint;
    } catch {
      // Chrome is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Chrome opened but its local automation connection did not become ready.");
}

class ChromeManager {
  constructor(store, onLog) {
    this.store = store;
    this.onLog = onLog;
    this.contexts = new Map();
  }

  async open(profileId) {
    const profile = await this.store.getProfile(profileId);
    if (!profile) throw new Error("Choose a valid account profile.");

    const current = this.contexts.get(profileId);
    if (current && current.browser.isConnected()) return current;

    const executablePath = findChrome();
    if (!executablePath) {
      throw new Error("Google Chrome is required. Install Chrome and try again.");
    }

    const port = await freePort();
    const chromeProcess = spawn(executablePath, [
      `--user-data-dir=${this.store.getProfileDirectory(profileId)}`,
      `--remote-debugging-port=${port}`,
      "--remote-debugging-address=127.0.0.1",
      "--no-first-run",
      "--no-default-browser-check",
      "--start-maximized",
      "about:blank"
    ], { stdio: "ignore" });
    const endpoint = await waitForDebugging(port, chromeProcess).catch((error) => {
      chromeProcess.kill();
      throw error;
    });
    const browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];
    if (!context) throw new Error("Chrome opened without an available browser session.");

    context.setDefaultTimeout(20_000);
    context.setDefaultNavigationTimeout(45_000);
    const page = context.pages()[0] || (await context.newPage());
    const handle = { browser, context, page, profile, chromeProcess };
    this.contexts.set(profileId, handle);

    browser.on("disconnected", () => {
      this.contexts.delete(profileId);
      this.onLog("info", `Chrome closed for ${profile.name}.`);
    });

    this.onLog("info", `Chrome opened for ${profile.name}.`);
    return handle;
  }

  async openLogin(profileId, platform = "instagram") {
    const handle = await this.open(profileId);
    await handle.page.bringToFront();
    const loginUrls = {
      instagram: "https://www.instagram.com/accounts/login/?hl=en",
      youtube: "https://studio.youtube.com/",
      tiktok: "https://www.tiktok.com/tiktokstudio/upload?lang=en"
    };
    await handle.page.goto(loginUrls[platform] || loginUrls.instagram, { waitUntil: "commit", timeout: 60_000 });
    await handle.page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => {});
    return true;
  }

  async close(profileId) {
    const handle = this.contexts.get(profileId);
    if (!handle) return;
    await handle.browser.close().catch(() => {});
    if (handle.chromeProcess.exitCode === null) handle.chromeProcess.kill();
    this.contexts.delete(profileId);
  }

  async closeAll() {
    const contexts = [...this.contexts.values()].map(async (handle) => {
      await handle.browser.close().catch(() => {});
      if (handle.chromeProcess.exitCode === null) handle.chromeProcess.kill();
    });
    await Promise.all(contexts);
  }
}

module.exports = { ChromeManager, findChrome };
