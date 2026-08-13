const test = require("node:test");
const assert = require("node:assert/strict");
const { isSupportedVideo, naturalCompare, normalizeSettings, safeProfileName } = require("../src/shared");

test("recognizes supported video extensions without case sensitivity", () => {
  assert.equal(isSupportedVideo("clip.MP4"), true);
  assert.equal(isSupportedVideo("clip.mov"), true);
  assert.equal(isSupportedVideo("clip.MKV"), true);
  assert.equal(isSupportedVideo("clip.webm"), true);
  assert.equal(isSupportedVideo("thumbnail.jpg"), false);
});

test("sorts numbered filenames naturally", () => {
  const files = ["video10.mp4", "video2.mp4", "video1.mp4"];
  assert.deepEqual(files.sort(naturalCompare), ["video1.mp4", "video2.mp4", "video10.mp4"]);
});

test("normalizes interval and caption limits", () => {
  assert.equal(normalizeSettings({ intervalMinutes: 0 }).intervalMinutes, 1);
  assert.equal(normalizeSettings({ intervalMinutes: 9999 }).intervalMinutes, 1440);
  assert.equal(normalizeSettings({ caption: "a".repeat(2300) }).caption.length, 2200);
});

test("normalizes platform-specific settings", () => {
  const youtube = normalizeSettings({ title: "x".repeat(120), description: "About", privacy: "unlisted", madeForKids: true }, "youtube");
  assert.equal(youtube.title.length, 100);
  assert.equal(youtube.privacy, "unlisted");
  assert.equal(youtube.madeForKids, true);
  const tiktok = normalizeSettings({ caption: "TikTok", privacy: "friends" }, "tiktok");
  assert.equal(tiktok.caption, "TikTok");
  assert.equal(tiktok.privacy, "friends");
});

test("sanitizes account profile names", () => {
  assert.equal(safeProfileName("  Main\u0000 Account  "), "Main Account");
  assert.equal(safeProfileName("   "), "");
});
