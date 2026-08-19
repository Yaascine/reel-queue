const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("reelQueue", {
  getBootstrap: () => ipcRenderer.invoke("app:bootstrap"),
  chooseVideoFolder: () => ipcRenderer.invoke("dialog:video-folder"),
  chooseThumbnail: () => ipcRenderer.invoke("dialog:thumbnail"),
  chooseThumbnailFolder: () => ipcRenderer.invoke("dialog:thumbnail-folder"),
  createWorkspace: (platform, name) => ipcRenderer.invoke("workspaces:create", platform, name),
  saveWorkspace: (id, settings) => ipcRenderer.invoke("workspaces:save", id, settings),
  getWorkspaceStatus: (id) => ipcRenderer.invoke("workspaces:status", id),
  removeWorkspace: (id) => ipcRenderer.invoke("workspaces:remove", id),
  createProfile: (platform, name) => ipcRenderer.invoke("profiles:create", platform, name),
  removeProfile: (id) => ipcRenderer.invoke("profiles:remove", id),
  openLogin: (id, platform) => ipcRenderer.invoke("profiles:open-login", id, platform),
  openDiagnostics: () => ipcRenderer.invoke("app:open-diagnostics"),
  start: (workspaceId, settings) => ipcRenderer.invoke("automation:start", workspaceId, settings),
  stop: (workspaceId) => ipcRenderer.invoke("automation:stop", workspaceId),
  resetUploadLimit: (workspaceId) => ipcRenderer.invoke("automation:reset-upload-limit", workspaceId),
  onStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("automation:status", listener);
    return () => ipcRenderer.removeListener("automation:status", listener);
  },
  onLog: (callback) => {
    const listener = (_event, entry) => callback(entry);
    ipcRenderer.on("automation:log", listener);
    return () => ipcRenderer.removeListener("automation:log", listener);
  }
});
