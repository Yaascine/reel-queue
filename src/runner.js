const fs = require("node:fs/promises");
const path = require("node:path");
const { isSupportedVideo, naturalCompare, normalizeSettings } = require("./shared");
const { publishReel } = require("./instagram");

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

class AutomationRunner {
  constructor({ store, chrome, trashItem, emit, publisher = publishReel }) {
    this.store = store;
    this.chrome = chrome;
    this.trashItem = trashItem;
    this.emit = emit;
    this.publisher = publisher;
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
    return { running: this.running, stopRequested: this.stopRequested, ...this.state };
  }

  update(patch) {
    this.state = { ...this.state, ...patch };
    this.emit("status", this.getStatus());
  }

  async log(level, message, details = {}) {
    const entry = await this.store.appendLog(level, message, details);
    this.emit("log", entry);
  }

  async validate(settings) {
    const normalized = normalizeSettings(settings);
    const profile = await this.store.getProfile(normalized.profileId);
    if (!profile) throw new Error("Choose an account profile.");
    if (!normalized.videoFolder) throw new Error("Choose a video folder.");
    if (!normalized.thumbnailPath) throw new Error("Choose a thumbnail image.");
    if (!normalized.caption.trim()) throw new Error("Enter a caption.");

    const folderStat = await fs.stat(normalized.videoFolder).catch(() => null);
    if (!folderStat?.isDirectory()) throw new Error("The selected video folder is unavailable.");
    const thumbnailStat = await fs.stat(normalized.thumbnailPath).catch(() => null);
    if (!thumbnailStat?.isFile()) throw new Error("The selected thumbnail is unavailable.");
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
    await this.store.saveSettings(settings);
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
      this.update({ currentFile: videoPath, message: "Opening Chrome", nextRunAt: null });
      const handle = await this.chrome.open(settings.profileId);
      await this.publisher({
        page: handle.page,
        videoPath,
        thumbnailPath: settings.thumbnailPath,
        caption: settings.caption,
        screenshotRoot: this.store.screenshotRoot,
        onStep: (message) => this.update({ message })
      });

      await this.store.addHistory({
        status: "posted",
        profileId: settings.profileId,
        filePath: videoPath,
        fileName: path.basename(videoPath)
      });
      await this.log("success", `Posted ${path.basename(videoPath)}.`, { filePath: videoPath });

      if (settings.trashAfterPosting) {
        try {
          await this.trashItem(videoPath);
          await this.log("info", `Moved ${path.basename(videoPath)} to Trash.`, { filePath: videoPath });
        } catch (error) {
          await this.log("warning", `Posted successfully, but could not move the file to Trash: ${error.message}`, {
            filePath: videoPath
          });
        }
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
    await this.log("error", message, { screenshotPath: error?.screenshotPath || "" });
  }
}

module.exports = { AutomationRunner };
