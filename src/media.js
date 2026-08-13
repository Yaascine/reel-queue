const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const bundledFfmpegPath = require("ffmpeg-static");

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
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-1_000_000);
    });
    child.on("error", (error) => reject(new Error(`Could not start the video converter: ${error.message}`)));
    child.on("close", (code) => {
      if (code === 0 || allowFailure) return resolve({ code, stderr });
      const detail = stderr.trim().split("\n").slice(-4).join(" ");
      reject(new Error(`Video conversion failed${detail ? `: ${detail}` : "."}`));
    });
  });
}

async function inspectMedia(inputPath, options = {}) {
  const { stderr } = await runFfmpeg(["-hide_banner", "-i", inputPath], { ...options, allowFailure: true });
  const video = stderr.match(/Stream[^\n]*Video:\s*([^,\s]+)/i)?.[1]?.toLowerCase() || "";
  const audio = stderr.match(/Stream[^\n]*Audio:\s*([^,\s]+)/i)?.[1]?.toLowerCase() || "";
  const pixelFormat = stderr.match(/Video:\s*[^\n]*?,\s*(yuv\w+|nv\w+|rgb\w+|gbr\w+)/i)?.[1]?.toLowerCase() || "";
  const dimensions = stderr.match(/Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/i);
  const durationParts = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
  const width = Number(dimensions?.[1] || 0);
  const height = Number(dimensions?.[2] || 0);
  const durationSeconds = durationParts
    ? Number(durationParts[1]) * 3600 + Number(durationParts[2]) * 60 + Number(durationParts[3])
    : 0;
  if (!video) throw new Error(`FFmpeg could not find a video stream in ${path.basename(inputPath)}.`);
  return { video, audio, pixelFormat, width, height, durationSeconds };
}

function isInstagramCompatible(media) {
  return media.video === "h264" && (!media.audio || media.audio === "aac") && media.pixelFormat.startsWith("yuv420p");
}

async function prepareVideo(inputPath, conversionRoot, { ffmpegPath, onProgress = () => {} } = {}) {
  const executable = resolveFfmpegPath(ffmpegPath);
  const media = await inspectMedia(inputPath, { ffmpegPath: executable });
  const extension = path.extname(inputPath).toLowerCase();

  if ((extension === ".mp4" || extension === ".m4v") && isInstagramCompatible(media)) {
    return { path: inputPath, temporary: false, mode: "unchanged", media };
  }

  await fs.mkdir(conversionRoot, { recursive: true });
  const stem = path.basename(inputPath, path.extname(inputPath)).replace(/[^a-z0-9._-]+/gi, "-") || "video";
  const outputPath = path.join(conversionRoot, `${stem}-${crypto.randomUUID()}.mp4`);

  try {
    if (isInstagramCompatible(media)) {
      onProgress("Remuxing to MP4 without quality loss");
      await runFfmpeg(
        ["-y", "-i", inputPath, "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", "-movflags", "+faststart", "-avoid_negative_ts", "make_zero", outputPath],
        { ffmpegPath: executable }
      );
      return { path: outputPath, temporary: true, mode: "remuxed", media };
    }

    onProgress("Converting to high-quality Instagram MP4");
    await runFfmpeg(
      [
        "-y", "-i", inputPath,
        "-map", "0:v:0", "-map", "0:a:0?",
        "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
        "-movflags", "+faststart", outputPath
      ],
      { ffmpegPath: executable }
    );
    return { path: outputPath, temporary: true, mode: "transcoded", media };
  } catch (error) {
    await fs.rm(outputPath, { force: true }).catch(() => {});
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
  inspectMedia,
  isInstagramCompatible,
  moveToPosted,
  nextAvailablePath,
  prepareVideo,
  resolveFfmpegPath,
  runFfmpeg
};
