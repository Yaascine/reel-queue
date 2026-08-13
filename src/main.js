const path = require("node:path");
const fs = require("node:fs/promises");
const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell } = require("electron");
const { AppStore } = require("./store");
const { ChromeManager } = require("./chrome");
const { AutomationRunner } = require("./runner");

let mainWindow;
let store;
let chrome;
let runner;

function iconPath() {
  return path.join(__dirname, "..", "build", "icon.png");
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 860,
    minHeight: 640,
    show: false,
    title: "Reel Queue",
    icon: nativeImage.createFromPath(iconPath()),
    backgroundColor: "#f4f5f2",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
  await mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
}

function registerIpc() {
  ipcMain.handle("app:bootstrap", async () => ({
    settings: await store.getSettings(),
    profiles: await store.listProfiles(),
    history: (await store.getHistory()).slice(0, 100),
    status: runner.getStatus()
  }));

  ipcMain.handle("dialog:video-folder", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose the video folder",
      properties: ["openDirectory", "createDirectory"]
    });
    return result.canceled ? "" : result.filePaths[0];
  });

  ipcMain.handle("dialog:thumbnail", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose the Reel thumbnail",
      properties: ["openFile"],
      filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png"] }]
    });
    return result.canceled ? "" : result.filePaths[0];
  });

  ipcMain.handle("settings:save", (_event, settings) => store.saveSettings(settings));
  ipcMain.handle("app:open-diagnostics", () => shell.openPath(store.screenshotRoot));
  ipcMain.handle("profiles:create", async (_event, name) => {
    if (runner.running) throw new Error("Stop the automation before adding an account profile.");
    return store.createProfile(name);
  });
  ipcMain.handle("profiles:remove", async (_event, id) => {
    if (runner.running) throw new Error("Stop the automation before removing an account profile.");
    const profileDirectory = store.getProfileDirectory(id);
    await chrome.close(id);
    await store.removeProfile(id);
    try {
      await fs.access(profileDirectory);
      await shell.trashItem(profileDirectory);
    } catch {
      // The profile directory may already be absent.
    }
    return true;
  });
  ipcMain.handle("profiles:open-login", async (_event, id) => chrome.openLogin(id));
  ipcMain.handle("automation:start", (_event, settings) => runner.start(settings));
  ipcMain.handle("automation:stop", () => runner.stop());
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    const applicationMenu = Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: "about" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { type: "separator" },
          { role: "quit" }
        ]
      },
      { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
      { label: "View", submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }] }
    ]);
    Menu.setApplicationMenu(applicationMenu);

    store = new AppStore(path.join(app.getPath("userData"), "data"));
    await store.initialize();
    chrome = new ChromeManager(store, async (level, message) => {
      const entry = await store.appendLog(level, message);
      send("automation:log", entry);
    });
    runner = new AutomationRunner({
      store,
      chrome,
      emit: (type, payload) => send(`automation:${type}`, payload)
    });

    registerIpc();
    await createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

let quitting = false;
app.on("before-quit", (event) => {
  if (!chrome || quitting) return;
  event.preventDefault();
  quitting = true;
  Promise.resolve(runner?.stop())
    .catch(() => {})
    .then(() => chrome.closeAll())
    .catch(() => {})
    .finally(() => app.exit(0));
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
