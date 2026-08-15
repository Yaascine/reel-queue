const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { AutomationRunner, chooseIntervalSeconds, formatInterval, randomChoice } = require("../src/runner");
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
    conversionRoot: path.join(root, "conversions"),
    getProfile: async (id) => (id === "profile-1" ? { id, name: "Test" } : null),
    saveSettings: async (settings) => settings,
    hasSuccessfulPost: async (profileId, filePath) =>
      history.some((entry) => entry.profileId === profileId && entry.filePath === filePath),
    getUploadAllowance: async () => ({ allowed: true, count: 0, limit: 22, nextAllowedAt: null }),
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
      intervalMinutes: 1
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

test("does not move or record a video without positive confirmation", async (t) => {
  const data = await fixture();
  t.after(() => fs.rm(data.root, { recursive: true, force: true }));
  let moveCalls = 0;
  const runner = new AutomationRunner({
    store: data.store,
    chrome: { open: async () => ({ page: {} }) },
    emit: () => {},
    publisher: async () => { throw new ConfirmationError("No confirmation"); },
    mediaPreparer: async (videoPath) => ({ path: videoPath, temporary: false, mode: "unchanged" }),
    postedMover: async () => { moveCalls += 1; }
  });

  await runner.start(data.settings);
  await waitUntilStopped(runner);

  assert.equal(moveCalls, 0);
  assert.equal(data.history.length, 0);
  assert.equal(runner.getStatus().mode, "error");
});

test("never retries a file after the platform accepted its final submission click", async (t) => {
  const data = await fixture();
  t.after(() => fs.rm(data.root, { recursive: true, force: true }));
  let moveCalls = 0;
  const runner = new AutomationRunner({
    store: data.store,
    chrome: { open: async () => ({ page: {} }) },
    emit: () => {},
    publisher: async ({ onSubmitted }) => {
      await onSubmitted();
      throw new ConfirmationError("The success screen changed after submission");
    },
    mediaPreparer: async (videoPath) => ({ path: videoPath, temporary: false, mode: "unchanged" }),
    postedMover: async () => { moveCalls += 1; return "posted"; }
  });

  await runner.start(data.settings);
  await waitUntilStopped(runner);

  assert.equal(moveCalls, 1);
  assert.equal(data.history.length, 1);
  assert.equal(data.history[0].status, "submitted");
  assert.equal(runner.getStatus().mode, "complete");
  assert.equal(data.logs.some((entry) => /will not be uploaded again/i.test(entry.message)), true);
});

test("still moves an accepted post when Windows blocks the final history update", async (t) => {
  const data = await fixture();
  t.after(() => fs.rm(data.root, { recursive: true, force: true }));
  const originalAddHistory = data.store.addHistory;
  let historyWrites = 0;
  data.store.addHistory = async (entry) => {
    historyWrites += 1;
    if (historyWrites === 2) throw Object.assign(new Error("history locked"), { code: "EPERM" });
    await originalAddHistory(entry);
  };
  let moveCalls = 0;
  const runner = new AutomationRunner({
    store: data.store,
    chrome: { open: async () => ({ page: {} }) },
    emit: () => {},
    publisher: async ({ onSubmitted }) => { await onSubmitted(); return { confirmed: true }; },
    mediaPreparer: async (videoPath) => ({ path: videoPath, temporary: false, mode: "unchanged" }),
    postedMover: async () => { moveCalls += 1; return "posted"; }
  });

  await runner.start(data.settings);
  await waitUntilStopped(runner);

  assert.equal(moveCalls, 1);
  assert.equal(data.history[0].status, "submitted");
  assert.equal(runner.getStatus().mode, "complete");
});

test("records success before moving a video to the posted folder", async (t) => {
  const data = await fixture();
  t.after(() => fs.rm(data.root, { recursive: true, force: true }));
  const events = [];
  const runner = new AutomationRunner({
    store: data.store,
    chrome: { open: async () => ({ page: {} }) },
    emit: () => {},
    publisher: async () => ({ confirmed: true }),
    mediaPreparer: async (videoPath) => ({ path: videoPath, temporary: false, mode: "unchanged" }),
    postedMover: async (filePath) => {
      events.push(["posted-folder", filePath]);
      return path.join(path.dirname(filePath), "posted", path.basename(filePath));
    }
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
    ["posted-folder", data.videoPath]
  ]);
  assert.equal(data.history.length, 1);
  assert.equal(runner.getStatus().mode, "complete");
});

test("allows Instagram to use an automatic thumbnail", async (t) => {
  const data = await fixture();
  t.after(() => fs.rm(data.root, { recursive: true, force: true }));
  let published;
  const runner = new AutomationRunner({
    store: data.store, chrome: { open: async () => ({ page: {} }) }, emit: () => {},
    publisher: async (input) => { published = input; return { confirmed: true }; },
    mediaPreparer: async (source) => ({ path: source, temporary: false, mode: "unchanged" }),
    postedMover: async () => "posted"
  });
  await runner.start({ ...data.settings, thumbnailMode: "automatic", thumbnailPath: "" });
  await waitUntilStopped(runner);
  assert.equal(published.thumbnailPath, "");
  assert.equal(runner.getStatus().mode, "complete");
});

test("randomly chooses an Instagram thumbnail and saved caption for each post", async (t) => {
  const data = await fixture();
  const thumbnailFolder = path.join(data.root, "thumbnails");
  await fs.mkdir(thumbnailFolder);
  await fs.writeFile(path.join(thumbnailFolder, "a.jpg"), "a");
  await fs.writeFile(path.join(thumbnailFolder, "b.png"), "b");
  t.after(() => fs.rm(data.root, { recursive: true, force: true }));
  let published;
  const runner = new AutomationRunner({
    store: data.store, chrome: { open: async () => ({ page: {} }) }, emit: () => {}, random: () => 0.999,
    publisher: async (input) => { published = input; return { confirmed: true }; },
    mediaPreparer: async (source) => ({ path: source, temporary: false, mode: "unchanged" }),
    postedMover: async () => "posted"
  });
  await runner.start({
    ...data.settings,
    thumbnailMode: "folder",
    thumbnailFolder,
    caption: "",
    savedCaptions: ["Caption A", "Caption B"]
  });
  await waitUntilStopped(runner);
  assert.equal(published.thumbnailPath, path.join(thumbnailFolder, "b.png"));
  assert.equal(published.caption, "Caption B");
});

test("chooses fixed or inclusive random queue gaps", () => {
  assert.equal(chooseIntervalSeconds({ intervalMinutes: 20, randomIntervalEnabled: false }), 1200);
  assert.equal(chooseIntervalSeconds({ intervalMinutes: 0, randomIntervalEnabled: false }), 0);
  const settings = { randomIntervalEnabled: true, randomIntervalMinMinutes: 7, randomIntervalMaxMinutes: 12 };
  assert.equal(chooseIntervalSeconds(settings, () => 0), 420);
  assert.equal(chooseIntervalSeconds(settings, () => 0.999), 720);
  assert.equal(chooseIntervalSeconds({ randomIntervalEnabled: true, randomIntervalMinMinutes: 0, randomIntervalMaxMinutes: 1 / 60 }, () => 0.999), 1);
  assert.equal(formatInterval(0), "no delay");
  assert.equal(formatInterval(30), "30 second(s)");
  assert.equal(formatInterval(90), "1 minute(s) 30 second(s)");
  assert.equal(randomChoice(["a", "b"], () => 0.999), "b");
});

test("runs the next queued post immediately when the gap is zero", async (t) => {
  const data = await fixture();
  t.after(() => fs.rm(data.root, { recursive: true, force: true }));
  const secondVideo = path.join(data.root, "video2.mp4");
  await fs.writeFile(secondVideo, "video");
  const published = [];
  const runner = new AutomationRunner({
    store: data.store,
    chrome: { open: async () => ({ page: {} }) },
    emit: () => {},
    publisher: async ({ videoPath }) => { published.push(videoPath); return { confirmed: true }; },
    mediaPreparer: async (videoPath) => ({ path: videoPath, temporary: false, mode: "unchanged" }),
    postedMover: async () => "posted"
  });

  await runner.start({ ...data.settings, intervalMinutes: 0 });
  await waitUntilStopped(runner);

  assert.deepEqual(published, [data.videoPath, secondVideo]);
  assert.equal(runner.getStatus().mode, "complete");
  assert.equal(data.logs.some((entry) => /starting the next post immediately/i.test(entry.message)), true);
});

test("waits for the account cooldown before uploading", async (t) => {
  const data = await fixture();
  t.after(() => fs.rm(data.root, { recursive: true, force: true }));
  let currentTime = 1_000;
  let publishCalls = 0;
  data.store.getUploadAllowance = async () => currentTime < 5_000
    ? { allowed: false, count: 22, limit: 22, nextAllowedAt: 5_000 }
    : { allowed: true, count: 0, limit: 22, nextAllowedAt: null };
  const runner = new AutomationRunner({
    store: data.store,
    chrome: { open: async () => ({ page: {} }) },
    emit: () => {},
    now: () => currentTime,
    sleeper: async (milliseconds) => { currentTime += milliseconds; },
    publisher: async () => { publishCalls += 1; return { confirmed: true }; },
    mediaPreparer: async (videoPath) => ({ path: videoPath, temporary: false, mode: "unchanged" }),
    postedMover: async () => "posted"
  });

  await runner.start(data.settings);
  await waitUntilStopped(runner);

  assert.equal(publishCalls, 1);
  assert.equal(currentTime, 5_000);
  assert.equal(data.logs.some((entry) => /daily account limit reached \(22\/22\)/i.test(entry.message)), true);
});

test("rejects landscape videos from a YouTube Shorts queue", async (t) => {
  const data = await fixture();
  t.after(() => fs.rm(data.root, { recursive: true, force: true }));
  const runner = new AutomationRunner({
    platform: "youtube",
    store: data.store,
    chrome: { open: async () => ({ page: {} }) },
    emit: () => {},
    publisher: async () => ({ confirmed: true }),
    mediaPreparer: async (videoPath) => ({
      path: videoPath, temporary: false, mode: "unchanged", media: { width: 1920, height: 1080, durationSeconds: 10 }
    })
  });
  await runner.start({ ...data.settings, thumbnailPath: "", caption: "", title: "Test Short" });
  await waitUntilStopped(runner);
  assert.equal(runner.getStatus().mode, "error");
  assert.match(runner.getStatus().message, /square or vertical/i);
  assert.equal(data.history.length, 0);
});

test("uses a trimmed extension-free filename as the YouTube title", async (t) => {
  const data = await fixture();
  t.after(() => fs.rm(data.root, { recursive: true, force: true }));
  await fs.rm(data.videoPath);
  const longStem = `YouTube ${"title ".repeat(20)}`.trim();
  const videoPath = path.join(data.root, `${longStem}.mkv`);
  await fs.writeFile(videoPath, "video");
  let published;
  const runner = new AutomationRunner({
    platform: "youtube", store: data.store, chrome: { open: async () => ({ page: {} }) }, emit: () => {},
    random: () => 0.999,
    publisher: async (input) => { published = input; return { confirmed: true }; },
    mediaPreparer: async (source) => ({ path: source, temporary: false, mode: "unchanged", media: { width: 720, height: 1280, durationSeconds: 10 } }),
    postedMover: async () => "posted"
  });
  await runner.start({
    ...data.settings,
    thumbnailPath: "",
    caption: "",
    title: "Ignored fixed title",
    description: "Ignored fixed description",
    savedDescriptions: ["Description A", "Description B"]
  });
  await waitUntilStopped(runner);
  assert.equal(published.title, longStem.slice(0, 100).trimEnd());
  assert.equal(published.title.length, 100);
  assert.equal(published.thumbnailPath, "");
  assert.equal(published.description, "Description B");
  assert.equal(published.privacy, "public");
});

test("uses the extension-free filename as the TikTok caption", async (t) => {
  const data = await fixture();
  t.after(() => fs.rm(data.root, { recursive: true, force: true }));
  await fs.rm(data.videoPath);
  const videoPath = path.join(data.root, "MMA knockout.final.cut.mp4");
  await fs.writeFile(videoPath, "video");
  let published;
  const runner = new AutomationRunner({
    platform: "tiktok", store: data.store, chrome: { open: async () => ({ page: {} }) }, emit: () => {},
    publisher: async (input) => { published = input; return { confirmed: true }; },
    mediaPreparer: async (source) => ({ path: source, temporary: false, mode: "unchanged" }),
    postedMover: async () => "posted"
  });
  await runner.start({ ...data.settings, thumbnailPath: "", caption: "" });
  await waitUntilStopped(runner);
  assert.equal(published.caption, "MMA knockout.final.cut");
  assert.equal(published.thumbnailPath, "");
  assert.equal(published.privacy, "public");
});
