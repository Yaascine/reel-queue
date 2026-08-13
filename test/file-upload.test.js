const test = require("node:test");
const assert = require("node:assert/strict");
const { VIDEO_FILE_SELECTION_TIMEOUT, setVideoInputFile } = require("../src/file-upload");

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
