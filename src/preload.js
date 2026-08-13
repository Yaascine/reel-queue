const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("reelQueue", {
  getBootstrap: () => ipcRenderer.invoke("app:bootstrap"),
  chooseVideoFolder: () => ipcRenderer.invoke("dialog:video-folder"),
  chooseThumbnail: () => ipcRenderer.invoke("dialog:thumbnail"),
  createWorkspace: (name) => ipcRenderer.invoke("workspaces:create", name),
  saveWorkspace: (id, settings) => ipcRenderer.invoke("workspaces:save", id, settings),
  removeWorkspace: (id) => ipcRenderer.invoke("workspaces:remove", id),
  createProfile: (name) => ipcRenderer.invoke("profiles:create", name),
  removeProfile: (id) => ipcRenderer.invoke("profiles:remove", id),
  openLogin: (id) => ipcRenderer.invoke("profiles:open-login", id),
  openDiagnostics: () => ipcRenderer.invoke("app:open-diagnostics"),
  start: (workspaceId, settings) => ipcRenderer.invoke("automation:start", workspaceId, settings),
  stop: (workspaceId) => ipcRenderer.invoke("automation:stop", workspaceId),
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
