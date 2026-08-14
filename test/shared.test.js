const test = require("node:test");
const assert = require("node:assert/strict");
const { isSupportedImage, isSupportedVideo, naturalCompare, normalizeSettings, safeProfileName, videoTitleFromPath } = require("../src/shared");

test("recognizes supported video extensions without case sensitivity", () => {
  assert.equal(isSupportedVideo("clip.MP4"), true);
  assert.equal(isSupportedVideo("clip.mov"), true);
  assert.equal(isSupportedVideo("clip.MKV"), true);
  assert.equal(isSupportedVideo("clip.webm"), true);
  assert.equal(isSupportedVideo("thumbnail.jpg"), false);
});

test("recognizes Instagram thumbnail image formats", () => {
  assert.equal(isSupportedImage("cover.JPG"), true);
  assert.equal(isSupportedImage("cover.heic"), true);
  assert.equal(isSupportedImage("cover.gif"), false);
});

test("sorts numbered filenames naturally", () => {
  const files = ["video10.mp4", "video2.mp4", "video1.mp4"];
  assert.deepEqual(files.sort(naturalCompare), ["video1.mp4", "video2.mp4", "video10.mp4"]);
});

test("normalizes interval and caption limits", () => {
  assert.equal(normalizeSettings({ intervalMinutes: 0 }).intervalMinutes, 1);
  assert.equal(normalizeSettings({ intervalMinutes: 9999 }).intervalMinutes, 1440);
  assert.equal(normalizeSettings({ caption: "a".repeat(2300) }).caption.length, 2200);
  const random = normalizeSettings({
    randomIntervalEnabled: true,
    randomIntervalMinMinutes: 7.4,
    randomIntervalMaxMinutes: 19.6,
    savedCaptions: [" First ", "First", "Second"]
  });
  assert.equal(random.randomIntervalEnabled, true);
  assert.equal(random.randomIntervalMinMinutes, 7);
  assert.equal(random.randomIntervalMaxMinutes, 20);
  assert.deepEqual(random.savedCaptions, ["First", "Second"]);
});

test("normalizes platform-specific settings", () => {
  const youtube = normalizeSettings({ title: "x".repeat(120), description: "About", privacy: "unlisted", madeForKids: true }, "youtube");
  assert.equal(youtube.title.length, 100);
  assert.equal(youtube.privacy, "unlisted");
  assert.equal(youtube.madeForKids, true);
  assert.deepEqual(normalizeSettings({ savedDescriptions: ["One", "Two"] }, "youtube").savedDescriptions, ["One", "Two"]);
  const tiktok = normalizeSettings({ caption: "TikTok", privacy: "friends" }, "tiktok");
  assert.equal(tiktok.caption, "TikTok");
  assert.equal(tiktok.privacy, "friends");
});

test("sanitizes account profile names", () => {
  assert.equal(safeProfileName("  Main\u0000 Account  "), "Main Account");
  assert.equal(safeProfileName("   "), "");
});

test("derives a title from the filename and trims only when requested", () => {
  assert.equal(videoTitleFromPath("/clips/Great MMA Knockout.final.mkv"), "Great MMA Knockout.final");
  assert.equal(videoTitleFromPath("C:\\clips\\Funny Cat.mp4"), "Funny Cat");
  assert.equal(videoTitleFromPath("/clips/Short title.mp4", 100), "Short title");
  assert.equal(videoTitleFromPath(`/clips/${"a".repeat(120)}.mp4`, 100), "a".repeat(100));
  assert.equal(Array.from(videoTitleFromPath(`/clips/${"😀".repeat(105)}.mp4`, 100)).length, 100);
});
