const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright-core");
const { findChrome } = require("../src/chrome");
const { openComposer, publishReel, setOriginalAspectRatio, setVideoFile, VIDEO_FILE_SELECTION_TIMEOUT } = require("../src/instagram");

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
          '<button id="cropButton" aria-label="Select crop" hidden>Select crop</button>' +
          '<button id="firstNext" hidden>Next</button>' +
          '</section>';
        document.querySelector('#videoInput').addEventListener('change', (event) => {
          events.push('video:' + event.target.files[0].name);
          document.querySelector('#cropButton').hidden = false;
          document.querySelector('#firstNext').hidden = false;
        });
        document.querySelector('#cropButton').addEventListener('click', () => {
          events.push('crop-open');
          const menu = document.createElement('div');
          menu.id = 'cropMenu';
          menu.innerHTML =
            '<button id="originalOption" role="menuitem">Original</button>' +
            '<button role="menuitem">1:1</button>';
          app.append(menu);
          document.querySelector('#originalOption').addEventListener('click', () => {
            events.push('crop:original');
            menu.remove();
          });
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

test("allows unlimited time for Instagram to accept a large video", async () => {
  let received;
  const input = {
    async setInputFiles(videoPath, options) {
      received = { videoPath, options };
    }
  };

  await setVideoFile(input, "large-video.mkv");
  assert.deepEqual(received, {
    videoPath: "large-video.mkv",
    options: { timeout: VIDEO_FILE_SELECTION_TIMEOUT }
  });
  assert.equal(VIDEO_FILE_SELECTION_TIMEOUT, 0);
});

test("clicks the account-specific Post flyout before looking for the file selector", { skip: !findChrome() }, async (t) => {
  const html = `<!doctype html><html><body><main id="app"><button aria-label="Create" id="create">Create</button></main><script>
    window.testEvents=[];
    document.querySelector('#create').onclick=()=>{
      window.testEvents.push('create');
      document.querySelector('#app').innerHTML='<div role="menu"><button role="menuitem" id="post">Post</button></div>';
      document.querySelector('#post').onclick=()=>{
        window.testEvents.push('post');
        document.querySelector('#app').innerHTML='<input id="video" type="file" accept="video/mp4,video/quicktime">';
      };
    };
  </script></body></html>`;
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  });

  const page = await browser.newPage();
  const input = await openComposer(page, `http://127.0.0.1:${server.address().port}`);
  assert.equal(await input.getAttribute("id"), "video");
  assert.deepEqual(await page.evaluate(() => window.testEvents), ["create", "post"]);
});

test("selects Original from Instagram's unlabeled lower-left aspect arrow", { skip: !findChrome(), timeout: 10_000 }, async (t) => {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
  await page.setContent(`<!doctype html><html><head><style>
    #dialog { position: relative; width: 600px; height: 650px; margin: 20px auto; }
    #preview { position: absolute; left: 80px; top: 70px; width: 440px; height: 540px; }
    #aspect, #multiple { position: absolute; bottom: 16px; width: 54px; height: 54px; }
    #aspect { left: 92px; } #multiple { right: 92px; }
  </style></head><body>
    <section id="dialog" role="dialog">
      <button style="position:absolute;right:12px;top:12px">Next</button>
      <canvas id="preview" width="440" height="540"></canvas>
      <div id="aspect" role="button" tabindex="0"><svg viewBox="0 0 24 24"><path d="M4 10V4h6M20 14v6h-6"/></svg></div>
      <div id="multiple" role="button" tabindex="0" aria-label="Select multiple"><svg></svg></div>
    </section>
    <script>
      window.testEvents = [];
      document.querySelector('#multiple').onclick = () => window.testEvents.push('multiple');
      document.querySelector('#aspect').onclick = () => {
        window.testEvents.push('aspect');
        const menu = document.createElement('div');
        menu.innerHTML = '<button id="original" role="menuitem">Original</button><button role="menuitem">1:1</button>';
        document.querySelector('#dialog').append(menu);
        document.querySelector('#original').onclick = () => window.testEvents.push('original');
      };
    </script>
  </body></html>`);

  assert.equal(await setOriginalAspectRatio(page), true);
  assert.deepEqual(await page.evaluate(() => window.testEvents), ["aspect", "original"]);
});

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
  let submitted = 0;
  const result = await publishReel({
    page,
    videoPath,
    thumbnailPath,
    caption: "Reel Queue end-to-end test",
    screenshotRoot: path.join(temporaryRoot, "diagnostics"),
    baseUrl: `http://127.0.0.1:${address.port}`,
    onSubmitted: async () => { submitted += 1; }
  });

  assert.deepEqual(result, { confirmed: true });
  assert.equal(submitted, 1);
  assert.deepEqual(await page.evaluate(() => window.testEvents), [
    "create-open",
    "video:test-reel.mp4",
    "crop-open",
    "crop:original",
    "first-next",
    "cover-open",
    "cover:test-cover.jpg",
    "cover-done",
    "second-next",
    "caption:Reel Queue end-to-end test",
    "share"
  ]);

  const automaticPage = await browser.newPage();
  const automaticResult = await publishReel({
    page: automaticPage,
    videoPath,
    thumbnailPath: "",
    caption: "Automatic cover test",
    screenshotRoot: path.join(temporaryRoot, "diagnostics"),
    baseUrl: `http://127.0.0.1:${address.port}`
  });
  assert.deepEqual(automaticResult, { confirmed: true });
  assert.deepEqual(await automaticPage.evaluate(() => window.testEvents), [
    "create-open",
    "video:test-reel.mp4",
    "crop-open",
    "crop:original",
    "first-next",
    "second-next",
    "caption:Automatic cover test",
    "share"
  ]);
});
