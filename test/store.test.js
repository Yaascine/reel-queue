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

  const profile = await store.createProfile("instagram", "Main account");
  const profiles = await store.listProfiles();
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].name, "Main account");
  assert.equal((await fs.stat(store.getProfileDirectory(profile.id))).isDirectory(), true);

  const saved = await store.saveSettings({
    profileId: profile.id,
    videoFolder: "/videos",
    thumbnailPath: "/cover.jpg",
    caption: "Hello",
    intervalMinutes: 3
  });
  assert.deepEqual(await store.getSettings(), saved);
});

test("rejects duplicate account profile names", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "reel-queue-store-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new AppStore(root);
  await store.initialize();
  await store.createProfile("instagram", "Main");
  await assert.rejects(() => store.createProfile("instagram", "main"), /already exists/i);
  await store.createProfile("youtube", "Main");
});

test("migrates legacy settings into the first queue and persists independent queues", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "reel-queue-store-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const legacy = {
    profileId: "profile-legacy",
    videoFolder: "/legacy-videos",
    thumbnailPath: "/legacy-cover.jpg",
    caption: "Legacy caption",
    intervalMinutes: 9
  };
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, "settings.json"), JSON.stringify(legacy));

  const store = new AppStore(root);
  await store.initialize();
  const [first] = await store.listWorkspaces();
  assert.equal(first.name, "Queue 1");
  assert.deepEqual(first.settings, legacy);

  const second = await store.createWorkspace("instagram", "MMA clips");
  await store.saveWorkspaceSettings(second.id, { ...legacy, videoFolder: "/mma", caption: "MMA" });
  const workspaces = await store.listWorkspaces();
  assert.equal(workspaces.length, 4);
  assert.equal(workspaces[0].settings.videoFolder, "/legacy-videos");
  const mma = workspaces.find((workspace) => workspace.id === second.id);
  assert.equal(mma.settings.videoFolder, "/mma");
  assert.equal(mma.settings.caption, "MMA");
  assert.deepEqual(new Set(workspaces.map((workspace) => workspace.platform)), new Set(["instagram", "youtube", "tiktok"]));
});
