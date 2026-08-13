const path = require("node:path");

const VIDEO_EXTENSIONS = new Set([
  ".3g2", ".3gp", ".asf", ".avi", ".divx", ".dv", ".f4v", ".flv", ".m2ts", ".m2v",
  ".m4v", ".mkv", ".mov", ".mp4", ".mpe", ".mpeg", ".mpg", ".mts", ".mxf", ".ogv",
  ".qt", ".rm", ".rmvb", ".ts", ".vob", ".webm", ".wmv", ".y4m"
]);

const PLATFORMS = new Set(["instagram", "youtube", "tiktok"]);

function normalizePlatform(value) {
  return PLATFORMS.has(value) ? value : "instagram";
}

function normalizeSettings(input = {}, platform = "instagram") {
  const interval = Number(input.intervalMinutes);
  const normalizedPlatform = normalizePlatform(platform);
  const base = {
    profileId: typeof input.profileId === "string" ? input.profileId : "",
    videoFolder: typeof input.videoFolder === "string" ? input.videoFolder : "",
    thumbnailPath: typeof input.thumbnailPath === "string" ? input.thumbnailPath : "",
    caption: typeof input.caption === "string" ? input.caption.slice(0, 2200) : "",
    intervalMinutes: Number.isFinite(interval) ? Math.min(1440, Math.max(1, interval)) : 20
  };
  if (normalizedPlatform === "youtube") {
    return {
      ...base,
      title: typeof input.title === "string" ? input.title.slice(0, 100) : "",
      description: typeof input.description === "string" ? input.description.slice(0, 5000) : "",
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
  PLATFORMS,
  normalizePlatform,
  normalizeSettings,
  isSupportedVideo,
  naturalCompare,
  videoTitleFromPath,
  safeProfileName,
  safeWorkspaceName
};
