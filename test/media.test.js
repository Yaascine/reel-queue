const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const ffmpegPath = require("ffmpeg-static");
const { inspectMedia, moveToPosted, prepareVideo, resolveFfmpegPath, runFfmpeg } = require("../src/media");

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

test("resolves packaged FFmpeg from the platform resources directory", () => {
  assert.equal(
    resolveFfmpegPath("/app/resources/app.asar/node_modules/ffmpeg-static/ffmpeg", {
      resourcesPath: "/app/resources",
      platform: "darwin"
    }),
    path.join("/app/resources", "ffmpeg", "ffmpeg")
  );
  assert.equal(
    resolveFfmpegPath("/app/resources/app.asar/node_modules/ffmpeg-static/ffmpeg.exe", {
      resourcesPath: "/app/resources",
      platform: "win32"
    }),
    path.join("/app/resources", "ffmpeg", "ffmpeg.exe")
  );
});

test("remuxes compatible MKV streams to MP4 without re-encoding", async (t) => {
  const root = await temporaryRoot(t);
  const inputPath = path.join(root, "source.mkv");
  await makeVideo(inputPath, "libx264", "aac");

  const prepared = await prepareVideo(inputPath, path.join(root, "converted"), { ffmpegPath });
  assert.equal(prepared.mode, "remuxed");
  assert.equal(prepared.temporary, true);
  assert.equal(path.extname(prepared.path), ".mp4");
  assert.deepEqual(await inspectMedia(prepared.path, { ffmpegPath }), {
    video: "h264", audio: "aac", pixelFormat: "yuv420p", width: 320, height: 568, durationSeconds: 0.32
  });
});

test("transcodes incompatible MKV codecs to Instagram-safe H.264 and AAC", async (t) => {
  const root = await temporaryRoot(t);
  const inputPath = path.join(root, "source.mkv");
  await makeVideo(inputPath, "ffv1", "pcm_s16le");

  const prepared = await prepareVideo(inputPath, path.join(root, "converted"), { ffmpegPath });
  assert.equal(prepared.mode, "transcoded");
  const media = await inspectMedia(prepared.path, { ffmpegPath });
  assert.deepEqual({ ...media, durationSeconds: Number(media.durationSeconds.toFixed(1)) }, {
    video: "h264", audio: "aac", pixelFormat: "yuv420p", width: 320, height: 568, durationSeconds: 0.3
  });
});

test("reuses a prepared MP4 cache until the source file changes", async (t) => {
  const root = await temporaryRoot(t);
  const inputPath = path.join(root, "cached-source.mkv");
  const conversionRoot = path.join(root, "converted");
  await makeVideo(inputPath, "ffv1", "pcm_s16le");

  const first = await prepareVideo(inputPath, conversionRoot, { ffmpegPath });
  const second = await prepareVideo(inputPath, conversionRoot, { ffmpegPath });
  assert.equal(first.cacheHit, false);
  assert.equal(second.cacheHit, true);
  assert.equal(second.path, first.path);

  const originalStat = await fs.stat(inputPath);
  await fs.utimes(inputPath, originalStat.atime, new Date(originalStat.mtimeMs + 2_000));
  const changed = await prepareVideo(inputPath, conversionRoot, { ffmpegPath });
  assert.equal(changed.cacheHit, false);
  assert.notEqual(changed.path, first.path);
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
