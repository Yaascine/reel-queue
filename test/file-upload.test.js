const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { PLAYWRIGHT_REMOTE_FILE_LIMIT, VIDEO_FILE_SELECTION_TIMEOUT, setVideoInputFile } = require("../src/file-upload");

test("gives every platform five minutes to accept a video", async () => {
  let received;
  const input = {
    async setInputFiles(videoPath, options) {
      received = { videoPath, options };
    }
  };
  const result = await setVideoInputFile(input, "large-video.mkv", { platform: "YouTube" });
  assert.deepEqual(received, {
    videoPath: "large-video.mkv",
    options: { timeout: VIDEO_FILE_SELECTION_TIMEOUT }
  });
  assert.equal(VIDEO_FILE_SELECTION_TIMEOUT, 300_000);
  assert.deepEqual(result, { accepted: true, recovered: false });
});

test("continues when the platform advanced after replacing its file input", async () => {
  const input = { setInputFiles: () => new Promise(() => {}) };
  let checks = 0;
  const result = await setVideoInputFile(input, "video.mp4", {
    platform: "Instagram",
    isAccepted: async () => ++checks > 1
  });
  assert.deepEqual(result, { accepted: true, recovered: true });
});

test("hands videos larger than 50 MB directly to local Chrome", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "reel-queue-large-upload-"));
  const videoPath = path.join(root, "large reel.mp4");
  await fs.writeFile(videoPath, "");
  await fs.truncate(videoPath, PLAYWRIGHT_REMOTE_FILE_LIMIT + 1);
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const calls = [];
  const session = {
    async send(method, params) {
      calls.push({ method, params });
      if (method === "Runtime.evaluate") return { result: { objectId: "input-object" } };
      return {};
    },
    async detach() {}
  };
  let standardUploadCalled = false;
  const input = {
    async evaluate() {},
    async setInputFiles() { standardUploadCalled = true; }
  };
  const page = {
    context: () => ({ newCDPSession: async () => session }),
    async evaluate() {}
  };

  const result = await setVideoInputFile(input, videoPath, { platform: "Instagram", page });
  assert.equal(standardUploadCalled, false);
  assert.equal(calls.some((call) => call.method === "DOM.setFileInputFiles"
    && call.params.objectId === "input-object"
    && call.params.files[0] === path.resolve(videoPath)), true);
  assert.deepEqual(result, { accepted: true, recovered: false });
});
