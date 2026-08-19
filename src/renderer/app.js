const api = window.reelQueue;

const elements = Object.fromEntries(
  [
    "platformNav", "statusDot", "statusTitle", "countdown", "notice", "workspaceTabs", "addWorkspaceButton",
    "removeWorkspaceButton", "workspaceDescription", "setupTitle", "profileSelect", "openLoginButton",
    "addProfileButton", "removeProfileButton", "intervalInput", "intervalUnitSelect", "intervalHelp", "randomIntervalEnabled",
    "randomIntervalRange", "randomIntervalMinInput", "randomIntervalMaxInput", "randomIntervalUnitSelect", "folderPath", "folderButton",
    "folderHelp", "thumbnailField", "thumbnailModeSelect", "thumbnailPath", "thumbnailButton", "thumbnailClearButton",
    "thumbnailHelp", "captionField", "captionLabel", "captionInput", "captionCount", "saveCaptionButton", "captionPool",
    "youtubeTitleField", "youtubeTitleInput", "youtubeTitleCount", "youtubeDescriptionField", "youtubeDescriptionInput",
    "youtubeDescriptionCount", "saveDescriptionButton", "descriptionPool", "privacyField",
    "privacySelect", "privacyHelp", "madeForKidsField", "madeForKidsInput", "postedHelp", "safetyCopy",
    "dailyLimitEnabled", "dailyLimitControls", "dailyLimitInput", "resetDailyLimitButton",
    "runMessage", "queueCount", "dailyUploadCount", "dailyUploadProgress", "dailyUploadRemaining",
    "currentFileBlock", "currentFile", "startButton", "stopButton",
    "activityList", "openDiagnosticsButton", "clearLogButton", "profileDialog", "profileDialogCopy",
    "profileNameInput", "profileError", "createProfileButton", "workspaceDialog", "workspaceDialogCopy",
    "workspaceNameInput", "workspaceError", "createWorkspaceButton"
  ].map((id) => [id, document.getElementById(id)])
);

const platformNames = { instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok" };
const idleStatus = (workspaceId, platform = "instagram") => ({ workspaceId, platform, running: false, mode: "idle", message: "Ready", queueCount: 0, nextRunAt: null });
let profiles = [];
let workspaces = [];
let statuses = {};
let activePlatform = "instagram";
let activeWorkspaceId = "";
const lastWorkspaceByPlatform = {};
let countdownTimer;

function platformName() { return platformNames[activePlatform]; }
function platformAccountLabel() { return activePlatform === "instagram" ? "an Instagram" : `a ${platformName()}`; }
function platformWorkspaces() { return workspaces.filter((workspace) => workspace.platform === activePlatform); }
function platformProfiles() {
  const reservedElsewhere = new Set(
    workspaces
      .filter((workspace) => workspace.platform === activePlatform && workspace.id !== activeWorkspaceId)
      .map((workspace) => workspace.settings.profileId)
      .filter(Boolean)
  );
  return profiles.filter((profile) => profile.platform === activePlatform && !reservedElsewhere.has(profile.id));
}
function activeWorkspace() { return workspaces.find((workspace) => workspace.id === activeWorkspaceId) || null; }
function activeStatus() { return statuses[activeWorkspaceId] || idleStatus(activeWorkspaceId, activePlatform); }
function minutesFromControl(value, unit) {
  const amount = Number(value);
  return unit === "seconds" ? amount / 60 : amount;
}
function controlValueFromMinutes(minutes, unit) {
  return unit === "seconds" ? Math.round(Number(minutes) * 60) : Number(minutes);
}
function convertControlUnit(input, previousUnit, nextUnit) {
  const minutes = minutesFromControl(input.value, previousUnit);
  input.value = controlValueFromMinutes(minutes, nextUnit);
}

function settingsFromForm() {
  const workspaceSettings = activeWorkspace()?.settings || {};
  const thumbnailMode = elements.thumbnailModeSelect.value;
  const base = {
    profileId: elements.profileSelect.value,
    videoFolder: elements.folderPath.value,
    thumbnailMode,
    thumbnailPath: thumbnailMode === "single" ? elements.thumbnailPath.value : (workspaceSettings.thumbnailPath || ""),
    thumbnailFolder: thumbnailMode === "folder" ? elements.thumbnailPath.value : (workspaceSettings.thumbnailFolder || ""),
    caption: elements.captionInput.value,
    savedCaptions: workspaceSettings.savedCaptions || [],
    intervalMinutes: minutesFromControl(elements.intervalInput.value, elements.intervalUnitSelect.value),
    intervalUnit: elements.intervalUnitSelect.value,
    randomIntervalEnabled: elements.randomIntervalEnabled.checked,
    randomIntervalMinMinutes: minutesFromControl(elements.randomIntervalMinInput.value, elements.randomIntervalUnitSelect.value),
    randomIntervalMaxMinutes: minutesFromControl(elements.randomIntervalMaxInput.value, elements.randomIntervalUnitSelect.value),
    randomIntervalUnit: elements.randomIntervalUnitSelect.value,
    dailyLimitEnabled: elements.dailyLimitEnabled.checked,
    dailyUploadLimit: elements.dailyLimitInput.value
  };
  if (activePlatform === "youtube") {
    return {
      ...base,
      title: elements.youtubeTitleInput.value,
      description: elements.youtubeDescriptionInput.value,
      savedDescriptions: workspaceSettings.savedDescriptions || [],
      privacy: elements.privacySelect.value,
      madeForKids: elements.madeForKidsInput.checked
    };
  }
  if (activePlatform === "tiktok") return { ...base, privacy: elements.privacySelect.value };
  return base;
}

function showNotice(message, type = "error") {
  elements.notice.textContent = message;
  elements.notice.className = type === "info" ? "notice info" : "notice";
  elements.notice.hidden = false;
}

function hideNotice() { elements.notice.hidden = true; elements.notice.textContent = ""; }
function errorMessage(error) { return error?.message || String(error || "Something went wrong."); }
function formatCounterDuration(milliseconds) {
  const totalMinutes = Math.max(0, Math.ceil(milliseconds / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function renderDailyUploadAllowance(status, now = Date.now()) {
  const settings = activeWorkspace()?.settings || {};
  const enabled = typeof status.dailyLimitEnabled === "boolean"
    ? status.dailyLimitEnabled
    : settings.dailyLimitEnabled !== false;
  const dailyLimit = Math.max(1, Number(status.dailyUploadLimit) || Number(settings.dailyUploadLimit) || 22);
  const resetAt = Number(status.dailyUploadResetAt) || 0;
  const resetComplete = resetAt > 0 && resetAt <= now;
  const dailyCount = resetComplete ? 0 : Math.max(0, Number(status.dailyUploadCount) || 0);
  const dailyRemaining = Math.max(0, dailyLimit - dailyCount);
  if (!enabled) {
    elements.dailyUploadCount.textContent = "Off";
    elements.dailyUploadProgress.max = 1;
    elements.dailyUploadProgress.value = 0;
    elements.dailyUploadProgress.textContent = "Upload limit disabled";
    elements.dailyUploadRemaining.textContent = "No Reel Queue upload limit is active for this account";
    return;
  }
  elements.dailyUploadCount.textContent = `${dailyCount} / ${dailyLimit}`;
  elements.dailyUploadProgress.max = dailyLimit;
  elements.dailyUploadProgress.value = Math.min(dailyLimit, dailyCount);
  elements.dailyUploadProgress.textContent = `${dailyCount} of ${dailyLimit}`;
  if (resetAt > now && dailyRemaining === 0) {
    elements.dailyUploadRemaining.textContent = `Cooldown active — ${formatCounterDuration(resetAt - now)} remaining`;
  } else {
    elements.dailyUploadRemaining.textContent = `${dailyRemaining} upload${dailyRemaining === 1 ? "" : "s"} available before cooldown`;
  }
}

function syncDailyLimitControls(running = activeStatus().running) {
  const enabled = elements.dailyLimitEnabled.checked;
  elements.dailyLimitEnabled.disabled = running;
  elements.dailyLimitInput.disabled = running || !enabled;
  elements.resetDailyLimitButton.disabled = !elements.profileSelect.value;
}

function renderTextPool(container, items, settingName) {
  container.replaceChildren();
  items.forEach((value, index) => {
    const row = document.createElement("div");
    row.className = "text-pool-item";
    const text = document.createElement("span");
    text.textContent = value;
    text.title = value;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "text-button danger-text";
    remove.textContent = "Remove";
    remove.disabled = activeStatus().running;
    remove.addEventListener("click", async () => {
      const workspace = activeWorkspace();
      workspace.settings[settingName] = (workspace.settings[settingName] || []).filter((_entry, itemIndex) => itemIndex !== index);
      renderTextPools();
      await saveQuietly();
    });
    row.append(text, remove);
    container.append(row);
  });
}

function renderTextPools() {
  const settings = activeWorkspace()?.settings || {};
  renderTextPool(elements.captionPool, settings.savedCaptions || [], "savedCaptions");
  renderTextPool(elements.descriptionPool, settings.savedDescriptions || [], "savedDescriptions");
}

function syncScheduleControls(running = activeStatus().running) {
  const enabled = elements.randomIntervalEnabled.checked;
  const fixedMaximum = elements.intervalUnitSelect.value === "seconds" ? 86400 : 1440;
  const randomMaximum = elements.randomIntervalUnitSelect.value === "seconds" ? 86400 : 1440;
  elements.intervalInput.max = String(fixedMaximum);
  elements.randomIntervalMinInput.max = String(randomMaximum);
  elements.randomIntervalMaxInput.max = String(randomMaximum);
  elements.randomIntervalRange.hidden = !enabled;
  elements.intervalInput.disabled = running || enabled;
  elements.intervalUnitSelect.disabled = running || enabled;
  elements.randomIntervalEnabled.disabled = running;
  elements.randomIntervalMinInput.disabled = running || !enabled;
  elements.randomIntervalMaxInput.disabled = running || !enabled;
  elements.randomIntervalUnitSelect.disabled = running || !enabled;
}

function syncThumbnailControls(running = activeStatus().running) {
  const mode = elements.thumbnailModeSelect.value;
  const settings = activeWorkspace()?.settings || {};
  elements.thumbnailPath.value = mode === "single" ? (settings.thumbnailPath || "")
    : mode === "folder" ? (settings.thumbnailFolder || "") : "";
  elements.thumbnailPath.placeholder = mode === "automatic" ? "Instagram will choose automatically"
    : mode === "folder" ? "No thumbnail folder selected" : "No image selected";
  elements.thumbnailButton.textContent = mode === "folder" ? "Choose folder" : "Choose image";
  elements.thumbnailButton.hidden = mode === "automatic";
  elements.thumbnailClearButton.hidden = mode === "automatic";
  elements.thumbnailModeSelect.disabled = running;
  elements.thumbnailButton.disabled = running;
  elements.thumbnailClearButton.disabled = running || !elements.thumbnailPath.value;
  elements.thumbnailHelp.textContent = mode === "automatic"
    ? "No image is required. Instagram will choose a frame from the video."
    : mode === "folder"
      ? "For every Reel, one supported image is chosen randomly from this folder."
      : "The selected image is used for every Reel.";
}
function statusClass(status) {
  if (status.mode === "error" || status.mode === "login-required") return "error";
  if (status.running || status.mode === "stopping") return "running";
  if (status.mode === "complete") return "complete";
  return "";
}

function renderPlatformNav() {
  elements.platformNav.querySelectorAll("[data-platform]").forEach((button) => {
    const selected = button.dataset.platform === activePlatform;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
    const running = workspaces.some((workspace) => workspace.platform === button.dataset.platform && statuses[workspace.id]?.running);
    button.classList.toggle("running", running);
  });
}

function renderTabs() {
  elements.workspaceTabs.replaceChildren();
  platformWorkspaces().forEach((workspace) => {
    const status = statuses[workspace.id] || idleStatus(workspace.id, workspace.platform);
    const button = document.createElement("button");
    button.type = "button";
    button.role = "tab";
    button.className = `workspace-tab ${workspace.id === activeWorkspaceId ? "active" : ""}`;
    button.setAttribute("aria-selected", String(workspace.id === activeWorkspaceId));
    button.dataset.workspaceId = workspace.id;

    const dot = document.createElement("span");
    dot.className = `workspace-dot ${statusClass(status)}`;
    const name = document.createElement("span");
    name.className = "workspace-name";
    name.textContent = workspace.name;
    const count = document.createElement("span");
    count.className = "workspace-count";
    count.textContent = status.running ? String(status.queueCount || 0) : "";
    button.append(dot, name, count);
    button.addEventListener("click", () => switchWorkspace(workspace.id));
    elements.workspaceTabs.append(button);
  });
  renderPlatformNav();
}

function renderProfiles(selectedId = "") {
  const status = activeStatus();
  const available = platformProfiles();
  elements.profileSelect.replaceChildren();
  elements.profileSelect.append(new Option(available.length ? `Choose ${platformAccountLabel()} account` : "Add an account profile", ""));
  available.forEach((profile) => elements.profileSelect.append(new Option(profile.name, profile.id)));
  if (selectedId && available.some((profile) => profile.id === selectedId)) elements.profileSelect.value = selectedId;
  elements.removeProfileButton.disabled = !elements.profileSelect.value || status.running;
  elements.openLoginButton.disabled = !elements.profileSelect.value || status.running;
}

function configurePlatformFields() {
  const name = platformName();
  elements.setupTitle.textContent = `${name} posting setup`;
  elements.openLoginButton.textContent = `Open ${name} login`;
  elements.thumbnailField.hidden = activePlatform !== "instagram";
  elements.captionField.hidden = activePlatform !== "instagram";
  elements.youtubeTitleField.hidden = true;
  elements.youtubeDescriptionField.hidden = activePlatform !== "youtube";
  elements.privacyField.hidden = activePlatform === "instagram";
  elements.madeForKidsField.hidden = activePlatform !== "youtube";

  if (activePlatform === "youtube") {
    elements.privacySelect.replaceChildren(new Option("Public", "public"), new Option("Unlisted", "unlisted"), new Option("Private", "private"));
    elements.privacyHelp.textContent = "The selected visibility is applied to every Short in this queue.";
    elements.folderHelp.textContent = "Each Short title comes from its filename without the extension and is trimmed to 100 characters. MKVs are GPU-optimized into smaller uploads when needed. YouTube selects a video frame as the thumbnail. Shorts must be square or vertical and no longer than 3 minutes.";
  } else if (activePlatform === "tiktok") {
    elements.privacySelect.replaceChildren(new Option("Public", "public"), new Option("Friends", "friends"), new Option("Only you", "private"));
    elements.privacyHelp.textContent = "The selected audience is applied to every TikTok in this queue.";
    elements.folderHelp.textContent = "Each TikTok caption comes from its filename without the extension. TikTok selects a video frame as the cover. MKVs are GPU-optimized into smaller, faster-uploading MP4s when needed.";
  } else {
    elements.captionLabel.textContent = "Caption";
    elements.captionInput.placeholder = "Write the caption used for every Reel";
    elements.folderHelp.textContent = "MKVs are remuxed instantly when possible or GPU-optimized into smaller, faster-uploading MP4s. Instagram's Original crop is selected before posting.";
  }
  elements.intervalHelp.textContent = `The timer starts after ${name} confirms a successful post. Use 0 for no delay.`;
  elements.postedHelp.textContent = `After ${name} confirms the post, the original moves into the folder named posted.`;
  elements.safetyCopy.textContent = `If ${name} requests login or verification, the queue pauses and keeps the source video.`;
}

function populateForm() {
  const workspace = activeWorkspace();
  if (!workspace) return;
  configurePlatformFields();
  const settings = workspace.settings;
  renderProfiles(settings.profileId);
  elements.folderPath.value = settings.videoFolder || "";
  elements.thumbnailPath.value = settings.thumbnailPath || "";
  elements.captionInput.value = settings.caption || "";
  elements.captionCount.textContent = `${elements.captionInput.value.length} / 2200`;
  elements.youtubeTitleInput.value = settings.title || "";
  elements.youtubeTitleCount.textContent = `${elements.youtubeTitleInput.value.length} / 100`;
  elements.youtubeDescriptionInput.value = settings.description || "";
  elements.youtubeDescriptionCount.textContent = `${elements.youtubeDescriptionInput.value.length} / 5000`;
  elements.privacySelect.value = settings.privacy || "public";
  elements.madeForKidsInput.checked = Boolean(settings.madeForKids);
  elements.intervalUnitSelect.value = settings.intervalUnit || "minutes";
  elements.intervalUnitSelect.dataset.previousUnit = elements.intervalUnitSelect.value;
  elements.intervalInput.value = controlValueFromMinutes(settings.intervalMinutes, elements.intervalUnitSelect.value);
  elements.randomIntervalEnabled.checked = Boolean(settings.randomIntervalEnabled);
  elements.randomIntervalUnitSelect.value = settings.randomIntervalUnit || "minutes";
  elements.randomIntervalUnitSelect.dataset.previousUnit = elements.randomIntervalUnitSelect.value;
  elements.randomIntervalMinInput.value = controlValueFromMinutes(settings.randomIntervalMinMinutes, elements.randomIntervalUnitSelect.value);
  elements.randomIntervalMaxInput.value = controlValueFromMinutes(settings.randomIntervalMaxMinutes, elements.randomIntervalUnitSelect.value);
  elements.dailyLimitEnabled.checked = settings.dailyLimitEnabled !== false;
  elements.dailyLimitInput.value = settings.dailyUploadLimit || 22;
  elements.thumbnailModeSelect.value = settings.thumbnailMode || (settings.thumbnailPath ? "single" : "automatic");
  renderTextPools();
  syncThumbnailControls();
  syncScheduleControls();
  syncDailyLimitControls();
  elements.workspaceDescription.textContent = `${workspace.name} has its own ${platformName()} account, folder, content details, and posting timer.`;
  renderStatus(activeStatus());
  renderActivity();
}

function renderStatus(status) {
  if (status.workspaceId && status.workspaceId !== activeWorkspaceId) { renderTabs(); return; }
  const workspace = activeWorkspace();
  if (!workspace) return;
  const running = Boolean(status.running);
  elements.statusTitle.textContent = `${platformName()} · ${workspace.name}: ${status.message || "Ready"}`;
  elements.runMessage.textContent = status.message || "Ready";
  elements.queueCount.textContent = String(status.queueCount || 0);
  renderDailyUploadAllowance(status);
  elements.statusDot.className = `status-dot ${statusClass(status)}`;
  elements.startButton.disabled = running;
  elements.stopButton.disabled = !running || status.stopRequested;
  elements.openLoginButton.disabled = running || !elements.profileSelect.value;
  elements.removeProfileButton.disabled = running || !elements.profileSelect.value;
  elements.removeWorkspaceButton.disabled = running || platformWorkspaces().length <= 1;

  [elements.profileSelect, elements.folderButton, elements.captionInput, elements.saveCaptionButton,
    elements.youtubeTitleInput, elements.youtubeDescriptionInput, elements.saveDescriptionButton,
    elements.privacySelect, elements.madeForKidsInput]
    .forEach((control) => { control.disabled = running; });
  syncScheduleControls(running);
  syncDailyLimitControls(running);
  syncThumbnailControls(running);
  renderTextPools();

  if (status.currentFile) {
    elements.currentFile.textContent = status.currentFile.split(/[\\/]/).pop();
    elements.currentFile.title = status.currentFile;
    elements.currentFileBlock.hidden = false;
  } else elements.currentFileBlock.hidden = true;

  window.clearInterval(countdownTimer);
  const updateCountdown = () => {
    renderDailyUploadAllowance(status);
    if (!status.nextRunAt) { elements.countdown.textContent = ""; return; }
    const remaining = Math.max(0, status.nextRunAt - Date.now());
    const minutes = Math.floor(remaining / 60_000);
    const seconds = Math.floor((remaining % 60_000) / 1000);
    elements.countdown.textContent = `Next post in ${minutes}:${String(seconds).padStart(2, "0")}`;
  };
  updateCountdown();
  if (status.nextRunAt || Number(status.dailyUploadResetAt) > Date.now()) {
    countdownTimer = window.setInterval(updateCountdown, 1000);
  }
  renderTabs();
}

function buildLogRow(entry) {
  const row = document.createElement("div");
  row.className = "activity-entry";
  row.dataset.level = entry.level;
  const time = document.createElement("time");
  time.dateTime = entry.at;
  time.textContent = new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const level = document.createElement("span");
  level.className = "activity-level";
  level.textContent = entry.level;
  const message = document.createElement("span");
  message.textContent = entry.message;
  row.append(time, level, message);
  return row;
}

function renderActivity() {
  const workspace = activeWorkspace();
  elements.activityList.replaceChildren();
  const entries = workspace?.activity || [];
  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No activity yet for this queue.";
    elements.activityList.append(empty);
    return;
  }
  entries.slice(-100).reverse().forEach((entry) => elements.activityList.append(buildLogRow(entry)));
}

function appendLog(entry) {
  const workspace = workspaces.find((candidate) => candidate.id === entry.workspaceId) || activeWorkspace();
  if (!workspace) return;
  workspace.activity ||= [];
  workspace.activity.push(entry);
  if (workspace.id === activeWorkspaceId) renderActivity();
}

async function saveQuietly() {
  const workspace = activeWorkspace();
  if (!workspace || activeStatus().running) return;
  workspace.settings = settingsFromForm();
  try {
    workspace.settings = await api.saveWorkspace(workspace.id, workspace.settings);
    statuses[workspace.id] = await api.getWorkspaceStatus(workspace.id);
    renderDailyUploadAllowance(activeStatus());
  }
  catch (error) { showNotice(errorMessage(error)); }
}

function switchWorkspace(id) {
  if (id === activeWorkspaceId) return;
  if (activeWorkspace() && !activeStatus().running) activeWorkspace().settings = settingsFromForm();
  activeWorkspaceId = id;
  lastWorkspaceByPlatform[activePlatform] = id;
  hideNotice();
  populateForm();
}

async function switchPlatform(platform) {
  if (platform === activePlatform) return;
  await saveQuietly();
  activePlatform = platform;
  const available = platformWorkspaces();
  activeWorkspaceId = available.some((workspace) => workspace.id === lastWorkspaceByPlatform[platform])
    ? lastWorkspaceByPlatform[platform]
    : available[0]?.id || "";
  hideNotice();
  renderTabs();
  populateForm();
}

elements.platformNav.addEventListener("click", (event) => {
  const button = event.target.closest("[data-platform]");
  if (button) switchPlatform(button.dataset.platform);
});
elements.captionInput.addEventListener("input", () => { elements.captionCount.textContent = `${elements.captionInput.value.length} / 2200`; });
elements.youtubeTitleInput.addEventListener("input", () => { elements.youtubeTitleCount.textContent = `${elements.youtubeTitleInput.value.length} / 100`; });
elements.youtubeDescriptionInput.addEventListener("input", () => { elements.youtubeDescriptionCount.textContent = `${elements.youtubeDescriptionInput.value.length} / 5000`; });
elements.folderButton.addEventListener("click", async () => { const selected = await api.chooseVideoFolder(); if (selected) { elements.folderPath.value = selected; await saveQuietly(); } });
elements.thumbnailButton.addEventListener("click", async () => {
  const selected = elements.thumbnailModeSelect.value === "folder" ? await api.chooseThumbnailFolder() : await api.chooseThumbnail();
  if (selected) {
    elements.thumbnailPath.value = selected;
    if (elements.thumbnailModeSelect.value === "folder") activeWorkspace().settings.thumbnailFolder = selected;
    else activeWorkspace().settings.thumbnailPath = selected;
    syncThumbnailControls();
    await saveQuietly();
  }
});
elements.thumbnailModeSelect.addEventListener("change", async () => { syncThumbnailControls(); await saveQuietly(); });
elements.thumbnailClearButton.addEventListener("click", async () => {
  if (elements.thumbnailModeSelect.value === "folder") activeWorkspace().settings.thumbnailFolder = "";
  else activeWorkspace().settings.thumbnailPath = "";
  syncThumbnailControls();
  await saveQuietly();
});
elements.randomIntervalEnabled.addEventListener("change", async () => { syncScheduleControls(); await saveQuietly(); });
elements.dailyLimitEnabled.addEventListener("change", async () => { syncDailyLimitControls(); await saveQuietly(); });
elements.intervalUnitSelect.addEventListener("change", async () => {
  convertControlUnit(elements.intervalInput, elements.intervalUnitSelect.dataset.previousUnit || "minutes", elements.intervalUnitSelect.value);
  elements.intervalUnitSelect.dataset.previousUnit = elements.intervalUnitSelect.value;
  syncScheduleControls();
  await saveQuietly();
});
elements.randomIntervalUnitSelect.addEventListener("change", async () => {
  const previousUnit = elements.randomIntervalUnitSelect.dataset.previousUnit || "minutes";
  const nextUnit = elements.randomIntervalUnitSelect.value;
  convertControlUnit(elements.randomIntervalMinInput, previousUnit, nextUnit);
  convertControlUnit(elements.randomIntervalMaxInput, previousUnit, nextUnit);
  elements.randomIntervalUnitSelect.dataset.previousUnit = nextUnit;
  syncScheduleControls();
  await saveQuietly();
});
elements.saveCaptionButton.addEventListener("click", async () => {
  const value = elements.captionInput.value.trim();
  if (!value) return showNotice("Write a caption before saving it.");
  const pool = activeWorkspace().settings.savedCaptions || [];
  if (!pool.includes(value)) pool.push(value);
  activeWorkspace().settings.savedCaptions = pool;
  elements.captionInput.value = "";
  elements.captionCount.textContent = "0 / 2200";
  renderTextPools();
  await saveQuietly();
});
elements.saveDescriptionButton.addEventListener("click", async () => {
  const value = elements.youtubeDescriptionInput.value.trim();
  if (!value) return showNotice("Write a description before saving it.");
  const pool = activeWorkspace().settings.savedDescriptions || [];
  if (!pool.includes(value)) pool.push(value);
  activeWorkspace().settings.savedDescriptions = pool;
  elements.youtubeDescriptionInput.value = "";
  elements.youtubeDescriptionCount.textContent = "0 / 5000";
  renderTextPools();
  await saveQuietly();
});
elements.profileSelect.addEventListener("change", async () => { renderProfiles(elements.profileSelect.value); syncDailyLimitControls(); await saveQuietly(); });
[elements.intervalInput, elements.randomIntervalMinInput, elements.randomIntervalMaxInput, elements.captionInput,
  elements.youtubeTitleInput, elements.youtubeDescriptionInput, elements.privacySelect, elements.madeForKidsInput,
  elements.dailyLimitInput]
  .forEach((control) => control.addEventListener("change", saveQuietly));

elements.addWorkspaceButton.addEventListener("click", () => {
  elements.workspaceNameInput.value = "";
  elements.workspaceError.hidden = true;
  elements.workspaceDialogCopy.textContent = `This queue will create a fresh ${platformName()} account session with no cookies or login from another queue.`;
  elements.workspaceDialog.showModal();
  elements.workspaceNameInput.focus();
});
elements.createWorkspaceButton.addEventListener("click", async () => {
  elements.workspaceError.hidden = true;
  try {
    const created = await api.createWorkspace(activePlatform, elements.workspaceNameInput.value);
    const workspace = created.workspace;
    profiles.push(created.profile);
    workspace.activity = [];
    workspaces.push(workspace);
    statuses[workspace.id] = idleStatus(workspace.id, activePlatform);
    activeWorkspaceId = workspace.id;
    lastWorkspaceByPlatform[activePlatform] = workspace.id;
    elements.workspaceDialog.close();
    renderTabs();
    populateForm();
    try {
      await api.openLogin(created.profile.id, activePlatform);
      showNotice(`Fresh ${platformName()} Chrome session opened for ${workspace.name}. Sign in there once.`, "info");
    } catch (error) {
      showNotice(`The fresh account session was created, but Chrome could not open: ${errorMessage(error)}`);
    }
  } catch (error) { elements.workspaceError.textContent = errorMessage(error); elements.workspaceError.hidden = false; }
});
elements.removeWorkspaceButton.addEventListener("click", async () => {
  const workspace = activeWorkspace();
  if (!workspace || !window.confirm(`Remove the ${workspace.name} queue tab? Its videos and ${platformName()} account remain untouched.`)) return;
  try {
    await api.removeWorkspace(workspace.id);
    workspaces = workspaces.filter((candidate) => candidate.id !== workspace.id);
    delete statuses[workspace.id];
    activeWorkspaceId = platformWorkspaces()[0]?.id || "";
    lastWorkspaceByPlatform[activePlatform] = activeWorkspaceId;
    renderTabs();
    populateForm();
  } catch (error) { showNotice(errorMessage(error)); }
});

elements.addProfileButton.addEventListener("click", () => {
  elements.profileNameInput.value = "";
  elements.profileError.hidden = true;
  elements.profileDialogCopy.textContent = `Create a separate Chrome session for a ${platformName()} account.`;
  elements.profileDialog.showModal();
  elements.profileNameInput.focus();
});
elements.createProfileButton.addEventListener("click", async () => {
  elements.profileError.hidden = true;
  try {
    const profile = await api.createProfile(activePlatform, elements.profileNameInput.value);
    profiles.push(profile);
    renderProfiles(profile.id);
    await saveQuietly();
    elements.profileDialog.close();
    await api.openLogin(profile.id, activePlatform);
    showNotice(`Fresh ${platformName()} Chrome session opened. Sign in there once.`, "info");
  } catch (error) { elements.profileError.textContent = errorMessage(error); elements.profileError.hidden = false; }
});
elements.removeProfileButton.addEventListener("click", async () => {
  const id = elements.profileSelect.value;
  const profile = profiles.find((candidate) => candidate.id === id);
  if (!profile || !window.confirm(`Remove ${profile.name} and its saved Chrome session?`)) return;
  try {
    await api.removeProfile(id);
    profiles = profiles.filter((candidate) => candidate.id !== id);
    workspaces.forEach((workspace) => { if (workspace.settings.profileId === id) workspace.settings.profileId = ""; });
    renderProfiles();
    await saveQuietly();
  } catch (error) { showNotice(errorMessage(error)); }
});
elements.openLoginButton.addEventListener("click", async () => {
  hideNotice();
  try {
    await api.openLogin(elements.profileSelect.value, activePlatform);
    showNotice(`Chrome is open. Sign into ${platformName()} in that window, then return here.`, "info");
  } catch (error) { showNotice(errorMessage(error)); }
});
elements.startButton.addEventListener("click", async () => {
  hideNotice();
  const workspace = activeWorkspace();
  try {
    workspace.settings = settingsFromForm();
    statuses[workspace.id] = await api.start(workspace.id, workspace.settings);
    renderStatus(statuses[workspace.id]);
  } catch (error) { showNotice(errorMessage(error)); }
});
elements.stopButton.addEventListener("click", async () => {
  try { statuses[activeWorkspaceId] = await api.stop(activeWorkspaceId); renderStatus(statuses[activeWorkspaceId]); }
  catch (error) { showNotice(errorMessage(error)); }
});
elements.resetDailyLimitButton.addEventListener("click", async () => {
  const workspace = activeWorkspace();
  const profile = profiles.find((candidate) => candidate.id === elements.profileSelect.value);
  if (!workspace || !profile) return showNotice("Choose an account profile before resetting its counter.");
  if (!window.confirm(`Reset the 24-hour upload counter for ${profile.name}? This gives it a fresh allowance immediately.`)) return;
  hideNotice();
  try {
    statuses[workspace.id] = await api.resetUploadLimit(workspace.id);
    renderStatus(statuses[workspace.id]);
    showNotice(`Upload counter reset for ${profile.name}.`, "info");
  } catch (error) { showNotice(errorMessage(error)); }
});
elements.clearLogButton.addEventListener("click", () => { const workspace = activeWorkspace(); if (workspace) workspace.activity = []; renderActivity(); });
elements.openDiagnosticsButton.addEventListener("click", async () => { const error = await api.openDiagnostics(); if (error) showNotice(errorMessage(error)); });

api.onStatus((status) => { statuses[status.workspaceId] = status; renderStatus(status); });
api.onLog((entry) => appendLog(entry));

async function initialize() {
  try {
    const data = await api.getBootstrap();
    profiles = data.profiles;
    statuses = data.statuses;
    workspaces = data.workspaces.map((workspace) => ({ ...workspace, activity: [] }));
    data.history.slice().reverse().forEach((entry) => {
      const workspace = workspaces.find((candidate) => candidate.id === entry.workspaceId) || workspaces.find((candidate) => candidate.platform === "instagram");
      if (!workspace) return;
      if (entry.status === "limit_reset") {
        workspace.activity.push({ at: entry.createdAt, level: "info", message: "The 24-hour upload counter was reset manually." });
      } else if (entry.fileName) {
        workspace.activity.push({ at: entry.createdAt, level: "success", message: `Posted ${entry.fileName}` });
      }
    });
    activeWorkspaceId = platformWorkspaces()[0]?.id || "";
    lastWorkspaceByPlatform[activePlatform] = activeWorkspaceId;
    renderTabs();
    populateForm();
  } catch (error) { showNotice(errorMessage(error)); }
}

initialize();
