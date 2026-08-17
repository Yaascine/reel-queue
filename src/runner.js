const fs = require("node:fs/promises");
const path = require("node:path");
const { DAILY_UPLOAD_LIMIT, isSupportedImage, isSupportedVideo, naturalCompare, normalizeSettings, videoTitleFromPath } = require("./shared");
const { publishReel } = require("./instagram");
const { moveToPosted, prepareVideo } = require("./media");

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const PREPARATION_CONCURRENCY = 2;

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
  constructor({ workspaceId = "", platform = "instagram", store, chrome, emit, saveSettings, publisher = publishReel, mediaPreparer = prepareVideo, postedMover = moveToPosted, random = Math.random, now = Date.now, sleeper = sleep }) {
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
    this.now = now;
    this.sleep = sleeper;
    this.profileId = "";
    this.running = false;
    this.stopRequested = false;
    this.state = {
      mode: "idle",
      message: "Ready",
      currentFile: "",
      queueCount: 0,
      nextRunAt: null,
      dailyUploadCount: 0,
      dailyUploadLimit: DAILY_UPLOAD_LIMIT,
      preparationReady: 0,
      preparationTotal: 0
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

  async refreshUploadAllowance(profileId, emit = true) {
    const allowance = await this.store.getUploadAllowance(profileId, this.now());
    const patch = {
      dailyUploadCount: allowance.count,
      dailyUploadLimit: allowance.limit,
      dailyUploadRemaining: Math.max(0, allowance.limit - allowance.count),
      dailyUploadResetAt: allowance.nextAllowedAt
    };
    if (emit) this.update(patch);
    else this.state = { ...this.state, ...patch };
    return allowance;
  }

  async waitForUploadCapacity(settings) {
    let loggedNextAllowedAt = null;
    while (!this.stopRequested) {
      const allowance = await this.refreshUploadAllowance(settings.profileId);
      if (allowance.allowed) return true;

      const nextRunAt = Math.max(this.now() + 1000, allowance.nextAllowedAt || this.now() + 1000);
      if (loggedNextAllowedAt !== nextRunAt) {
        loggedNextAllowedAt = nextRunAt;
        await this.log(
          "warning",
          `Daily account limit reached (${allowance.count}/${allowance.limit}). The queue will resume automatically when the 24-hour cooldown ends.`
        );
      }
      this.update({
        currentFile: "",
        message: `Daily limit reached (${allowance.count}/${allowance.limit})`,
        nextRunAt
      });
      while (!this.stopRequested && this.now() < nextRunAt) {
        await this.sleep(Math.min(1000, nextRunAt - this.now()));
      }
    }
    return false;
  }

  createPreparationPipeline(videoPaths) {
    const paths = [...videoPaths];
    const pathSet = new Set(paths);
    const results = new Map();
    const waiters = new Map();
    let nextIndex = 0;
    let ready = 0;
    let stopped = false;

    const settle = (videoPath, result) => {
      results.set(videoPath, result);
      ready += 1;
      this.update({ preparationReady: ready, preparationTotal: paths.length });
      const waiter = waiters.get(videoPath);
      if (waiter) {
        waiters.delete(videoPath);
        waiter(result);
      }
    };

    const worker = async () => {
      while (!stopped && !this.stopRequested) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= paths.length) return;
        const videoPath = paths[index];
        try {
          const prepared = await this.mediaPreparer(videoPath, this.store.conversionRoot, {
            onProgress: (message) => {
              if (this.state.currentFile === videoPath) this.update({ message });
            }
          });
          settle(videoPath, { prepared });
        } catch (error) {
          settle(videoPath, { error });
        }
      }
    };

    this.update({ preparationReady: 0, preparationTotal: paths.length });
    const workers = Array.from(
      { length: Math.min(PREPARATION_CONCURRENCY, paths.length) },
      () => worker()
    );
    Promise.all(workers).catch(() => {});

    return {
      has: (videoPath) => pathSet.has(videoPath),
      take: async (videoPath) => {
        let result = results.get(videoPath);
        if (!result) {
          result = await new Promise((resolve) => waiters.set(videoPath, resolve));
        }
        if (result.error) throw result.error;
        return result.prepared;
      },
      stop: () => { stopped = true; }
    };
  }

  async runLoop(settings) {
    let preparationPipeline = null;
    try {
      while (!this.stopRequested) {
        const pending = await this.listPending(settings);
        this.update({ queueCount: pending.length });
        if (!pending.length) {
          await this.log("success", "Queue complete. No unposted videos remain.");
          this.running = false;
          this.update({ mode: "complete", message: "Queue complete", currentFile: "", nextRunAt: null });
          return;
        }
        if (!(await this.waitForUploadCapacity(settings))) break;

        const allowance = await this.refreshUploadAllowance(settings.profileId);
        const dailyCapacity = Math.max(1, allowance.limit - allowance.count);
        if (!preparationPipeline || !preparationPipeline.has(pending[0])) {
          preparationPipeline?.stop();
          const dailyBatch = pending.slice(0, dailyCapacity);
          preparationPipeline = this.createPreparationPipeline(dailyBatch);
          await this.log(
            "info",
            `Preparing up to ${dailyBatch.length} video(s) ahead with ${Math.min(PREPARATION_CONCURRENCY, dailyBatch.length)} converter worker(s).`
          );
        }

        const videoPath = pending[0];
        this.update({
          currentFile: videoPath,
          message: "Preparing video while the daily batch converts in the background",
          nextRunAt: null
        });
        let prepared;
        try {
          prepared = await preparationPipeline.take(videoPath);
        } catch (error) {
          if (this.stopRequested) break;
          throw error;
        }
        if (this.stopRequested) break;
        if (this.platform === "youtube" && (prepared.media.width > prepared.media.height || prepared.media.durationSeconds > 180)) {
          if (prepared.temporary) await fs.rm(prepared.path, { force: true }).catch(() => {});
          throw new Error("YouTube Shorts must be square or vertical and no longer than 3 minutes. The source video was kept.");
        }
        if (prepared.mode === "remuxed") {
          await this.log("info", `${prepared.cacheHit ? "Reused" : "Prepared"} ${path.basename(videoPath)} without re-encoding.`, { filePath: videoPath });
        } else if (prepared.mode === "transcoded") {
          await this.log("info", `${prepared.cacheHit ? "Reused the prepared MP4 for" : "Converted"} ${path.basename(videoPath)}.`, { filePath: videoPath });
        }

        let submissionRecorded = false;
        let publicationError = null;
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
              await this.refreshUploadAllowance(settings.profileId);
            }
          });
        } catch (error) {
          if (!submissionRecorded) throw error;
          publicationError = error;
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

        await this.refreshUploadAllowance(settings.profileId).catch(async (error) => {
          await this.log("warning", `Posted successfully, but could not refresh the account upload counter: ${error.message}`).catch(() => {});
        });

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
        if (prepared.temporary) await fs.rm(prepared.path, { force: true }).catch(() => {});

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
        const nextRunAt = this.now() + waitMilliseconds;
        this.update({
          currentFile: "",
          message: `Waiting ${formatInterval(intervalSeconds)}`,
          nextRunAt
        });

        while (!this.stopRequested && this.now() < nextRunAt) {
          await this.sleep(Math.min(1000, nextRunAt - this.now()));
        }
      }
    } finally {
      preparationPipeline?.stop();
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

module.exports = { AutomationRunner, PREPARATION_CONCURRENCY, chooseIntervalSeconds, formatInterval, randomChoice };
