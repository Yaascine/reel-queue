const test = require("node:test");
const assert = require("node:assert/strict");
const packageJson = require("../package.json");

test("packages a target-native FFmpeg executable outside app.asar", () => {
  const macResource = packageJson.build.mac.extraResources.find((resource) => resource.to === "ffmpeg/ffmpeg");
  const windowsResource = packageJson.build.win.extraResources.find((resource) => resource.to === "ffmpeg/ffmpeg.exe");

  assert.equal(macResource?.from, "node_modules/ffmpeg-static/ffmpeg");
  assert.equal(windowsResource?.from, "node_modules/ffmpeg-static/ffmpeg.exe");
  assert.match(packageJson.scripts["dist:mac"], /prepare-ffmpeg\.js darwin/);
  assert.match(packageJson.scripts["dist:win"], /prepare-ffmpeg\.js win32 x64/);
});
