const fs = require("node:fs");
const path = require("node:path");
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
    if (current && current.context.browser()?.isConnected()) return current;

    const executablePath = findChrome();
    if (!executablePath) {
      throw new Error("Google Chrome is required. Install Chrome and try again.");
    }

    const context = await chromium.launchPersistentContext(this.store.getProfileDirectory(profileId), {
      executablePath,
      headless: false,
      viewport: null,
      locale: "en-US",
      args: ["--start-maximized"]
    });

    context.setDefaultTimeout(20_000);
    context.setDefaultNavigationTimeout(45_000);
    const page = context.pages()[0] || (await context.newPage());
    const handle = { context, page, profile };
    this.contexts.set(profileId, handle);

    context.on("close", () => {
      this.contexts.delete(profileId);
      this.onLog("info", `Chrome closed for ${profile.name}.`);
    });

    this.onLog("info", `Chrome opened for ${profile.name}.`);
    return handle;
  }

  async openLogin(profileId) {
    const handle = await this.open(profileId);
    await handle.page.bringToFront();
    await handle.page.goto("https://www.instagram.com/accounts/login/?hl=en", { waitUntil: "domcontentloaded" });
    return true;
  }

  async close(profileId) {
    const handle = this.contexts.get(profileId);
    if (!handle) return;
    await handle.context.close().catch(() => {});
    this.contexts.delete(profileId);
  }

  async closeAll() {
    const contexts = [...this.contexts.values()].map((handle) => handle.context.close().catch(() => {}));
    await Promise.all(contexts);
  }
}

module.exports = { ChromeManager, findChrome };
