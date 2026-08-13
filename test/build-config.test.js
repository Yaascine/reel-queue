const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const packageJson = require("../package.json");

test("packages a target-native FFmpeg executable outside app.asar", () => {
  const macResource = packageJson.build.mac.extraResources.find((resource) => resource.to === "ffmpeg/ffmpeg");
  const windowsResource = packageJson.build.win.extraResources.find((resource) => resource.to === "ffmpeg/ffmpeg.exe");

  assert.equal(macResource?.from, "node_modules/ffmpeg-static/ffmpeg");
  assert.equal(windowsResource?.from, "node_modules/ffmpeg-static/ffmpeg.exe");
  assert.match(packageJson.scripts["dist:mac"], /prepare-ffmpeg\.js darwin/);
  assert.match(packageJson.scripts["dist:win"], /prepare-ffmpeg\.js win32 x64/);
});

const windowsFfmpegPath = require("node:path").join(__dirname, "..", "node_modules", "ffmpeg-static", "ffmpeg.exe");

test("the prepared Windows FFmpeg binary is not truncated", { skip: !fs.existsSync(windowsFfmpegPath) }, () => {
  const contents = fs.readFileSync(windowsFfmpegPath);
  const peOffset = contents.readUInt32LE(0x3c);
  assert.equal(contents.subarray(peOffset, peOffset + 4).toString("binary"), "PE\0\0");
  const sectionCount = contents.readUInt16LE(peOffset + 6);
  const sectionTable = peOffset + 24 + contents.readUInt16LE(peOffset + 20);
  for (let index = 0; index < sectionCount; index += 1) {
    const section = sectionTable + index * 40;
    const end = contents.readUInt32LE(section + 20) + contents.readUInt32LE(section + 16);
    assert.ok(end <= contents.length, `PE section ${index + 1} extends past end of ffmpeg.exe`);
  }
});
