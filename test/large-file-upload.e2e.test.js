const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { ChromeManager, findChrome } = require("../src/chrome");
const { PLAYWRIGHT_REMOTE_FILE_LIMIT, setVideoInputFile } = require("../src/file-upload");

test("uploads a file over 50 MB through the app's CDP-connected Chrome", { skip: !findChrome() }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "reel-queue-large-cdp-"));
  const profileDirectory = path.join(root, "profile");
  const videoPath = path.join(root, "over-50mb.mp4");
  await fs.mkdir(profileDirectory);
  await fs.writeFile(videoPath, "");
  await fs.truncate(videoPath, PLAYWRIGHT_REMOTE_FILE_LIMIT + 1);

  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end('<input id="video" type="file" accept="video/mp4"><output id="selectedName"></output><script>document.querySelector("#video").onchange=()=>document.querySelector("#selectedName").textContent=document.querySelector("#video").files[0].name</script>');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  const store = {
    getProfile: async () => ({ id: "large", name: "Large upload", platform: "instagram" }),
    getProfileDirectory: () => profileDirectory
  };
  const chrome = new ChromeManager(store, () => {});
  t.after(async () => {
    await chrome.closeAll();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const handle = await chrome.open("large");
  await handle.page.goto(`http://127.0.0.1:${server.address().port}`);
  await setVideoInputFile(handle.page.locator("#video"), videoPath, { page: handle.page, platform: "Instagram" });
  await assert.doesNotReject(() => handle.page.waitForFunction(() => document.querySelector("#selectedName").textContent === "over-50mb.mp4"));
});
