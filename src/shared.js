const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v"]);

function normalizeSettings(input = {}) {
  const interval = Number(input.intervalMinutes);
  return {
    profileId: typeof input.profileId === "string" ? input.profileId : "",
    videoFolder: typeof input.videoFolder === "string" ? input.videoFolder : "",
    thumbnailPath: typeof input.thumbnailPath === "string" ? input.thumbnailPath : "",
    caption: typeof input.caption === "string" ? input.caption.slice(0, 2200) : "",
    intervalMinutes: Number.isFinite(interval) ? Math.min(1440, Math.max(1, interval)) : 20,
    trashAfterPosting: input.trashAfterPosting !== false
  };
}

function isSupportedVideo(filePath) {
  const index = filePath.lastIndexOf(".");
  if (index < 0) return false;
  return VIDEO_EXTENSIONS.has(filePath.slice(index).toLowerCase());
}

function naturalCompare(left, right) {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function safeProfileName(value) {
  return String(value || "")
    .trim()
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, 48);
}

module.exports = {
  VIDEO_EXTENSIONS,
  normalizeSettings,
  isSupportedVideo,
  naturalCompare,
  safeProfileName
};
