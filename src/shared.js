const path = require("node:path");

const VIDEO_EXTENSIONS = new Set([
  ".3g2", ".3gp", ".asf", ".avi", ".divx", ".dv", ".f4v", ".flv", ".m2ts", ".m2v",
  ".m4v", ".mkv", ".mov", ".mp4", ".mpe", ".mpeg", ".mpg", ".mts", ".mxf", ".ogv",
  ".qt", ".rm", ".rmvb", ".ts", ".vob", ".webm", ".wmv", ".y4m"
]);

const PLATFORMS = new Set(["instagram", "youtube", "tiktok"]);
const IMAGE_EXTENSIONS = new Set([".avif", ".heic", ".heif", ".jpeg", ".jpg", ".png"]);
const DAILY_UPLOAD_LIMIT = 22;
const MAX_DAILY_UPLOAD_LIMIT = 1000;
const UPLOAD_WINDOW_MS = 24 * 60 * 60 * 1000;

function normalizeTextPool(value, maximumLength) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value
    .map((entry) => typeof entry === "string" ? entry.trim().slice(0, maximumLength) : "")
    .filter((entry) => entry && !seen.has(entry) && seen.add(entry))
    .slice(0, 100);
}

function normalizeMinutes(value, fallback, unit = "minutes") {
  const minutes = Number(value);
  // Store gaps as minutes for backward compatibility, but retain whole-second
  // precision so the interface can offer either minutes or seconds.
  return Number.isFinite(minutes)
    ? Math.min(1440, Math.max(0, unit === "seconds" ? Math.round(minutes * 60) / 60 : Math.round(minutes)))
    : fallback;
}

function normalizeIntervalUnit(value) {
  return value === "seconds" ? "seconds" : "minutes";
}

function normalizePlatform(value) {
  return PLATFORMS.has(value) ? value : "instagram";
}

function normalizeDailyUploadLimit(value) {
  const limit = Number(value);
  return Number.isFinite(limit)
    ? Math.min(MAX_DAILY_UPLOAD_LIMIT, Math.max(1, Math.round(limit)))
    : DAILY_UPLOAD_LIMIT;
}

function normalizeSettings(input = {}, platform = "instagram") {
  const normalizedPlatform = normalizePlatform(platform);
  const intervalUnit = normalizeIntervalUnit(input.intervalUnit);
  const randomIntervalUnit = normalizeIntervalUnit(input.randomIntervalUnit);
  const base = {
    profileId: typeof input.profileId === "string" ? input.profileId : "",
    videoFolder: typeof input.videoFolder === "string" ? input.videoFolder : "",
    thumbnailPath: typeof input.thumbnailPath === "string" ? input.thumbnailPath : "",
    caption: typeof input.caption === "string" ? input.caption.slice(0, 2200) : "",
    intervalMinutes: normalizeMinutes(input.intervalMinutes, 20, intervalUnit),
    intervalUnit,
    randomIntervalEnabled: Boolean(input.randomIntervalEnabled),
    randomIntervalMinMinutes: normalizeMinutes(input.randomIntervalMinMinutes, 10, randomIntervalUnit),
    randomIntervalMaxMinutes: normalizeMinutes(input.randomIntervalMaxMinutes, 30, randomIntervalUnit),
    randomIntervalUnit,
    thumbnailMode: ["automatic", "single", "folder"].includes(input.thumbnailMode)
      ? input.thumbnailMode
      : (input.thumbnailFolder ? "folder" : input.thumbnailPath ? "single" : "automatic"),
    thumbnailFolder: typeof input.thumbnailFolder === "string" ? input.thumbnailFolder : "",
    savedCaptions: normalizeTextPool(input.savedCaptions, 2200),
    dailyLimitEnabled: input.dailyLimitEnabled !== false,
    dailyUploadLimit: normalizeDailyUploadLimit(input.dailyUploadLimit)
  };
  if (normalizedPlatform === "youtube") {
    return {
      ...base,
      title: typeof input.title === "string" ? input.title.slice(0, 100) : "",
      description: typeof input.description === "string" ? input.description.slice(0, 5000) : "",
      savedDescriptions: normalizeTextPool(input.savedDescriptions, 5000),
      privacy: ["public", "unlisted", "private"].includes(input.privacy) ? input.privacy : "public",
      madeForKids: Boolean(input.madeForKids)
    };
  }
  if (normalizedPlatform === "tiktok") {
    return {
      ...base,
      privacy: ["public", "friends", "private"].includes(input.privacy) ? input.privacy : "public"
    };
  }
  return base;
}

function isSupportedVideo(filePath) {
  const index = filePath.lastIndexOf(".");
  if (index < 0) return false;
  return VIDEO_EXTENSIONS.has(filePath.slice(index).toLowerCase());
}

function isSupportedImage(filePath) {
  const index = filePath.lastIndexOf(".");
  if (index < 0) return false;
  return IMAGE_EXTENSIONS.has(filePath.slice(index).toLowerCase());
}

function naturalCompare(left, right) {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function videoTitleFromPath(filePath, maximumLength = null) {
  const filename = path.basename(String(filePath || "").replace(/\\/g, "/"));
  const extension = path.extname(filename);
  const stem = filename.slice(0, filename.length - extension.length).trim() || "Untitled video";
  if (!Number.isFinite(maximumLength) || maximumLength < 1) return stem;
  return Array.from(stem).slice(0, maximumLength).join("").trimEnd();
}

function safeProfileName(value) {
  return String(value || "")
    .trim()
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, 48);
}

function safeWorkspaceName(value) {
  return String(value || "")
    .trim()
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, 36);
}

module.exports = {
  VIDEO_EXTENSIONS,
  IMAGE_EXTENSIONS,
  PLATFORMS,
  DAILY_UPLOAD_LIMIT,
  MAX_DAILY_UPLOAD_LIMIT,
  UPLOAD_WINDOW_MS,
  normalizeDailyUploadLimit,
  normalizePlatform,
  normalizeSettings,
  isSupportedVideo,
  isSupportedImage,
  naturalCompare,
  videoTitleFromPath,
  safeProfileName,
  safeWorkspaceName
};
