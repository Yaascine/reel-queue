const VIDEO_FILE_SELECTION_TIMEOUT = 300_000;

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

async function setVideoInputFile(input, videoPath, { platform, isAccepted } = {}) {
  let finished = false;
  const selection = input
    .setInputFiles(videoPath, { timeout: VIDEO_FILE_SELECTION_TIMEOUT })
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

module.exports = { VIDEO_FILE_SELECTION_TIMEOUT, setVideoInputFile, waitForAccepted };
