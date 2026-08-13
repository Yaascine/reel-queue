const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { createGunzip } = require("node:zlib");

const platform = process.argv[2] || process.platform;
const arch = process.argv[3] || process.arch;
const supported = {
  darwin: new Set(["x64", "arm64"]),
  win32: new Set(["x64", "ia32"])
};

if (!supported[platform]?.has(arch)) {
  throw new Error(`Unsupported FFmpeg build target: ${platform}-${arch}`);
}

const packageDirectory = path.dirname(require.resolve("ffmpeg-static/package.json"));
const packageJson = require("ffmpeg-static/package.json");
const executableName = platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
const executablePath = path.join(packageDirectory, executableName);

function hasExpectedFormat(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const header = Buffer.alloc(4);
  const descriptor = fs.openSync(filePath, "r");
  try {
    fs.readSync(descriptor, header, 0, header.length, 0);
  } finally {
    fs.closeSync(descriptor);
  }

  if (platform === "win32") return header[0] === 0x4d && header[1] === 0x5a;
  const magic = header.readUInt32BE(0);
  return new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca]).has(magic);
}

async function prepare() {
  if (!hasExpectedFormat(executablePath)) {
    const metadata = packageJson[packageJson.name];
    const release = process.env[metadata["binary-release-tag-env-var"]] || metadata["binary-release-tag"];
    const baseUrl = process.env[metadata["binaries-url-env-var"]] || "https://github.com/eugeneware/ffmpeg-static/releases/download";
    const downloadUrl = `${baseUrl}/${release}/ffmpeg-${platform}-${arch}.gz`;
    const licenseUrl = `${baseUrl}/${release}/${platform}-${arch}.LICENSE`;
    const temporaryPath = `${executablePath}.download`;

    fs.rmSync(executablePath, { force: true });
    fs.rmSync(temporaryPath, { force: true });
    console.log(`Downloading FFmpeg for ${platform}-${arch}...`);
    const response = await fetch(downloadUrl, { redirect: "follow" });
    if (!response.ok || !response.body) throw new Error(`FFmpeg download failed: HTTP ${response.status}`);
    try {
      await pipeline(Readable.fromWeb(response.body), createGunzip(), fs.createWriteStream(temporaryPath));
      fs.chmodSync(temporaryPath, 0o755);
      fs.renameSync(temporaryPath, executablePath);
      const licenseResponse = await fetch(licenseUrl, { redirect: "follow" });
      if (licenseResponse.ok) fs.writeFileSync(`${executablePath}.LICENSE`, await licenseResponse.text());
    } catch (error) {
      fs.rmSync(temporaryPath, { force: true });
      throw error;
    }
  }

  if (!hasExpectedFormat(executablePath)) {
    throw new Error(`FFmpeg preparation produced an invalid ${platform}-${arch} executable at ${executablePath}`);
  }

  console.log(`FFmpeg ready for ${platform}-${arch}: ${executablePath}`);
}

prepare().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
