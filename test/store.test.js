const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { AppStore } = require("../src/store");
const { normalizeSettings } = require("../src/shared");

test("persists settings and separate account profiles", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "reel-queue-store-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new AppStore(root);
  await store.initialize();

  const profile = await store.createProfile("instagram", "Main account");
  const profiles = await store.listProfiles();
  assert.equal(profiles.some((candidate) => candidate.id === profile.id && candidate.name === "Main account"), true);
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
  assert.deepEqual({ ...first.settings, profileId: legacy.profileId }, normalizeSettings(legacy));
  assert.notEqual(first.settings.profileId, "profile-legacy");

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

test("creates every new platform queue with a fresh isolated account profile", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "reel-queue-store-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new AppStore(root);
  await store.initialize();

  const created = [];
  for (const platform of ["instagram", "youtube", "tiktok"]) {
    created.push(await store.createWorkspaceWithProfile(platform, `${platform} niche`));
  }

  assert.equal(new Set(created.map(({ profile }) => profile.id)).size, 3);
  for (const { workspace, profile } of created) {
    assert.equal(workspace.platform, profile.platform);
    assert.equal(workspace.settings.profileId, profile.id);
    assert.deepEqual(await fs.readdir(store.getProfileDirectory(profile.id)), []);
  }
});

test("migrates empty and shared legacy queue sessions to unique profiles", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "reel-queue-store-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(root, { recursive: true });
  const sharedId = "11111111-1111-4111-8111-111111111111";
  await fs.writeFile(path.join(root, "profiles.json"), JSON.stringify([{ id: sharedId, name: "Shared", platform: "instagram", createdAt: new Date(0).toISOString() }]));
  await fs.writeFile(path.join(root, "workspaces.json"), JSON.stringify([
    { id: "one", name: "One", platform: "instagram", createdAt: new Date(0).toISOString(), settings: { profileId: sharedId } },
    { id: "two", name: "Two", platform: "instagram", createdAt: new Date(1).toISOString(), settings: { profileId: sharedId } }
  ]));
  const store = new AppStore(root);
  await store.initialize();
  const instagram = (await store.listWorkspaces()).filter((workspace) => workspace.platform === "instagram");
  assert.equal(new Set(instagram.map((workspace) => workspace.settings.profileId)).size, instagram.length);
  for (const workspace of await store.listWorkspaces()) {
    const profile = await store.getProfile(workspace.settings.profileId);
    assert.equal(profile.platform, workspace.platform);
    assert.equal((await fs.stat(store.getProfileDirectory(profile.id))).isDirectory(), true);
  }
});
