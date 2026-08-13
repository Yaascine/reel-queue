const fs = require("node:fs/promises");
const path = require("node:path");
const { isSupportedVideo, naturalCompare, normalizeSettings } = require("./shared");
const { publishReel } = require("./instagram");
const { moveToPosted, prepareVideo } = require("./media");

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

class AutomationRunner {
  constructor({ workspaceId = "", platform = "instagram", store, chrome, emit, saveSettings, publisher = publishReel, mediaPreparer = prepareVideo, postedMover = moveToPosted }) {
    this.workspaceId = workspaceId;
    this.platform = platform;
    this.store = store;
    this.chrome = chrome;
    this.emit = emit;
    this.publisher = publisher;
    this.mediaPreparer = mediaPreparer;
    this.postedMover = postedMover;
    this.saveSettings = saveSettings || ((settings) => this.store.saveSettings(settings));
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
    if (this.platform === "instagram" && !normalized.thumbnailPath) throw new Error("Choose a thumbnail image.");
    if (this.platform === "youtube" && !normalized.title.trim()) throw new Error("Enter a video title.");
    if (this.platform !== "youtube" && !normalized.caption.trim()) throw new Error("Enter a caption.");

    const folderStat = await fs.stat(normalized.videoFolder).catch(() => null);
    if (!folderStat?.isDirectory()) throw new Error("The selected video folder is unavailable.");
    if (this.platform === "instagram") {
      const thumbnailStat = await fs.stat(normalized.thumbnailPath).catch(() => null);
      if (!thumbnailStat?.isFile()) throw new Error("The selected thumbnail is unavailable.");
    }
    return normalized;
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

      try {
        this.update({ message: "Opening Chrome" });
        const handle = await this.chrome.open(settings.profileId);
        await this.publisher({
          page: handle.page,
          videoPath: prepared.path,
          thumbnailPath: settings.thumbnailPath,
          caption: settings.caption,
          title: settings.title,
          description: settings.description,
          privacy: settings.privacy,
          madeForKids: settings.madeForKids,
          screenshotRoot: this.store.screenshotRoot,
          onStep: (message) => this.update({ message })
        });
      } finally {
        if (prepared.temporary) await fs.rm(prepared.path, { force: true }).catch(() => {});
      }

      await this.store.addHistory({
        status: "posted",
        workspaceId: this.workspaceId,
        platform: this.platform,
        profileId: settings.profileId,
        filePath: videoPath,
        fileName: path.basename(videoPath)
      });
      await this.log("success", `Posted ${path.basename(videoPath)}.`, { filePath: videoPath });

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

      const waitMilliseconds = settings.intervalMinutes * 60_000;
      const nextRunAt = Date.now() + waitMilliseconds;
      this.update({
        currentFile: "",
        message: `Waiting ${settings.intervalMinutes} minute(s)`,
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

module.exports = { AutomationRunner };
