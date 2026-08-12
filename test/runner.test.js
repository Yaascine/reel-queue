const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { AutomationRunner } = require("../src/runner");
const { ConfirmationError } = require("../src/instagram");

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "reel-queue-test-"));
  const videoPath = path.join(root, "video1.mp4");
  const thumbnailPath = path.join(root, "cover.jpg");
  await fs.writeFile(videoPath, "video");
  await fs.writeFile(thumbnailPath, "image");

  const history = [];
  const logs = [];
  const store = {
    screenshotRoot: root,
    getProfile: async (id) => (id === "profile-1" ? { id, name: "Test" } : null),
    saveSettings: async (settings) => settings,
    hasSuccessfulPost: async (profileId, filePath) =>
      history.some((entry) => entry.profileId === profileId && entry.filePath === filePath),
    addHistory: async (entry) => history.push(entry),
    appendLog: async (level, message, details) => {
      const entry = { at: new Date().toISOString(), level, message, ...details };
      logs.push(entry);
      return entry;
    }
  };

  return {
    root,
    videoPath,
    thumbnailPath,
    history,
    logs,
    store,
    settings: {
      profileId: "profile-1",
      videoFolder: root,
      thumbnailPath,
      caption: "Caption",
      intervalMinutes: 1,
      trashAfterPosting: true
    }
  };
}

async function waitUntilStopped(runner) {
  const deadline = Date.now() + 2000;
  while (runner.running && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(runner.running, false, "runner should stop within the test timeout");
}

test("does not trash or record a video without positive confirmation", async (t) => {
  const data = await fixture();
  t.after(() => fs.rm(data.root, { recursive: true, force: true }));
  let trashCalls = 0;
  const runner = new AutomationRunner({
    store: data.store,
    chrome: { open: async () => ({ page: {} }) },
    trashItem: async () => { trashCalls += 1; },
    emit: () => {},
    publisher: async () => { throw new ConfirmationError("No confirmation"); }
  });

  await runner.start(data.settings);
  await waitUntilStopped(runner);

  assert.equal(trashCalls, 0);
  assert.equal(data.history.length, 0);
  assert.equal(runner.getStatus().mode, "error");
});

test("records success before moving a posted video to Trash", async (t) => {
  const data = await fixture();
  t.after(() => fs.rm(data.root, { recursive: true, force: true }));
  const events = [];
  const runner = new AutomationRunner({
    store: data.store,
    chrome: { open: async () => ({ page: {} }) },
    trashItem: async (filePath) => events.push(["trash", filePath]),
    emit: () => {},
    publisher: async () => ({ confirmed: true })
  });
  const originalAddHistory = data.store.addHistory;
  data.store.addHistory = async (entry) => {
    events.push(["history", entry.filePath]);
    await originalAddHistory(entry);
  };

  await runner.start(data.settings);
  await waitUntilStopped(runner);

  assert.deepEqual(events, [
    ["history", data.videoPath],
    ["trash", data.videoPath]
  ]);
  assert.equal(data.history.length, 1);
  assert.equal(runner.getStatus().mode, "complete");
});
