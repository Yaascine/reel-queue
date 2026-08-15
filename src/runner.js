const fs = require("node:fs/promises");
const path = require("node:path");
const { isSupportedImage, isSupportedVideo, naturalCompare, normalizeSettings, videoTitleFromPath } = require("./shared");
const { publishReel } = require("./instagram");
const { moveToPosted, prepareVideo } = require("./media");

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function randomChoice(values, random = Math.random) {
  if (!values.length) return "";
  return values[Math.min(values.length - 1, Math.floor(random() * values.length))];
}

function chooseIntervalSeconds(settings, random = Math.random) {
  if (!settings.randomIntervalEnabled) return Math.round(settings.intervalMinutes * 60);
  const minimum = Math.round(settings.randomIntervalMinMinutes * 60);
  const maximum = Math.round(settings.randomIntervalMaxMinutes * 60);
  return minimum + Math.floor(random() * (maximum - minimum + 1));
}

function formatInterval(seconds) {
  if (seconds === 0) return "no delay";
  if (seconds < 60) return `${seconds} second(s)`;
  if (seconds % 60 === 0) return `${seconds / 60} minute(s)`;
  return `${Math.floor(seconds / 60)} minute(s) ${seconds % 60} second(s)`;
}

class AutomationRunner {
  constructor({ workspaceId = "", platform = "instagram", store, chrome, emit, saveSettings, publisher = publishReel, mediaPreparer = prepareVideo, postedMover = moveToPosted, random = Math.random }) {
    this.workspaceId = workspaceId;
    this.platform = platform;
    this.store = store;
    this.chrome = chrome;
    this.emit = emit;
    this.publisher = publisher;
    this.mediaPreparer = mediaPreparer;
    this.postedMover = postedMover;
    this.saveSettings = saveSettings || ((settings) => this.store.saveSettings(settings));
    this.random = random;
    this.profileId = "";
    this.running = false;
    this.stopRequested = false;
    this.state = {
      mode: "idle",
      message: "Ready",
      currentFile: "",
      queueCount: 0,
      nextRunAt: null
    };
  }

  getStatus() {
    return { workspaceId: this.workspaceId, platform: this.platform, running: this.running, stopRequested: this.stopRequested, ...this.state };
  }

  update(patch) {
    this.state = { ...this.state, ...patch };
    this.emit("status", this.getStatus());
  }

  async log(level, message, details = {}) {
    const entry = await this.store.appendLog(level, message, { workspaceId: this.workspaceId, ...details });
    this.emit("log", entry);
  }

  async validate(settings) {
    const normalized = normalizeSettings(settings, this.platform);
    const profile = await this.store.getProfile(normalized.profileId);
    if (!profile) throw new Error("Choose an account profile.");
    if (profile.platform && profile.platform !== this.platform) throw new Error("Choose an account profile for this platform.");
    if (!normalized.videoFolder) throw new Error("Choose a video folder.");
    if (normalized.randomIntervalEnabled && normalized.randomIntervalMinMinutes > normalized.randomIntervalMaxMinutes) {
      throw new Error("The random gap minimum cannot be greater than its maximum.");
    }
    if (this.platform === "instagram" && !normalized.caption.trim() && !normalized.savedCaptions.length) {
      throw new Error("Enter a caption or save at least one caption.");
    }

    const folderStat = await fs.stat(normalized.videoFolder).catch(() => null);
    if (!folderStat?.isDirectory()) throw new Error("The selected video folder is unavailable.");
    if (this.platform === "instagram" && normalized.thumbnailMode === "single") {
      if (!normalized.thumbnailPath) throw new Error("Choose a thumbnail image or use automatic thumbnails.");
      const thumbnailStat = await fs.stat(normalized.thumbnailPath).catch(() => null);
      if (!thumbnailStat?.isFile()) throw new Error("The selected thumbnail is unavailable.");
    }
    if (this.platform === "instagram" && normalized.thumbnailMode === "folder") {
      if (!normalized.thumbnailFolder) throw new Error("Choose a thumbnail folder or use automatic thumbnails.");
      const thumbnailFolderStat = await fs.stat(normalized.thumbnailFolder).catch(() => null);
      if (!thumbnailFolderStat?.isDirectory()) throw new Error("The selected thumbnail folder is unavailable.");
      if (!(await this.listThumbnails(normalized.thumbnailFolder)).length) {
        throw new Error("The thumbnail folder has no supported JPG, PNG, AVIF, HEIC, or HEIF images.");
      }
    }
    return normalized;
  }

  async listThumbnails(folderPath) {
    if (!folderPath) return [];
    const entries = await fs.readdir(folderPath, { withFileTypes: true }).catch(() => []);
    return entries
      .filter((entry) => entry.isFile() && isSupportedImage(entry.name))
      .map((entry) => path.join(folderPath, entry.name))
      .sort(naturalCompare);
  }

  async listPending(settings) {
    const entries = await fs.readdir(settings.videoFolder, { withFileTypes: true });
    const candidates = entries
      .filter((entry) => entry.isFile() && isSupportedVideo(entry.name))
      .map((entry) => path.join(settings.videoFolder, entry.name))
      .sort(naturalCompare);

    const pending = [];
    for (const filePath of candidates) {
      if (!(await this.store.hasSuccessfulPost(settings.profileId, filePath))) pending.push(filePath);
    }
    return pending;
  }

  async start(inputSettings) {
    if (this.running) throw new Error("Automation is already running.");
    const settings = await this.validate(inputSettings);
    await this.saveSettings(settings);
    this.profileId = settings.profileId;
    const pending = await this.listPending(settings);
    if (!pending.length) throw new Error("No unposted videos were found in the selected folder.");

    this.running = true;
    this.stopRequested = false;
    this.update({ mode: "running", message: "Starting", queueCount: pending.length, nextRunAt: null });
    await this.log("info", `Automation started with ${pending.length} video(s).`);
    this.runLoop(settings).catch(async (error) => {
      await this.finishWithError(error);
    });
    return this.getStatus();
  }

  async stop() {
    if (!this.running) return this.getStatus();
    this.stopRequested = true;
    this.update({ mode: "stopping", message: "Stopping safely after the current action", nextRunAt: null });
    await this.log("info", "Stop requested.");
    return this.getStatus();
  }

  async runLoop(settings) {
    while (!this.stopRequested) {
      const pending = await this.listPending(settings);
      this.update({ queueCount: pending.length });
      if (!pending.length) {
        await this.log("success", "Queue complete. No unposted videos remain.");
        this.running = false;
        this.update({ mode: "complete", message: "Queue complete", currentFile: "", nextRunAt: null });
        return;
      }

      const videoPath = pending[0];
      this.update({ currentFile: videoPath, message: "Checking video format", nextRunAt: null });
      const prepared = await this.mediaPreparer(videoPath, this.store.conversionRoot, {
        onProgress: (message) => this.update({ message })
      });
      if (this.platform === "youtube" && (prepared.media.width > prepared.media.height || prepared.media.durationSeconds > 180)) {
        if (prepared.temporary) await fs.rm(prepared.path, { force: true }).catch(() => {});
        throw new Error("YouTube Shorts must be square or vertical and no longer than 3 minutes. The source video was kept.");
      }
      if (prepared.mode === "remuxed") {
        await this.log("info", `Prepared ${path.basename(videoPath)} without re-encoding.`, { filePath: videoPath });
      } else if (prepared.mode === "transcoded") {
        await this.log("info", `Converted ${path.basename(videoPath)} to a high-quality MP4.`, { filePath: videoPath });
      }

      let submissionRecorded = false;
      let publicationError = null;
      try {
        const automaticTitle = videoTitleFromPath(videoPath, this.platform === "youtube" ? 100 : null);
        let thumbnailPath = settings.thumbnailMode === "single" ? settings.thumbnailPath : "";
        if (this.platform === "instagram" && settings.thumbnailMode === "folder") {
          thumbnailPath = randomChoice(await this.listThumbnails(settings.thumbnailFolder), this.random);
          if (!thumbnailPath) throw new Error("The thumbnail folder no longer contains a supported image.");
          await this.log("info", `Selected thumbnail ${path.basename(thumbnailPath)}.`, { filePath: thumbnailPath });
        }
        const caption = this.platform === "instagram" && settings.savedCaptions.length
          ? randomChoice(settings.savedCaptions, this.random)
          : this.platform === "tiktok" ? automaticTitle : settings.caption;
        const description = this.platform === "youtube" && settings.savedDescriptions.length
          ? randomChoice(settings.savedDescriptions, this.random)
          : settings.description;
        this.update({ message: "Opening Chrome" });
        const handle = await this.chrome.open(settings.profileId);
        try {
          await this.publisher({
            page: handle.page,
            videoPath: prepared.path,
            thumbnailPath,
            caption,
            title: this.platform === "youtube" ? automaticTitle : settings.title,
            description,
            privacy: settings.privacy,
            madeForKids: settings.madeForKids,
            screenshotRoot: this.store.screenshotRoot,
            onStep: (message) => this.update({ message }),
            onSubmitted: async () => {
              if (submissionRecorded) return;
              // Set this before disk I/O: if Windows blocks the history write
              // after the final platform click, the source still must not retry.
              submissionRecorded = true;
              await this.store.addHistory({
                status: "submitted",
                workspaceId: this.workspaceId,
                platform: this.platform,
                profileId: settings.profileId,
                filePath: videoPath,
                fileName: path.basename(videoPath)
              });
            }
          });
        } catch (error) {
          if (!submissionRecorded) throw error;
          publicationError = error;
        }
      } finally {
        if (prepared.temporary) await fs.rm(prepared.path, { force: true }).catch(() => {});
      }

      if (publicationError) {
        await this.log(
          "warning",
          `The platform accepted ${path.basename(videoPath)}, but its final confirmation could not be read. It will not be uploaded again.`,
          { filePath: videoPath, stage: publicationError.stage || "", details: publicationError.message }
        ).catch(() => {});
      } else {
        try {
          await this.store.addHistory({
            status: "posted",
            workspaceId: this.workspaceId,
            platform: this.platform,
            profileId: settings.profileId,
            filePath: videoPath,
            fileName: path.basename(videoPath)
          });
        } catch (error) {
          if (!submissionRecorded) throw error;
          await this.log("warning", `Posted ${path.basename(videoPath)}, but Windows temporarily blocked the final history update.`, {
            filePath: videoPath,
            details: error.message
          }).catch(() => {});
        }
        await this.log("success", `Posted ${path.basename(videoPath)}.`, { filePath: videoPath }).catch(() => {});
      }

      try {
        const destination = await this.postedMover(videoPath);
        await this.log("info", `Moved ${path.basename(videoPath)} to the posted folder.`, {
          filePath: videoPath,
          destination
        });
      } catch (error) {
        await this.log("warning", `Posted successfully, but could not move the file to the posted folder: ${error.message}`, {
          filePath: videoPath
        });
      }

      if (this.stopRequested) break;

      const remaining = await this.listPending(settings);
      this.update({ queueCount: remaining.length });
      if (!remaining.length) {
        await this.log("success", "Queue complete. No unposted videos remain.");
        this.running = false;
        this.update({ mode: "complete", message: "Queue complete", currentFile: "", nextRunAt: null });
        return;
      }

      const intervalSeconds = chooseIntervalSeconds(settings, this.random);
      if (settings.randomIntervalEnabled) {
        await this.log("info", `Random gap selected: ${formatInterval(intervalSeconds)}.`);
      }
      if (intervalSeconds === 0) {
        await this.log("info", "No gap selected. Starting the next post immediately.");
        this.update({ currentFile: "", message: "Starting next post immediately", nextRunAt: null });
        continue;
      }
      const waitMilliseconds = intervalSeconds * 1000;
      const nextRunAt = Date.now() + waitMilliseconds;
      this.update({
        currentFile: "",
        message: `Waiting ${formatInterval(intervalSeconds)}`,
        nextRunAt
      });

      while (!this.stopRequested && Date.now() < nextRunAt) {
        await sleep(Math.min(1000, nextRunAt - Date.now()));
      }
    }

    this.running = false;
    this.stopRequested = false;
    this.update({ mode: "idle", message: "Stopped", currentFile: "", nextRunAt: null });
    await this.log("info", "Automation stopped.");
  }

  async finishWithError(error) {
    this.running = false;
    this.stopRequested = false;
    const message = error?.message || "Automation stopped because of an unexpected error.";
    this.update({
      mode: error?.code === "LOGIN_REQUIRED" ? "login-required" : "error",
      message,
      nextRunAt: null
    });
    await this.log("error", message, {
      stage: error?.stage || "",
      screenshotPath: error?.screenshotPath || "",
      diagnosticPath: error?.diagnosticPath || ""
    });
  }
}

module.exports = { AutomationRunner, chooseIntervalSeconds, formatInterval, randomChoice };
