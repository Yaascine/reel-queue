const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { AppStore } = require("../src/store");

test("persists settings and separate account profiles", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "reel-queue-store-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new AppStore(root);
  await store.initialize();

  const profile = await store.createProfile("Main account");
  const profiles = await store.listProfiles();
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].name, "Main account");
  assert.equal((await fs.stat(store.getProfileDirectory(profile.id))).isDirectory(), true);

  const saved = await store.saveSettings({
    profileId: profile.id,
    videoFolder: "/videos",
    thumbnailPath: "/cover.jpg",
    caption: "Hello",
    intervalMinutes: 3,
    trashAfterPosting: true
  });
  assert.deepEqual(await store.getSettings(), saved);
});

test("rejects duplicate account profile names", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "reel-queue-store-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new AppStore(root);
  await store.initialize();
  await store.createProfile("Main");
  await assert.rejects(() => store.createProfile("main"), /already exists/i);
});
