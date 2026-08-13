const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright-core");
const { findChrome } = require("../src/chrome");
const { publishYouTubeShort } = require("../src/youtube");
const { publishTikTok } = require("../src/tiktok");

const youtubePage = `<!doctype html><html><body><main id="app"><button id="create">Create</button></main><script>
window.testEvents=[]; const app=document.querySelector('#app');
document.querySelector('#create').onclick=()=>{ app.innerHTML='<button id="upload">Upload videos</button>'; document.querySelector('#upload').onclick=()=>{
 app.innerHTML='<input id="file" type="file" accept="video/mp4">'; document.querySelector('#file').onchange=e=>{ window.testEvents.push('file:'+e.target.files[0].name); app.innerHTML=
 '<div id="title-textarea"><div id="textbox" role="textbox" contenteditable="true" aria-label="Title"></div></div>'+ 
 '<div id="description-textarea"><div id="textbox" role="textbox" contenteditable="true" aria-label="Description"></div></div>'+ 
 '<label><input id="kids" type="radio" name="audience">No, it is not made for kids</label><button id="next">Next</button>';
 document.querySelector('#next').onclick=()=>next(1); }; }; };
function next(step){ window.testEvents.push('next:'+step); if(step<3){ document.querySelector('#next').onclick=()=>next(step+1); return; }
 window.testEvents.push('title:'+document.querySelector('#title-textarea #textbox').textContent);
 window.testEvents.push('description:'+document.querySelector('#description-textarea #textbox').textContent);
 app.innerHTML='<label><input type="radio" name="visibility">Public</label><label><input id="unlisted" type="radio" name="visibility">Unlisted</label><button id="done">Done</button>';
 document.querySelector('#done').onclick=()=>{ window.testEvents.push('visibility:'+(document.querySelector('#unlisted').checked?'unlisted':'public')); app.innerHTML='<h1>Video uploaded</h1>'; };
}
</script></html>`;

const tiktokPage = `<!doctype html><html><body><main id="app"><input id="file" type="file" accept="video/mp4"></main><script>
window.testEvents=[]; const app=document.querySelector('#app');
document.querySelector('#file').onchange=e=>{ window.testEvents.push('file:'+e.target.files[0].name); app.innerHTML=
'<textarea aria-label="Caption"></textarea><button id="privacy">Everyone</button><div id="options" hidden><button role="menuitem" id="friends">Friends</button></div><button id="post">Post</button>';
document.querySelector('#privacy').onclick=()=>document.querySelector('#options').hidden=false;
document.querySelector('#friends').onclick=()=>{ window.testEvents.push('privacy:friends'); document.querySelector('#options').remove(); };
document.querySelector('#post').onclick=()=>{ window.testEvents.push('caption:'+document.querySelector('textarea').value); app.innerHTML='<h1>Video posted successfully</h1>'; };
};
</script></html>`;

async function fixture(t, html, filename) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "reel-queue-platform-e2e-"));
  const videoPath = path.join(root, filename);
  await fs.writeFile(videoPath, "mock video");
  const server = http.createServer((_request, response) => { response.writeHead(200, { "content-type": "text/html" }); response.end(html); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  t.after(async () => { await browser.close(); await new Promise((resolve) => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
  return { page: await browser.newPage(), videoPath, root, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

test("publishes a YouTube Short through details, audience, and visibility", { skip: !findChrome() }, async (t) => {
  const data = await fixture(t, youtubePage, "short.mp4");
  const result = await publishYouTubeShort({
    page: data.page, videoPath: data.videoPath, title: "Test Short", description: "Test description",
    privacy: "unlisted", madeForKids: false, screenshotRoot: path.join(data.root, "diagnostics"), baseUrl: data.baseUrl
  });
  assert.deepEqual(result, { confirmed: true });
  assert.deepEqual(await data.page.evaluate(() => window.testEvents), [
    "file:short.mp4", "next:1", "next:2", "next:3", "title:Test Short", "description:Test description", "visibility:unlisted"
  ]);
});

test("publishes a TikTok with an independent caption and audience", { skip: !findChrome() }, async (t) => {
  const data = await fixture(t, tiktokPage, "tiktok.mp4");
  const result = await publishTikTok({
    page: data.page, videoPath: data.videoPath, caption: "TikTok test", privacy: "friends",
    screenshotRoot: path.join(data.root, "diagnostics"), baseUrl: data.baseUrl
  });
  assert.deepEqual(result, { confirmed: true });
  assert.deepEqual(await data.page.evaluate(() => window.testEvents), ["file:tiktok.mp4", "privacy:friends", "caption:TikTok test"]);
});
