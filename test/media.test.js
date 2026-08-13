const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const ffmpegPath = require("ffmpeg-static");
const { inspectMedia, moveToPosted, prepareVideo, runFfmpeg } = require("../src/media");

async function temporaryRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "reel-queue-media-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function makeVideo(outputPath, videoCodec, audioCodec) {
  await runFfmpeg([
    "-y", "-f", "lavfi", "-i", "color=c=green:s=320x568:r=30:d=0.3",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=0.3",
    "-shortest", "-c:v", videoCodec, "-pix_fmt", "yuv420p", "-c:a", audioCodec, outputPath
  ], { ffmpegPath });
}

test("remuxes compatible MKV streams to MP4 without re-encoding", async (t) => {
  const root = await temporaryRoot(t);
  const inputPath = path.join(root, "source.mkv");
  await makeVideo(inputPath, "libx264", "aac");

  const prepared = await prepareVideo(inputPath, path.join(root, "converted"), { ffmpegPath });
  assert.equal(prepared.mode, "remuxed");
  assert.equal(prepared.temporary, true);
  assert.equal(path.extname(prepared.path), ".mp4");
  assert.deepEqual(await inspectMedia(prepared.path, { ffmpegPath }), {
    video: "h264",
    audio: "aac",
    pixelFormat: "yuv420p"
  });
});

test("transcodes incompatible MKV codecs to Instagram-safe H.264 and AAC", async (t) => {
  const root = await temporaryRoot(t);
  const inputPath = path.join(root, "source.mkv");
  await makeVideo(inputPath, "ffv1", "pcm_s16le");

  const prepared = await prepareVideo(inputPath, path.join(root, "converted"), { ffmpegPath });
  assert.equal(prepared.mode, "transcoded");
  assert.deepEqual(await inspectMedia(prepared.path, { ffmpegPath }), {
    video: "h264",
    audio: "aac",
    pixelFormat: "yuv420p"
  });
});

test("creates posted folder and preserves colliding filenames", async (t) => {
  const root = await temporaryRoot(t);
  const first = path.join(root, "movie.mkv");
  await fs.writeFile(first, "first");
  const firstDestination = await moveToPosted(first);
  assert.equal(firstDestination, path.join(root, "posted", "movie.mkv"));

  const second = path.join(root, "movie.mkv");
  await fs.writeFile(second, "second");
  const secondDestination = await moveToPosted(second);
  assert.equal(secondDestination, path.join(root, "posted", "movie (2).mkv"));
  assert.equal(await fs.readFile(firstDestination, "utf8"), "first");
  assert.equal(await fs.readFile(secondDestination, "utf8"), "second");
});
