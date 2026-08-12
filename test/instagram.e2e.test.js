const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright-core");
const { findChrome } = require("../src/chrome");
const { publishReel } = require("../src/instagram");

const mockInstagram = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Mock Instagram composer</title></head>
  <body>
    <input id="unrelatedProfileInput" type="file" accept="image/jpeg" hidden>
    <main id="app">
      <h1>Instagram home</h1>
      <button id="createButton" aria-label="Create">Create</button>
    </main>
    <script>
      const app = document.querySelector('#app');
      const events = [];
      window.testEvents = events;
      document.querySelector('#createButton').addEventListener('click', () => {
        events.push('create-open');
        app.innerHTML = \
          '<h1>Create new post</h1>' +
          '<section id="selectStage">' +
          '<input id="videoInput" type="file" accept="video/mp4,video/quicktime">' +
          '<button id="firstNext" hidden>Next</button>' +
          '</section>';
        document.querySelector('#videoInput').addEventListener('change', (event) => {
          events.push('video:' + event.target.files[0].name);
          document.querySelector('#firstNext').hidden = false;
        });
        document.querySelector('#firstNext').addEventListener('click', () => {
        events.push('first-next');
        app.innerHTML = \
          '<h1>Edit</h1>' +
          '<button id="coverButton">Cover photo</button>' +
          '<button id="secondNext">Next</button>';
        document.querySelector('#coverButton').addEventListener('click', () => {
          events.push('cover-open');
          const panel = document.createElement('div');
          panel.innerHTML = \
            '<input id="coverInput" type="file" accept="image/jpeg,image/png">' +
            '<button id="doneButton" hidden>Done</button>';
          app.append(panel);
          document.querySelector('#coverInput').addEventListener('change', (event) => {
            events.push('cover:' + event.target.files[0].name);
            document.querySelector('#doneButton').hidden = false;
          });
          document.querySelector('#doneButton').addEventListener('click', () => {
            events.push('cover-done');
            panel.remove();
          });
        });
        document.querySelector('#secondNext').addEventListener('click', () => {
          events.push('second-next');
          app.innerHTML = \
            '<h1>New Reel</h1>' +
            '<textarea aria-label="Write a caption"></textarea>' +
            '<button id="shareButton">Share</button>';
          document.querySelector('#shareButton').addEventListener('click', () => {
            events.push('caption:' + document.querySelector('textarea').value);
            events.push('share');
            app.innerHTML = '<h1>Your reel has been shared</h1>';
          });
        });
      });
      });
    </script>
  </body>
</html>`;

test("publishes through the current two-step edit and caption flow", { skip: !findChrome() }, async (t) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "reel-queue-instagram-e2e-"));
  const videoPath = path.join(temporaryRoot, "test-reel.mp4");
  const thumbnailPath = path.join(temporaryRoot, "test-cover.jpg");
  await fs.writeFile(videoPath, "mock video");
  await fs.writeFile(thumbnailPath, "mock image");

  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(mockInstagram);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });

  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  const page = await browser.newPage();
  const result = await publishReel({
    page,
    videoPath,
    thumbnailPath,
    caption: "Reel Queue end-to-end test",
    screenshotRoot: path.join(temporaryRoot, "diagnostics"),
    baseUrl: `http://127.0.0.1:${address.port}`
  });

  assert.deepEqual(result, { confirmed: true });
  assert.deepEqual(await page.evaluate(() => window.testEvents), [
    "create-open",
    "video:test-reel.mp4",
    "first-next",
    "cover-open",
    "cover:test-cover.jpg",
    "cover-done",
    "second-next",
    "caption:Reel Queue end-to-end test",
    "share"
  ]);
});
