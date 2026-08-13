const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { normalizeSettings, safeProfileName, safeWorkspaceName } = require("./shared");

class AppStore {
  constructor(rootDirectory) {
    this.rootDirectory = rootDirectory;
    this.settingsPath = path.join(rootDirectory, "settings.json");
    this.workspacesPath = path.join(rootDirectory, "workspaces.json");
    this.profilesPath = path.join(rootDirectory, "profiles.json");
    this.historyPath = path.join(rootDirectory, "history.json");
    this.logPath = path.join(rootDirectory, "activity.jsonl");
    this.profileRoot = path.join(rootDirectory, "browser-profiles");
    this.screenshotRoot = path.join(rootDirectory, "screenshots");
    this.conversionRoot = path.join(rootDirectory, "conversions");
    this.writeQueues = new Map();
  }

  async initialize() {
    await fs.mkdir(this.profileRoot, { recursive: true });
    await fs.mkdir(this.screenshotRoot, { recursive: true });
    await fs.mkdir(this.conversionRoot, { recursive: true });
    await this.ensureJson(this.settingsPath, normalizeSettings());
    await this.ensureJson(this.profilesPath, []);
    await this.ensureJson(this.historyPath, []);
    await this.initializeWorkspaces();
  }

  async ensureJson(filePath, fallback) {
    try {
      await fs.access(filePath);
    } catch {
      await this.writeJson(filePath, fallback);
    }
  }

  async readJson(filePath, fallback) {
    try {
      return JSON.parse(await fs.readFile(filePath, "utf8"));
    } catch {
      return fallback;
    }
  }

  async writeJson(filePath, value) {
    const temporaryPath = `${filePath}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await fs.rename(temporaryPath, filePath);
  }

  async queueWrite(filePath, operation) {
    const previous = this.writeQueues.get(filePath) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    this.writeQueues.set(filePath, current);
    try {
      return await current;
    } finally {
      if (this.writeQueues.get(filePath) === current) this.writeQueues.delete(filePath);
    }
  }

  async initializeWorkspaces() {
    try {
      await fs.access(this.workspacesPath);
    } catch {
      const legacySettings = await this.getSettings();
      await this.writeJson(this.workspacesPath, [{
        id: crypto.randomUUID(),
        name: "Queue 1",
        createdAt: new Date().toISOString(),
        settings: legacySettings
      }]);
    }
  }

  async getSettings() {
    return normalizeSettings(await this.readJson(this.settingsPath, {}));
  }

  async saveSettings(settings) {
    const normalized = normalizeSettings(settings);
    await this.writeJson(this.settingsPath, normalized);
    return normalized;
  }

  async listWorkspaces() {
    const workspaces = await this.readJson(this.workspacesPath, []);
    return workspaces
      .filter((workspace) => workspace && workspace.id && workspace.name)
      .map((workspace) => ({
        id: workspace.id,
        name: safeWorkspaceName(workspace.name) || "Untitled queue",
        createdAt: workspace.createdAt || new Date(0).toISOString(),
        settings: normalizeSettings(workspace.settings)
      }))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async getWorkspace(id) {
    return (await this.listWorkspaces()).find((workspace) => workspace.id === id) || null;
  }

  async createWorkspace(name) {
    const cleanName = safeWorkspaceName(name);
    if (!cleanName) throw new Error("Enter a queue name.");
    return this.queueWrite(this.workspacesPath, async () => {
      const workspaces = await this.listWorkspaces();
      if (workspaces.some((workspace) => workspace.name.toLowerCase() === cleanName.toLowerCase())) {
        throw new Error("A queue with that name already exists.");
      }
      const workspace = {
        id: crypto.randomUUID(),
        name: cleanName,
        createdAt: new Date().toISOString(),
        settings: normalizeSettings()
      };
      workspaces.push(workspace);
      await this.writeJson(this.workspacesPath, workspaces);
      return workspace;
    });
  }

  async saveWorkspaceSettings(id, settings) {
    return this.queueWrite(this.workspacesPath, async () => {
      const workspaces = await this.listWorkspaces();
      const workspace = workspaces.find((candidate) => candidate.id === id);
      if (!workspace) throw new Error("Queue not found.");
      workspace.settings = normalizeSettings(settings);
      await this.writeJson(this.workspacesPath, workspaces);
      return workspace.settings;
    });
  }

  async removeWorkspace(id) {
    return this.queueWrite(this.workspacesPath, async () => {
      const workspaces = await this.listWorkspaces();
      if (workspaces.length <= 1) throw new Error("Keep at least one queue tab.");
      const next = workspaces.filter((workspace) => workspace.id !== id);
      if (next.length === workspaces.length) throw new Error("Queue not found.");
      await this.writeJson(this.workspacesPath, next);
      return true;
    });
  }

  async listProfiles() {
    const profiles = await this.readJson(this.profilesPath, []);
    return profiles
      .filter((profile) => profile && profile.id && profile.name)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async createProfile(name) {
    const cleanName = safeProfileName(name);
    if (!cleanName) throw new Error("Enter an account profile name.");

    const profiles = await this.listProfiles();
    const duplicate = profiles.some((profile) => profile.name.toLowerCase() === cleanName.toLowerCase());
    if (duplicate) throw new Error("An account profile with that name already exists.");

    const profile = {
      id: crypto.randomUUID(),
      name: cleanName,
      createdAt: new Date().toISOString()
    };
    profiles.push(profile);
    await fs.mkdir(this.getProfileDirectory(profile.id), { recursive: true });
    await this.writeJson(this.profilesPath, profiles);
    return profile;
  }

  async removeProfile(id) {
    const profiles = await this.listProfiles();
    const next = profiles.filter((profile) => profile.id !== id);
    if (next.length === profiles.length) throw new Error("Account profile not found.");
    await this.writeJson(this.profilesPath, next);
    await this.queueWrite(this.workspacesPath, async () => {
      const workspaces = await this.listWorkspaces();
      let changed = false;
      for (const workspace of workspaces) {
        if (workspace.settings.profileId === id) {
          workspace.settings.profileId = "";
          changed = true;
        }
      }
      if (changed) await this.writeJson(this.workspacesPath, workspaces);
    });
    return true;
  }

  async getProfile(id) {
    return (await this.listProfiles()).find((profile) => profile.id === id) || null;
  }

  getProfileDirectory(id) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid account profile.");
    return path.join(this.profileRoot, id);
  }

  async getHistory() {
    return this.readJson(this.historyPath, []);
  }

  async hasSuccessfulPost(profileId, filePath) {
    const history = await this.getHistory();
    return history.some(
      (entry) => entry.profileId === profileId && entry.filePath === filePath && entry.status === "posted"
    );
  }

  async addHistory(entry) {
    await this.queueWrite(this.historyPath, async () => {
      const history = await this.getHistory();
      history.unshift({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...entry });
      await this.writeJson(this.historyPath, history.slice(0, 2000));
    });
  }

  async appendLog(level, message, details = {}) {
    const entry = { at: new Date().toISOString(), level, message, ...details };
    await fs.appendFile(this.logPath, `${JSON.stringify(entry)}\n`, "utf8");
    return entry;
  }
}

module.exports = { AppStore };
