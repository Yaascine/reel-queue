const api = window.reelQueue;

const elements = Object.fromEntries(
  [
    "statusDot", "statusTitle", "countdown", "notice", "profileSelect", "openLoginButton",
    "addProfileButton", "removeProfileButton", "intervalInput", "folderPath", "folderButton",
    "thumbnailPath", "thumbnailButton", "captionInput", "captionCount", "trashToggle",
    "runMessage", "queueCount", "currentFileBlock", "currentFile", "startButton", "stopButton",
    "activityList", "openDiagnosticsButton", "clearLogButton", "profileDialog", "profileForm", "profileNameInput",
    "profileError", "createProfileButton"
  ].map((id) => [id, document.getElementById(id)])
);

let profiles = [];
let currentStatus = { running: false, mode: "idle", message: "Ready", queueCount: 0, nextRunAt: null };
let countdownTimer;

function settingsFromForm() {
  return {
    profileId: elements.profileSelect.value,
    videoFolder: elements.folderPath.value,
    thumbnailPath: elements.thumbnailPath.value,
    caption: elements.captionInput.value,
    intervalMinutes: Number(elements.intervalInput.value),
    trashAfterPosting: elements.trashToggle.checked
  };
}

function showNotice(message, type = "error") {
  elements.notice.textContent = message;
  elements.notice.className = type === "info" ? "notice info" : "notice";
  elements.notice.hidden = false;
}

function hideNotice() {
  elements.notice.hidden = true;
  elements.notice.textContent = "";
}

function errorMessage(error) {
  return error?.message || String(error || "Something went wrong.");
}

function renderProfiles(selectedId = "") {
  elements.profileSelect.replaceChildren();
  const placeholder = new Option(profiles.length ? "Choose an account" : "Add an account profile", "");
  elements.profileSelect.append(placeholder);
  profiles.forEach((profile) => elements.profileSelect.append(new Option(profile.name, profile.id)));
  if (selectedId && profiles.some((profile) => profile.id === selectedId)) elements.profileSelect.value = selectedId;
  elements.removeProfileButton.disabled = !elements.profileSelect.value || currentStatus.running;
  elements.openLoginButton.disabled = !elements.profileSelect.value || currentStatus.running;
}

function renderStatus(status) {
  currentStatus = status;
  elements.statusTitle.textContent = status.message || "Ready";
  elements.runMessage.textContent = status.message || "Ready";
  elements.queueCount.textContent = String(status.queueCount || 0);
  elements.statusDot.className = `status-dot ${status.mode === "running" || status.mode === "stopping" ? "running" : status.mode === "error" || status.mode === "login-required" ? "error" : ""}`;
  elements.startButton.disabled = Boolean(status.running);
  elements.stopButton.disabled = !status.running || status.stopRequested;
  elements.openLoginButton.disabled = Boolean(status.running) || !elements.profileSelect.value;
  elements.removeProfileButton.disabled = Boolean(status.running) || !elements.profileSelect.value;
  elements.addProfileButton.disabled = Boolean(status.running);

  const controls = [elements.profileSelect, elements.intervalInput, elements.folderButton, elements.thumbnailButton, elements.captionInput, elements.trashToggle];
  controls.forEach((control) => { control.disabled = Boolean(status.running); });

  if (status.currentFile) {
    elements.currentFile.textContent = status.currentFile.split(/[\\/]/).pop();
    elements.currentFile.title = status.currentFile;
    elements.currentFileBlock.hidden = false;
  } else {
    elements.currentFileBlock.hidden = true;
  }

  window.clearInterval(countdownTimer);
  const updateCountdown = () => {
    if (!status.nextRunAt) {
      elements.countdown.textContent = "";
      return;
    }
    const remaining = Math.max(0, status.nextRunAt - Date.now());
    const minutes = Math.floor(remaining / 60_000);
    const seconds = Math.floor((remaining % 60_000) / 1000);
    elements.countdown.textContent = `Next post in ${minutes}:${String(seconds).padStart(2, "0")}`;
  };
  updateCountdown();
  if (status.nextRunAt) countdownTimer = window.setInterval(updateCountdown, 1000);
}

function appendLog(entry) {
  const empty = elements.activityList.querySelector(".empty-state");
  if (empty) empty.remove();
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
  elements.activityList.prepend(row);
}

async function saveQuietly() {
  try {
    await api.saveSettings(settingsFromForm());
  } catch (error) {
    showNotice(errorMessage(error));
  }
}

elements.captionInput.addEventListener("input", () => {
  elements.captionCount.textContent = `${elements.captionInput.value.length} / 2200`;
});

elements.folderButton.addEventListener("click", async () => {
  const selected = await api.chooseVideoFolder();
  if (selected) {
    elements.folderPath.value = selected;
    await saveQuietly();
  }
});

elements.thumbnailButton.addEventListener("click", async () => {
  const selected = await api.chooseThumbnail();
  if (selected) {
    elements.thumbnailPath.value = selected;
    await saveQuietly();
  }
});

elements.profileSelect.addEventListener("change", async () => {
  renderProfiles(elements.profileSelect.value);
  await saveQuietly();
});
elements.intervalInput.addEventListener("change", saveQuietly);
elements.captionInput.addEventListener("change", saveQuietly);
elements.trashToggle.addEventListener("change", saveQuietly);

elements.addProfileButton.addEventListener("click", () => {
  elements.profileNameInput.value = "";
  elements.profileError.hidden = true;
  elements.profileDialog.showModal();
  elements.profileNameInput.focus();
});

elements.createProfileButton.addEventListener("click", async () => {
  elements.profileError.hidden = true;
  try {
    const profile = await api.createProfile(elements.profileNameInput.value);
    profiles.push(profile);
    renderProfiles(profile.id);
    await saveQuietly();
    elements.profileDialog.close();
    showNotice("Profile created. Open Instagram login and sign in once.", "info");
  } catch (error) {
    elements.profileError.textContent = errorMessage(error);
    elements.profileError.hidden = false;
  }
});

elements.removeProfileButton.addEventListener("click", async () => {
  const id = elements.profileSelect.value;
  const profile = profiles.find((candidate) => candidate.id === id);
  if (!profile) return;
  if (!window.confirm(`Remove ${profile.name} and its saved Chrome session?`)) return;
  try {
    await api.removeProfile(id);
    profiles = profiles.filter((candidate) => candidate.id !== id);
    renderProfiles();
    await saveQuietly();
  } catch (error) {
    showNotice(errorMessage(error));
  }
});

elements.openLoginButton.addEventListener("click", async () => {
  hideNotice();
  try {
    await api.openLogin(elements.profileSelect.value);
    showNotice("Chrome is open. Sign into Instagram in that window, then return here.", "info");
  } catch (error) {
    showNotice(errorMessage(error));
  }
});

elements.startButton.addEventListener("click", async () => {
  hideNotice();
  try {
    const status = await api.start(settingsFromForm());
    renderStatus(status);
  } catch (error) {
    showNotice(errorMessage(error));
  }
});

elements.stopButton.addEventListener("click", async () => {
  try {
    renderStatus(await api.stop());
  } catch (error) {
    showNotice(errorMessage(error));
  }
});

elements.clearLogButton.addEventListener("click", () => {
  elements.activityList.innerHTML = '<div class="empty-state">No activity in this view.</div>';
});

elements.openDiagnosticsButton.addEventListener("click", async () => {
  const error = await api.openDiagnostics();
  if (error) showNotice(errorMessage(error));
});

api.onStatus((status) => renderStatus(status));
api.onLog((entry) => appendLog(entry));

async function initialize() {
  try {
    const data = await api.getBootstrap();
    profiles = data.profiles;
    renderProfiles(data.settings.profileId);
    elements.folderPath.value = data.settings.videoFolder;
    elements.thumbnailPath.value = data.settings.thumbnailPath;
    elements.captionInput.value = data.settings.caption;
    elements.captionCount.textContent = `${data.settings.caption.length} / 2200`;
    elements.intervalInput.value = data.settings.intervalMinutes;
    elements.trashToggle.checked = data.settings.trashAfterPosting;
    data.history.slice(0, 20).reverse().forEach((entry) => appendLog({
      at: entry.createdAt,
      level: "success",
      message: `Posted ${entry.fileName}`
    }));
    renderStatus(data.status);
  } catch (error) {
    showNotice(errorMessage(error));
  }
}

initialize();
