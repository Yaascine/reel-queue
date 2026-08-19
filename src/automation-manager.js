const { AutomationRunner } = require("./runner");
const { normalizeSettings } = require("./shared");
const { publishReel } = require("./instagram");
const { publishYouTubeShort } = require("./youtube");
const { publishTikTok } = require("./tiktok");

const PUBLISHERS = { instagram: publishReel, youtube: publishYouTubeShort, tiktok: publishTikTok };

class AutomationManager {
  constructor({ store, chrome, emit, runnerFactory }) {
    this.store = store;
    this.chrome = chrome;
    this.emit = emit;
    this.runners = new Map();
    this.reservedProfiles = new Map();
    this.runnerFactory = runnerFactory || ((options) => new AutomationRunner(options));
  }

  async ensureRunner(workspaceId) {
    const existing = this.runners.get(workspaceId);
    if (existing) return existing;
    const workspace = await this.store.getWorkspace(workspaceId);
    if (!workspace) throw new Error("Queue not found.");
    const runner = this.runnerFactory({
      workspaceId,
      platform: workspace.platform,
      store: this.store,
      chrome: this.chrome,
      saveSettings: (settings) => this.store.saveWorkspaceSettings(workspaceId, settings),
      emit: (type, payload) => this.emit(type, payload),
      publisher: PUBLISHERS[workspace.platform]
    });
    this.runners.set(workspaceId, runner);
    return runner;
  }

  async getStatuses(workspaces = null) {
    const items = workspaces || (await this.store.listWorkspaces());
    const entries = await Promise.all(items.map(async (workspace) => {
      const runner = await this.ensureRunner(workspace.id);
      if (workspace.settings.profileId) {
        await runner.refreshUploadAllowance(workspace.settings.profileId, false, workspace.settings);
      }
      return [workspace.id, runner.getStatus()];
    }));
    return Object.fromEntries(entries);
  }

  isProfileRunning(profileId, exceptWorkspaceId = "") {
    if (!profileId) return false;
    if (this.reservedProfiles.has(profileId) && this.reservedProfiles.get(profileId) !== exceptWorkspaceId) return true;
    return [...this.runners.values()].some(
      (runner) => runner.workspaceId !== exceptWorkspaceId && runner.running && runner.profileId === profileId
    );
  }

  anyRunning() {
    return [...this.runners.values()].some((runner) => runner.running);
  }

  async start(workspaceId, inputSettings) {
    const runner = await this.ensureRunner(workspaceId);
    const settings = normalizeSettings(inputSettings, runner.platform);
    if (runner.running) throw new Error("This queue is already running.");
    if (this.isProfileRunning(settings.profileId, workspaceId)) {
      throw new Error("This account profile is already running in another queue tab. Choose a different account profile.");
    }
    this.reservedProfiles.set(settings.profileId, workspaceId);
    try {
      return await runner.start(settings);
    } finally {
      this.reservedProfiles.delete(settings.profileId);
    }
  }

  async stop(workspaceId) {
    return (await this.ensureRunner(workspaceId)).stop();
  }

  async resetUploadAllowance(workspaceId) {
    const workspace = await this.store.getWorkspace(workspaceId);
    if (!workspace) throw new Error("Queue not found.");
    if (!workspace.settings.profileId) throw new Error("Choose an account profile before resetting its counter.");
    await this.store.resetUploadAllowance(workspace.settings.profileId, {
      workspaceId,
      platform: workspace.platform
    });
    const runner = await this.ensureRunner(workspaceId);
    await runner.refreshUploadAllowance(workspace.settings.profileId, false, workspace.settings);
    const status = runner.getStatus();
    this.emit("status", status);
    const entry = await this.store.appendLog("info", "The 24-hour upload counter was reset manually.", {
      workspaceId,
      profileId: workspace.settings.profileId
    });
    this.emit("log", entry);
    return status;
  }

  async remove(workspaceId) {
    const runner = this.runners.get(workspaceId);
    if (runner?.running) throw new Error("Stop this queue before removing its tab.");
    await this.store.removeWorkspace(workspaceId);
    this.runners.delete(workspaceId);
    return true;
  }

  async stopAll() {
    await Promise.all([...this.runners.values()].map((runner) => runner.stop().catch(() => {})));
  }
}

module.exports = { AutomationManager };
