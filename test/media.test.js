const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const ffmpegPath = require("ffmpeg-static");
const {
  FAST_MAX_VIDEO_BITRATE,
  FAST_VIDEO_BITRATE,
  availableHardwareEncoders,
  fastTargetDimensions,
  fastTranscodeArguments,
  inspectMedia,
  moveToPosted,
  needsFastOptimization,
  prepareVideo,
  resolveFfmpegPath,
  runFfmpeg
} = require("../src/media");

async function temporaryRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "reel-queue-media-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function makeVideo(outputPath, videoCodec, audioCodec, { size = "320x568", frameRate = 30, duration = 0.3 } = {}) {
  await runFfmpeg([
    "-y", "-f", "lavfi", "-i", `color=c=green:s=${size}:r=${frameRate}:d=${duration}`,
    "-f", "lavfi", "-i", `sine=frequency=440:duration=${duration}`,
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
  const remuxedMedia = await inspectMedia(prepared.path, { ffmpegPath });
  assert.deepEqual({ ...remuxedMedia, frameRate: Number(remuxedMedia.frameRate.toFixed(1)) }, {
    video: "h264", audio: "aac", pixelFormat: "yuv420p", width: 320, height: 568, durationSeconds: 0.32, frameRate: 30
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
    video: "h264", audio: "aac", pixelFormat: "yuv420p", width: 320, height: 568, durationSeconds: 0.3, frameRate: 30
  });
  assert.ok(["h264_videotoolbox", "h264_nvenc", "h264_qsv", "h264_amf", "libx264"].includes(prepared.encoder));
});

test("builds a smaller social-ready target without changing aspect ratio", () => {
  assert.deepEqual(fastTargetDimensions({ width: 2160, height: 3840 }), { width: 1080, height: 1920 });
  assert.deepEqual(fastTargetDimensions({ width: 3840, height: 2160 }), { width: 1920, height: 1080 });
  assert.deepEqual(fastTargetDimensions({ width: 720, height: 1280 }), { width: 720, height: 1280 });
  assert.equal(needsFastOptimization({
    video: "h264", audio: "aac", pixelFormat: "yuv420p", width: 1080, height: 1920,
    durationSeconds: 60, frameRate: 30
  }, 30_000_000), false);
  assert.equal(needsFastOptimization({
    video: "h264", audio: "aac", pixelFormat: "yuv420p", width: 2160, height: 3840,
    durationSeconds: 60, frameRate: 60
  }, 200_000_000), true);
});

test("uses fast bitrate, frame-rate, and CPU fallback arguments", () => {
  const args = fastTranscodeArguments("input.mkv", "output.mp4", {
    width: 2160, height: 3840, frameRate: 60
  }, "libx264");
  assert.equal(args.includes("veryfast"), true);
  assert.equal(args.includes("20"), true);
  assert.equal(args.includes(FAST_MAX_VIDEO_BITRATE), true);
  assert.equal(args.includes("scale=1080:1920:flags=lanczos,fps=30"), true);
  assert.equal(args.includes("128k"), true);

  const gpuArgs = fastTranscodeArguments("input.mkv", "output.mp4", {
    width: 1080, height: 1920, frameRate: 30
  }, "h264_videotoolbox");
  assert.equal(gpuArgs.includes("h264_videotoolbox"), true);
  assert.equal(gpuArgs.includes(FAST_VIDEO_BITRATE), true);
  assert.equal(gpuArgs.includes("-realtime"), true);
});

test("detects platform GPU encoders in preferred order", async () => {
  const encoders = await availableHardwareEncoders("fake-ffmpeg.exe", {
    platform: "win32",
    runner: async () => ({ code: 0, stderr: "", stdout: " h264_amf h264_qsv h264_nvenc " })
  });
  assert.deepEqual(encoders, ["h264_nvenc", "h264_qsv", "h264_amf"]);
});

test("falls back to the fast CPU encoder when a GPU cannot initialize", async (t) => {
  const root = await temporaryRoot(t);
  const inputPath = path.join(root, "gpu-fallback.mkv");
  await makeVideo(inputPath, "ffv1", "pcm_s16le");
  const attempts = [];
  const progress = [];
  const prepared = await prepareVideo(inputPath, path.join(root, "converted"), {
    ffmpegPath,
    platform: "darwin",
    hardwareEncoders: ["h264_videotoolbox"],
    onProgress: (message) => progress.push(message),
    runner: async (args, options) => {
      const encoderIndex = args.indexOf("-c:v");
      if (encoderIndex >= 0) attempts.push(args[encoderIndex + 1]);
      if (args.includes("h264_videotoolbox")) throw new Error("mock GPU initialization failure");
      return runFfmpeg(args, options);
    }
  });

  assert.deepEqual(attempts, ["h264_videotoolbox", "libx264"]);
  assert.equal(prepared.encoder, "libx264");
  assert.equal(prepared.hardwareAccelerated, false);
  assert.equal(progress.some((message) => /GPU encoder.*unavailable/i.test(message)), true);
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
