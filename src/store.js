const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { normalizeSettings, safeProfileName } = require("./shared");

class AppStore {
  constructor(rootDirectory) {
    this.rootDirectory = rootDirectory;
    this.settingsPath = path.join(rootDirectory, "settings.json");
    this.profilesPath = path.join(rootDirectory, "profiles.json");
    this.historyPath = path.join(rootDirectory, "history.json");
    this.logPath = path.join(rootDirectory, "activity.jsonl");
    this.profileRoot = path.join(rootDirectory, "browser-profiles");
    this.screenshotRoot = path.join(rootDirectory, "screenshots");
    this.conversionRoot = path.join(rootDirectory, "conversions");
  }

  async initialize() {
    await fs.mkdir(this.profileRoot, { recursive: true });
    await fs.mkdir(this.screenshotRoot, { recursive: true });
    await fs.mkdir(this.conversionRoot, { recursive: true });
    await this.ensureJson(this.settingsPath, normalizeSettings());
    await this.ensureJson(this.profilesPath, []);
    await this.ensureJson(this.historyPath, []);
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

  async getSettings() {
    return normalizeSettings(await this.readJson(this.settingsPath, {}));
  }

  async saveSettings(settings) {
    const normalized = normalizeSettings(settings);
    await this.writeJson(this.settingsPath, normalized);
    return normalized;
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
    const history = await this.getHistory();
    history.unshift({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...entry });
    await this.writeJson(this.historyPath, history.slice(0, 2000));
  }

  async appendLog(level, message, details = {}) {
    const entry = { at: new Date().toISOString(), level, message, ...details };
    await fs.appendFile(this.logPath, `${JSON.stringify(entry)}\n`, "utf8");
    return entry;
  }
}

module.exports = { AppStore };
