const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { ChromeManager, findChrome } = require("../src/chrome");

test("keeps separate Chrome cookies for every account on every platform", { skip: !findChrome() }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "reel-queue-chrome-isolation-"));
  const profiles = new Map();
  for (const platform of ["instagram", "youtube", "tiktok"]) {
    for (const suffix of ["a", "b"]) {
      const id = `${platform}-${suffix}`;
      profiles.set(id, { id, name: id, platform });
      await fs.mkdir(path.join(root, id));
    }
  }

  const store = {
    getProfile: async (id) => profiles.get(id) || null,
    getProfileDirectory: (id) => path.join(root, id)
  };
  const chrome = new ChromeManager(store, () => {});
  t.after(async () => {
    await chrome.closeAll();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const domains = {
    instagram: "https://www.instagram.com",
    youtube: "https://www.youtube.com",
    tiktok: "https://www.tiktok.com"
  };

  for (const platform of Object.keys(domains)) {
    const first = await chrome.open(`${platform}-a`);
    const second = await chrome.open(`${platform}-b`);
    await first.context.addCookies([{ name: "isolation_test", value: `${platform}-a`, url: domains[platform] }]);
    const firstCookies = await first.context.cookies(domains[platform]);
    const secondCookies = await second.context.cookies(domains[platform]);
    assert.equal(firstCookies.find((cookie) => cookie.name === "isolation_test")?.value, `${platform}-a`);
    assert.equal(secondCookies.some((cookie) => cookie.name === "isolation_test"), false);
    assert.notEqual(first.chromeProcess.pid, second.chromeProcess.pid);
    await chrome.close(`${platform}-a`);
    await chrome.close(`${platform}-b`);
  }
});
