const { AutomationRunner } = require("./runner");
const { normalizeSettings } = require("./shared");

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
    if (!(await this.store.getWorkspace(workspaceId))) throw new Error("Queue not found.");
    const runner = this.runnerFactory({
      workspaceId,
      store: this.store,
      chrome: this.chrome,
      saveSettings: (settings) => this.store.saveWorkspaceSettings(workspaceId, settings),
      emit: (type, payload) => this.emit(type, payload)
    });
    this.runners.set(workspaceId, runner);
    return runner;
  }

  async getStatuses(workspaces = null) {
    const items = workspaces || (await this.store.listWorkspaces());
    const entries = await Promise.all(items.map(async (workspace) => {
      const runner = await this.ensureRunner(workspace.id);
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
    const settings = normalizeSettings(inputSettings);
    const runner = await this.ensureRunner(workspaceId);
    if (runner.running) throw new Error("This queue is already running.");
    if (this.isProfileRunning(settings.profileId, workspaceId)) {
      throw new Error("This Instagram account is already running in another queue tab. Choose a different account profile.");
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
