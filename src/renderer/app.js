const api = window.reelQueue;

const elements = Object.fromEntries(
  [
    "platformNav", "statusDot", "statusTitle", "countdown", "notice", "workspaceTabs", "addWorkspaceButton",
    "removeWorkspaceButton", "workspaceDescription", "setupTitle", "profileSelect", "openLoginButton",
    "addProfileButton", "removeProfileButton", "intervalInput", "intervalHelp", "folderPath", "folderButton",
    "folderHelp", "thumbnailField", "thumbnailPath", "thumbnailButton", "captionField", "captionLabel",
    "captionInput", "captionCount", "youtubeTitleField", "youtubeTitleInput", "youtubeTitleCount",
    "youtubeDescriptionField", "youtubeDescriptionInput", "youtubeDescriptionCount", "privacyField",
    "privacySelect", "privacyHelp", "madeForKidsField", "madeForKidsInput", "postedHelp", "safetyCopy",
    "runMessage", "queueCount", "currentFileBlock", "currentFile", "startButton", "stopButton",
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
function platformWorkspaces() { return workspaces.filter((workspace) => workspace.platform === activePlatform); }
function platformProfiles() { return profiles.filter((profile) => profile.platform === activePlatform); }
function activeWorkspace() { return workspaces.find((workspace) => workspace.id === activeWorkspaceId) || null; }
function activeStatus() { return statuses[activeWorkspaceId] || idleStatus(activeWorkspaceId, activePlatform); }

function settingsFromForm() {
  const base = {
    profileId: elements.profileSelect.value,
    videoFolder: elements.folderPath.value,
    thumbnailPath: elements.thumbnailPath.value,
    caption: elements.captionInput.value,
    intervalMinutes: Number(elements.intervalInput.value)
  };
  if (activePlatform === "youtube") {
    return {
      ...base,
      title: elements.youtubeTitleInput.value,
      description: elements.youtubeDescriptionInput.value,
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
  elements.profileSelect.append(new Option(available.length ? `Choose a ${platformName()} account` : "Add an account profile", ""));
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
  elements.captionField.hidden = activePlatform === "youtube";
  elements.youtubeTitleField.hidden = activePlatform !== "youtube";
  elements.youtubeDescriptionField.hidden = activePlatform !== "youtube";
  elements.privacyField.hidden = activePlatform === "instagram";
  elements.madeForKidsField.hidden = activePlatform !== "youtube";

  if (activePlatform === "youtube") {
    elements.privacySelect.replaceChildren(new Option("Public", "public"), new Option("Unlisted", "unlisted"), new Option("Private", "private"));
    elements.privacyHelp.textContent = "The selected visibility is applied to every Short in this queue.";
    elements.folderHelp.textContent = "Common video formats are converted automatically. Shorts must be square or vertical and no longer than 3 minutes.";
  } else if (activePlatform === "tiktok") {
    elements.privacySelect.replaceChildren(new Option("Public", "public"), new Option("Friends", "friends"), new Option("Only you", "private"));
    elements.privacyHelp.textContent = "The selected audience is applied to every TikTok in this queue.";
    elements.captionLabel.textContent = "Caption";
    elements.captionInput.placeholder = "Write the caption used for every TikTok";
    elements.folderHelp.textContent = "MKV and other common formats are converted automatically before upload.";
  } else {
    elements.captionLabel.textContent = "Caption";
    elements.captionInput.placeholder = "Write the caption used for every Reel";
    elements.folderHelp.textContent = "MKV and other common formats are converted automatically. Instagram's Original crop is selected before posting.";
  }
  elements.intervalHelp.textContent = `The timer starts after ${name} confirms a successful post.`;
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
  elements.intervalInput.value = settings.intervalMinutes;
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
  elements.statusDot.className = `status-dot ${statusClass(status)}`;
  elements.startButton.disabled = running;
  elements.stopButton.disabled = !running || status.stopRequested;
  elements.openLoginButton.disabled = running || !elements.profileSelect.value;
  elements.removeProfileButton.disabled = running || !elements.profileSelect.value;
  elements.removeWorkspaceButton.disabled = running || platformWorkspaces().length <= 1;

  [elements.profileSelect, elements.intervalInput, elements.folderButton, elements.thumbnailButton, elements.captionInput,
    elements.youtubeTitleInput, elements.youtubeDescriptionInput, elements.privacySelect, elements.madeForKidsInput]
    .forEach((control) => { control.disabled = running; });

  if (status.currentFile) {
    elements.currentFile.textContent = status.currentFile.split(/[\\/]/).pop();
    elements.currentFile.title = status.currentFile;
    elements.currentFileBlock.hidden = false;
  } else elements.currentFileBlock.hidden = true;

  window.clearInterval(countdownTimer);
  const updateCountdown = () => {
    if (!status.nextRunAt) { elements.countdown.textContent = ""; return; }
    const remaining = Math.max(0, status.nextRunAt - Date.now());
    const minutes = Math.floor(remaining / 60_000);
    const seconds = Math.floor((remaining % 60_000) / 1000);
    elements.countdown.textContent = `Next post in ${minutes}:${String(seconds).padStart(2, "0")}`;
  };
  updateCountdown();
  if (status.nextRunAt) countdownTimer = window.setInterval(updateCountdown, 1000);
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
  try { workspace.settings = await api.saveWorkspace(workspace.id, workspace.settings); }
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
elements.thumbnailButton.addEventListener("click", async () => { const selected = await api.chooseThumbnail(); if (selected) { elements.thumbnailPath.value = selected; await saveQuietly(); } });
elements.profileSelect.addEventListener("change", async () => { renderProfiles(elements.profileSelect.value); await saveQuietly(); });
[elements.intervalInput, elements.captionInput, elements.youtubeTitleInput, elements.youtubeDescriptionInput, elements.privacySelect, elements.madeForKidsInput]
  .forEach((control) => control.addEventListener("change", saveQuietly));

elements.addWorkspaceButton.addEventListener("click", () => {
  elements.workspaceNameInput.value = "";
  elements.workspaceError.hidden = true;
  elements.workspaceDialogCopy.textContent = `Each queue can use a different ${platformName()} account and content folder.`;
  elements.workspaceDialog.showModal();
  elements.workspaceNameInput.focus();
});
elements.createWorkspaceButton.addEventListener("click", async () => {
  elements.workspaceError.hidden = true;
  try {
    const workspace = await api.createWorkspace(activePlatform, elements.workspaceNameInput.value);
    workspace.activity = [];
    workspaces.push(workspace);
    statuses[workspace.id] = idleStatus(workspace.id, activePlatform);
    activeWorkspaceId = workspace.id;
    lastWorkspaceByPlatform[activePlatform] = workspace.id;
    elements.workspaceDialog.close();
    renderTabs();
    populateForm();
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
    showNotice(`Profile created. Open ${platformName()} login and sign in once.`, "info");
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
      if (workspace) workspace.activity.push({ at: entry.createdAt, level: "success", message: `Posted ${entry.fileName}` });
    });
    activeWorkspaceId = platformWorkspaces()[0]?.id || "";
    lastWorkspaceByPlatform[activePlatform] = activeWorkspaceId;
    renderTabs();
    populateForm();
  } catch (error) { showNotice(errorMessage(error)); }
}

initialize();
