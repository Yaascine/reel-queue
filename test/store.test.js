const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { AppStore, replaceFileWithRetry, summarizeUploadAllowance } = require("../src/store");
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

test("retries Windows-style EPERM errors while replacing JSON files", async () => {
  let attempts = 0;
  const fileSystem = {
    async rename() {
      attempts += 1;
      if (attempts < 3) throw Object.assign(new Error("temporarily locked"), { code: "EPERM" });
    },
    async copyFile() {},
    async rm() {}
  };
  await replaceFileWithRetry(fileSystem, "history.unique.tmp", "history.json", 5);
  assert.equal(attempts, 3);
});

test("uses collision-safe temporary names for concurrent JSON writes", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "reel-queue-store-write-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new AppStore(root);
  const target = path.join(root, "history.json");
  await Promise.all(Array.from({ length: 12 }, (_entry, index) => store.writeJson(target, [{ index }])));
  const result = JSON.parse(await fs.readFile(target, "utf8"));
  assert.equal(Number.isInteger(result[0].index), true);
  assert.deepEqual((await fs.readdir(root)).filter((name) => name.endsWith(".tmp")), []);
});

test("starts a 24-hour cooldown from an account's newest upload after upload 22", () => {
  const now = Date.parse("2026-08-15T12:00:00.000Z");
  const recentUploads = Array.from({ length: 22 }, (_entry, index) => ({
    id: `submitted-${index}`,
    workspaceId: "queue-1",
    profileId: "account-1",
    filePath: `/videos/${index}.mp4`,
    status: "submitted",
    createdAt: new Date(now - (23 * 60 * 60 * 1000) + (index * 1000)).toISOString()
  }));
  const duplicatePostedEntries = recentUploads.map((entry, index) => ({
    ...entry,
    id: `posted-${index}`,
    status: "posted",
    createdAt: new Date(Date.parse(entry.createdAt) + 500).toISOString()
  }));
  const ignored = [
    { ...recentUploads[0], id: "other-account", profileId: "account-2", filePath: "/other.mp4" },
    { ...recentUploads[0], id: "expired", filePath: "/old.mp4", createdAt: new Date(now - (25 * 60 * 60 * 1000)).toISOString() }
  ];

  const blocked = summarizeUploadAllowance([...recentUploads, ...duplicatePostedEntries, ...ignored], "account-1", now);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.count, 22);
  assert.equal(blocked.limit, 22);
  assert.equal(blocked.nextAllowedAt, Date.parse(recentUploads[21].createdAt) + (24 * 60 * 60 * 1000));

  const afterCooldown = summarizeUploadAllowance(
    [...recentUploads, ...duplicatePostedEntries, ...ignored],
    "account-1",
    blocked.nextAllowedAt
  );
  assert.equal(afterCooldown.allowed, true);
  assert.equal(afterCooldown.count, 0);
  assert.equal(summarizeUploadAllowance(recentUploads, "account-2", now).count, 0);

  const excess = summarizeUploadAllowance([
    ...recentUploads,
    { ...recentUploads[21], id: "extra", filePath: "/videos/extra.mp4", createdAt: new Date(now - 500).toISOString() }
  ], "account-1", now);
  assert.equal(excess.count, 23);
  assert.equal(excess.nextAllowedAt, now - 500 + (24 * 60 * 60 * 1000));
});

test("supports a custom upload cap, disabling the cap, and a manual account reset", () => {
  const now = Date.parse("2026-08-20T12:00:00.000Z");
  const uploads = Array.from({ length: 18 }, (_entry, index) => ({
    id: `upload-${index}`,
    workspaceId: "queue-1",
    profileId: "account-1",
    filePath: `/videos/${index}.mp4`,
    status: "submitted",
    createdAt: new Date(now - 10_000 + index).toISOString()
  }));

  const custom = summarizeUploadAllowance(uploads, "account-1", now, { enabled: true, limit: 18 });
  assert.equal(custom.allowed, false);
  assert.equal(custom.count, 18);
  assert.equal(custom.limit, 18);

  const disabled = summarizeUploadAllowance(uploads, "account-1", now, { enabled: false, limit: 18 });
  assert.equal(disabled.allowed, true);
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.count, 18);

  const resetHistory = [
    { id: "new-upload", workspaceId: "queue-1", profileId: "account-1", filePath: "/videos/new.mp4", status: "posted", createdAt: new Date(now - 500).toISOString() },
    { id: "reset", workspaceId: "queue-1", profileId: "account-1", status: "limit_reset", createdAt: new Date(now - 1_000).toISOString() },
    ...uploads
  ];
  const reset = summarizeUploadAllowance(resetHistory, "account-1", now, { enabled: true, limit: 18 });
  assert.equal(reset.allowed, true);
  assert.equal(reset.count, 1);
  assert.equal(reset.limit, 18);
});

test("persists a manual upload-counter reset for only the selected account", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "reel-queue-reset-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new AppStore(root);
  await store.initialize();
  await store.addHistory({ status: "submitted", profileId: "account-1", workspaceId: "queue-1", filePath: "/one.mp4" });
  await store.addHistory({ status: "submitted", profileId: "account-2", workspaceId: "queue-2", filePath: "/two.mp4" });
  await store.resetUploadAllowance("account-1", { workspaceId: "queue-1", platform: "instagram" });

  assert.equal((await store.getUploadAllowance("account-1", Date.now(), { limit: 1 })).count, 0);
  assert.equal((await store.getUploadAllowance("account-2", Date.now(), { limit: 1 })).count, 1);
  assert.equal((await store.getHistory()).some((entry) => entry.status === "limit_reset" && entry.workspaceId === "queue-1"), true);
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
