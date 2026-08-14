const fs = require("node:fs/promises");
const path = require("node:path");

const VIDEO_FILE_SELECTION_TIMEOUT = 300_000;
const PLAYWRIGHT_REMOTE_FILE_LIMIT = 50 * 1024 * 1024;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForAccepted(isAccepted, timeout = VIDEO_FILE_SELECTION_TIMEOUT, shouldStop = () => false) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline && !shouldStop()) {
    if (await isAccepted().catch(() => false)) return true;
    await delay(250);
  }
  return false;
}

async function setLocalFileViaCdp(input, page, videoPath) {
  const bridgeKey = `__reelQueueFileInput_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  await input.evaluate((element, key) => { globalThis[key] = element; }, bridgeKey);
  const session = await page.context().newCDPSession(page);
  try {
    const evaluation = await session.send("Runtime.evaluate", {
      expression: `globalThis[${JSON.stringify(bridgeKey)}]`,
      objectGroup: "reel-queue-file-upload"
    });
    const objectId = evaluation?.result?.objectId;
    if (!objectId) throw new Error("Chrome could not resolve the local video selector.");
    await session.send("DOM.setFileInputFiles", { files: [path.resolve(videoPath)], objectId });
  } finally {
    await session.send("Runtime.releaseObjectGroup", { objectGroup: "reel-queue-file-upload" }).catch(() => {});
    await session.detach().catch(() => {});
    await page.evaluate((key) => { delete globalThis[key]; }, bridgeKey).catch(() => {});
  }
}

async function setVideoInputFile(input, videoPath, { platform, isAccepted, page } = {}) {
  let finished = false;
  const fileSize = await fs.stat(videoPath).then((stat) => stat.size).catch(() => 0);
  const useDirectLocalPath = fileSize > PLAYWRIGHT_REMOTE_FILE_LIMIT && page;
  const selection = Promise.resolve()
    .then(() => useDirectLocalPath
      ? setLocalFileViaCdp(input, page, videoPath)
      : input.setInputFiles(videoPath, { timeout: VIDEO_FILE_SELECTION_TIMEOUT }))
    .then(() => ({ type: "selected" }))
    .catch((error) => ({ type: "error", error }))
    .finally(() => { finished = true; });

  const acceptance = isAccepted
    ? waitForAccepted(isAccepted, VIDEO_FILE_SELECTION_TIMEOUT, () => finished)
      .then((accepted) => ({ type: accepted ? "accepted" : "not-accepted" }))
    : new Promise(() => {});
  const result = await Promise.race([selection, acceptance]);

  // Some upload pages replace the file input as soon as the media is accepted.
  // Playwright can then time out against the detached input even though the next
  // upload screen is already visible. Treat that visible next screen as success.
  if (result.type === "accepted") {
    return { accepted: true, recovered: true };
  }
  if (result.type === "selected") return { accepted: true, recovered: false };

  if (isAccepted && (await isAccepted().catch(() => false))) {
    return { accepted: true, recovered: true };
  }

  const label = platform || "The platform";
  if (result.error?.name === "TimeoutError" || /timeout/i.test(result.error?.message || "")) {
    throw new Error(
      `${label} did not finish accepting the video within 5 minutes. The source video was kept; check that the file is readable and try again.`
    );
  }
  throw result.error;
}

module.exports = {
  PLAYWRIGHT_REMOTE_FILE_LIMIT,
  VIDEO_FILE_SELECTION_TIMEOUT,
  setLocalFileViaCdp,
  setVideoInputFile,
  waitForAccepted
};
