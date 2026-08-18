const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const bundledFfmpegPath = require("ffmpeg-static");

const CONVERSION_CACHE_VERSION = 3;
const FAST_VIDEO_BITRATE = "7M";
const FAST_MAX_VIDEO_BITRATE = "9M";
const FAST_AUDIO_BITRATE = "128k";
const FAST_SOURCE_BITRATE_LIMIT_KBPS = 9_000;
const preparationJobs = new Map();
const encoderAvailability = new Map();

function resolveFfmpegPath(
  candidate = bundledFfmpegPath,
  { resourcesPath = process.resourcesPath, platform = process.platform } = {}
) {
  if (!candidate) throw new Error("The bundled video converter is unavailable.");
  if (candidate.includes("app.asar") && resourcesPath) {
    return path.join(resourcesPath, "ffmpeg", platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  }
  return candidate.includes("app.asar") ? candidate.replace("app.asar", "app.asar.unpacked") : candidate;
}

function runFfmpeg(args, { ffmpegPath = resolveFfmpegPath(), allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = "";
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout = `${stdout}${chunk}`.slice(-1_000_000);
    });
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-1_000_000);
    });
    child.on("error", (error) => reject(new Error(`Could not start the video converter: ${error.message}`)));
    child.on("close", (code) => {
      if (code === 0 || allowFailure) return resolve({ code, stderr, stdout });
      const detail = stderr.trim().split("\n").slice(-4).join(" ");
      reject(new Error(`Video conversion failed${detail ? `: ${detail}` : "."}`));
    });
  });
}

async function inspectMedia(inputPath, options = {}) {
  const { runner = runFfmpeg, ...runOptions } = options;
  const { stderr } = await runner(["-hide_banner", "-i", inputPath], { ...runOptions, allowFailure: true });
  const video = stderr.match(/Stream[^\n]*Video:\s*([^,\s]+)/i)?.[1]?.toLowerCase() || "";
  const audio = stderr.match(/Stream[^\n]*Audio:\s*([^,\s]+)/i)?.[1]?.toLowerCase() || "";
  const pixelFormat = stderr.match(/Video:\s*[^\n]*?,\s*(yuv\w+|nv\w+|rgb\w+|gbr\w+)/i)?.[1]?.toLowerCase() || "";
  const dimensions = stderr.match(/Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/i);
  const frameRate = Number(stderr.match(/Video:[^\n]*?\b(\d+(?:\.\d+)?)\s*fps\b/i)?.[1] || 0);
  const durationParts = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
  const width = Number(dimensions?.[1] || 0);
  const height = Number(dimensions?.[2] || 0);
  const durationSeconds = durationParts
    ? Number(durationParts[1]) * 3600 + Number(durationParts[2]) * 60 + Number(durationParts[3])
    : 0;
  if (!video) throw new Error(`FFmpeg could not find a video stream in ${path.basename(inputPath)}.`);
  return { video, audio, pixelFormat, width, height, durationSeconds, frameRate };
}

function isInstagramCompatible(media) {
  return media.video === "h264" && (!media.audio || media.audio === "aac") && media.pixelFormat.startsWith("yuv420p");
}

function fastTargetDimensions(media) {
  if (!media.width || !media.height) return { width: 0, height: 0 };
  const landscape = media.width > media.height;
  const maximumWidth = landscape ? 1920 : 1080;
  const maximumHeight = landscape ? 1080 : 1920;
  const scale = Math.min(1, maximumWidth / media.width, maximumHeight / media.height);
  return {
    width: Math.max(2, Math.floor((media.width * scale) / 2) * 2),
    height: Math.max(2, Math.floor((media.height * scale) / 2) * 2)
  };
}

function sourceBitrateKbps(sourceSize, durationSeconds) {
  if (!sourceSize || !durationSeconds) return 0;
  return Math.round((sourceSize * 8) / durationSeconds / 1_000);
}

function needsFastOptimization(media, sourceSize) {
  if (!isInstagramCompatible(media)) return true;
  const target = fastTargetDimensions(media);
  const bitrate = sourceBitrateKbps(sourceSize, media.durationSeconds);
  return target.width !== media.width
    || target.height !== media.height
    || media.frameRate > 30.5
    || bitrate > FAST_SOURCE_BITRATE_LIMIT_KBPS;
}

function preferredHardwareEncoders(platform = process.platform) {
  if (platform === "darwin") return ["h264_videotoolbox"];
  if (platform === "win32") return ["h264_nvenc", "h264_qsv", "h264_amf"];
  return [];
}

async function availableHardwareEncoders(ffmpegPath, { platform = process.platform, runner = runFfmpeg } = {}) {
  const preferred = preferredHardwareEncoders(platform);
  if (!preferred.length) return [];
  const cacheKey = `${platform}\0${ffmpegPath}`;
  if (runner === runFfmpeg && encoderAvailability.has(cacheKey)) return encoderAvailability.get(cacheKey);
  const output = await runner(["-hide_banner", "-encoders"], { ffmpegPath, allowFailure: true });
  const listing = `${output.stdout || ""}\n${output.stderr || ""}`;
  const available = preferred.filter((encoder) => new RegExp(`\\b${encoder}\\b`).test(listing));
  if (runner === runFfmpeg) encoderAvailability.set(cacheKey, available);
  return available;
}

function encoderArguments(encoder) {
  if (encoder === "h264_videotoolbox") {
    return [
      "-c:v", encoder, "-realtime", "1", "-b:v", FAST_VIDEO_BITRATE,
      "-maxrate", FAST_MAX_VIDEO_BITRATE, "-bufsize", "14M", "-profile:v", "high"
    ];
  }
  if (encoder === "h264_nvenc") {
    return [
      "-c:v", encoder, "-preset", "p3", "-tune", "hq", "-rc", "vbr", "-cq", "20",
      "-b:v", FAST_VIDEO_BITRATE, "-maxrate", FAST_MAX_VIDEO_BITRATE, "-bufsize", "14M"
    ];
  }
  if (encoder === "h264_qsv") {
    return [
      "-c:v", encoder, "-preset", "veryfast", "-b:v", FAST_VIDEO_BITRATE,
      "-maxrate", FAST_MAX_VIDEO_BITRATE, "-bufsize", "14M", "-look_ahead", "0"
    ];
  }
  if (encoder === "h264_amf") {
    return [
      "-c:v", encoder, "-quality", "speed", "-b:v", FAST_VIDEO_BITRATE,
      "-maxrate", FAST_MAX_VIDEO_BITRATE, "-bufsize", "14M"
    ];
  }
  return [
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-maxrate", FAST_MAX_VIDEO_BITRATE, "-bufsize", "18M", "-profile:v", "high"
  ];
}

function fastTranscodeArguments(inputPath, outputPath, media, encoder) {
  const target = fastTargetDimensions(media);
  const filters = [];
  if (target.width && target.height && (target.width !== media.width || target.height !== media.height)) {
    filters.push(`scale=${target.width}:${target.height}:flags=lanczos`);
  }
  if (media.frameRate > 30.5) filters.push("fps=30");
  return [
    "-y", "-hide_banner", "-i", inputPath,
    "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn",
    ...(filters.length ? ["-vf", filters.join(",")] : []),
    ...encoderArguments(encoder), "-pix_fmt", "yuv420p", "-g", "60",
    "-c:a", "aac", "-b:a", FAST_AUDIO_BITRATE, "-ar", "48000",
    "-movflags", "+faststart", "-map_metadata", "-1", outputPath
  ];
}

async function prepareVideo(inputPath, conversionRoot, {
  ffmpegPath,
  onProgress = () => {},
  platform = process.platform,
  hardwareEncoders,
  runner = runFfmpeg
} = {}) {
  const executable = resolveFfmpegPath(ffmpegPath);
  const media = await inspectMedia(inputPath, { ffmpegPath: executable, runner });
  const extension = path.extname(inputPath).toLowerCase();
  const sourceStat = await fs.stat(inputPath);
  const optimize = needsFastOptimization(media, sourceStat.size);

  if ((extension === ".mp4" || extension === ".m4v") && isInstagramCompatible(media) && !optimize) {
    return { path: inputPath, temporary: false, mode: "unchanged", media, sourceBytes: sourceStat.size, outputBytes: sourceStat.size };
  }

  await fs.mkdir(conversionRoot, { recursive: true });
  const stem = path.basename(inputPath, path.extname(inputPath)).replace(/[^a-z0-9._-]+/gi, "-") || "video";
  const fingerprint = crypto
    .createHash("sha256")
    .update(JSON.stringify({
      version: CONVERSION_CACHE_VERSION,
      path: path.resolve(inputPath),
      size: sourceStat.size,
      modified: sourceStat.mtimeMs,
      video: media.video,
      audio: media.audio,
      pixelFormat: media.pixelFormat,
      frameRate: media.frameRate
    }))
    .digest("hex")
    .slice(0, 24);
  const outputPath = path.join(conversionRoot, `${stem}-${fingerprint}.mp4`);
  const mode = isInstagramCompatible(media) && !optimize ? "remuxed" : "transcoded";

  const cachedStat = await fs.stat(outputPath).catch(() => null);
  if (cachedStat?.isFile() && cachedStat.size > 0) {
    onProgress("Using the smaller prepared MP4 cache");
    return {
      path: outputPath, temporary: true, cached: true, cacheHit: true, mode, media,
      encoder: "cache", hardwareAccelerated: false, sourceBytes: sourceStat.size, outputBytes: cachedStat.size
    };
  }
  if (cachedStat) await fs.rm(outputPath, { force: true }).catch(() => {});

  let preparationJob = preparationJobs.get(outputPath);
  if (!preparationJob) {
    preparationJob = (async () => {
      if (mode === "remuxed") {
        const partialPath = path.join(conversionRoot, `${stem}-${fingerprint}-${crypto.randomUUID()}.partial.mp4`);
        try {
          onProgress("Remuxing to MP4 without quality loss");
          await runner(
            ["-y", "-i", inputPath, "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", "-movflags", "+faststart", "-avoid_negative_ts", "make_zero", partialPath],
            { ffmpegPath: executable }
          );
          await fs.rename(partialPath, outputPath);
          return { encoder: "copy", hardwareAccelerated: false };
        } catch (error) {
          await fs.rm(partialPath, { force: true }).catch(() => {});
          throw error;
        }
      }

      const detectedHardware = hardwareEncoders === undefined
        ? await availableHardwareEncoders(executable, { platform, runner })
        : hardwareEncoders;
      const candidates = [...detectedHardware, "libx264"];
      let lastError;
      for (const encoder of candidates) {
        const partialPath = path.join(conversionRoot, `${stem}-${fingerprint}-${crypto.randomUUID()}.partial.mp4`);
        const hardwareAccelerated = encoder !== "libx264";
        onProgress(hardwareAccelerated
          ? `Fast GPU conversion (${encoder.replace("h264_", "")})`
          : "Fast CPU conversion (GPU fallback)");
        try {
          await runner(fastTranscodeArguments(inputPath, partialPath, media, encoder), { ffmpegPath: executable });
          const partialStat = await fs.stat(partialPath);
          if (!partialStat.size) throw new Error("The video converter created an empty MP4.");
          await fs.rename(partialPath, outputPath).catch(async (error) => {
            if (error?.code !== "EEXIST") throw error;
            await fs.rm(partialPath, { force: true });
          });
          return { encoder, hardwareAccelerated };
        } catch (error) {
          lastError = error;
          await fs.rm(partialPath, { force: true }).catch(() => {});
          if (hardwareAccelerated) onProgress(`GPU encoder ${encoder.replace("h264_", "")} unavailable; trying the next fast encoder`);
        }
      }
      throw lastError || new Error("No working H.264 video encoder was found.");
    })().finally(() => {
      preparationJobs.delete(outputPath);
    });
    preparationJobs.set(outputPath, preparationJob);
  } else {
    onProgress("Waiting for the existing MP4 preparation");
  }

  try {
    const conversion = await preparationJob;
    const outputStat = await fs.stat(outputPath);
    return {
      path: outputPath, temporary: true, cached: true, cacheHit: false, mode, media,
      encoder: conversion.encoder, hardwareAccelerated: conversion.hardwareAccelerated,
      sourceBytes: sourceStat.size, outputBytes: outputStat.size
    };
  } catch (error) {
    throw error;
  }
}

async function nextAvailablePath(directory, fileName) {
  const extension = path.extname(fileName);
  const stem = path.basename(fileName, extension);
  for (let index = 1; ; index += 1) {
    const candidate = path.join(directory, index === 1 ? fileName : `${stem} (${index})${extension}`);
    try {
      await fs.access(candidate);
    } catch {
      return candidate;
    }
  }
}

async function moveToPosted(inputPath) {
  const postedDirectory = path.join(path.dirname(inputPath), "posted");
  await fs.mkdir(postedDirectory, { recursive: true });
  const destination = await nextAvailablePath(postedDirectory, path.basename(inputPath));
  await fs.rename(inputPath, destination);
  return destination;
}

module.exports = {
  FAST_MAX_VIDEO_BITRATE,
  FAST_SOURCE_BITRATE_LIMIT_KBPS,
  FAST_VIDEO_BITRATE,
  availableHardwareEncoders,
  encoderArguments,
  fastTargetDimensions,
  fastTranscodeArguments,
  inspectMedia,
  isInstagramCompatible,
  needsFastOptimization,
  moveToPosted,
  nextAvailablePath,
  prepareVideo,
  resolveFfmpegPath,
  runFfmpeg
};
