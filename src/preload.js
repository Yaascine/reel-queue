const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("reelQueue", {
  getBootstrap: () => ipcRenderer.invoke("app:bootstrap"),
  chooseVideoFolder: () => ipcRenderer.invoke("dialog:video-folder"),
  chooseThumbnail: () => ipcRenderer.invoke("dialog:thumbnail"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  createProfile: (name) => ipcRenderer.invoke("profiles:create", name),
  removeProfile: (id) => ipcRenderer.invoke("profiles:remove", id),
  openLogin: (id) => ipcRenderer.invoke("profiles:open-login", id),
  start: (settings) => ipcRenderer.invoke("automation:start", settings),
  stop: () => ipcRenderer.invoke("automation:stop"),
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
