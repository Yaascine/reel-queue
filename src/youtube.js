const {
  LoginRequiredError,
  ConfirmationError,
  firstVisible,
  namedLocators,
  clickIfVisible,
  waitForAttachedInput,
  captureFailure
} = require("./instagram");
const { setVideoInputFile } = require("./file-upload");

const DEFAULT_BASE_URL = "https://studio.youtube.com";

async function assertYouTubeLogin(page) {
  if (/accounts\.google\.com|\/signin/i.test(page.url())) {
    throw new LoginRequiredError("YouTube login is required for this account profile. Open YouTube login, sign in, and try again.");
  }
  const signIn = await firstVisible(namedLocators(page, ["Sign in"]), 1_500);
  if (signIn) throw new LoginRequiredError("YouTube login is required for this account profile. Open YouTube login, sign in, and try again.");
}

async function fillEditor(editor, value) {
  await editor.click();
  await editor.fill(value).catch(async () => {
    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    await editor.press(`${modifier}+A`);
    await editor.press("Backspace");
    await editor.pressSequentially(value);
  });
}

async function openUpload(page, baseUrl) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await assertYouTubeLogin(page);

  let input = await waitForAttachedInput(page, ['input[type="file"][accept*="video" i]'], 2_000);
  if (input) return input;

  const create = await firstVisible(
    [...namedLocators(page, ["Create"]), page.locator('#create-icon, ytcp-button#create-icon')],
    0
  );
  if (!create) throw new Error("YouTube Studio control not found: Create.");
  await create.click();

  const upload = await firstVisible(namedLocators(page, ["Upload videos", "Upload video"]), 0);
  if (!upload) throw new Error("YouTube Studio control not found: Upload videos.");
  const menuUpload = await firstVisible(
    [
      page.getByRole("menuitem", { name: /^\s*Upload videos?\s*$/i }),
      page.locator('tp-yt-paper-item[role="menuitem"]:has-text("Upload videos")')
    ],
    2_000
  );
  await (menuUpload || upload).click();

  input = await waitForAttachedInput(page, ['input[type="file"][accept*="video" i]', 'input[type="file"]'], 0);
  if (!input) throw new Error("YouTube Studio opened the upload dialog but did not provide a video selector.");
  return input;
}

async function chooseAudience(page, madeForKids) {
  const label = madeForKids ? /yes,? it(?:(?:'|’)s| is) made for kids/i : /no,? it(?:(?:'|’)s| is) not made for kids/i;
  const option = await firstVisible(
    [page.getByText(label), page.getByRole("radio", { name: label }), page.getByLabel(label)],
    0
  );
  if (!option) throw new Error("YouTube Studio audience setting was not found.");
  await option.click();
}

async function chooseVisibility(page, privacy) {
  const labels = { public: /^public$/i, unlisted: /^unlisted$/i, private: /^private$/i };
  const label = labels[privacy] || labels.public;
  const option = await firstVisible(
    [page.getByRole("radio", { name: label }), page.getByText(label, { exact: true }), page.getByLabel(label)],
    0
  );
  if (!option) throw new Error(`YouTube Studio visibility setting was not found: ${privacy}.`);
  await option.click();
}

async function publishYouTubeShort({
  page,
  videoPath,
  title,
  description = "",
  privacy = "public",
  madeForKids = false,
  screenshotRoot,
  onSubmitted = async () => {},
  onStep = () => {},
  baseUrl = DEFAULT_BASE_URL
}) {
  let stage = "opening YouTube Studio";
  try {
    onStep("Opening YouTube Studio");
    await page.bringToFront();
    const videoInput = await openUpload(page, baseUrl);

    stage = "selecting the video";
    onStep("Uploading the prepared MP4 to YouTube");
    await setVideoInputFile(videoInput, videoPath, {
      platform: "YouTube",
      page,
      isAccepted: async () => Boolean(await firstVisible([
        page.locator('#title-textarea #textbox'),
        page.locator('[aria-label*="title" i][contenteditable="true"]')
      ], 300))
    });

    stage = "adding video details";
    onStep("Adding YouTube details");
    const titleEditor = await firstVisible(
      [
        page.locator('#title-textarea #textbox'),
        page.locator('[aria-label*="title" i][contenteditable="true"]'),
        page.getByRole("textbox", { name: /title/i })
      ],
      0
    );
    if (!titleEditor) throw new Error("YouTube Studio title field was not found.");
    await fillEditor(titleEditor, title);

    const descriptionEditor = description ? await firstVisible(
      [
        page.locator('#description-textarea #textbox'),
        page.locator('[aria-label*="description" i][contenteditable="true"]'),
        page.getByRole("textbox", { name: /description/i })
      ],
      0
    ) : null;
    if (descriptionEditor) await fillEditor(descriptionEditor, description);
    await chooseAudience(page, madeForKids);

    stage = "selecting a generated YouTube thumbnail";
    onStep("Selecting a generated video-frame thumbnail");
    await chooseGeneratedThumbnail(page);

    for (let index = 0; index < 3; index += 1) {
      stage = `opening YouTube upload step ${index + 2}`;
      const next = await firstVisible(namedLocators(page, ["Next"]), 0);
      if (!next) throw new Error("YouTube Studio control not found: Next.");
      await next.click();
    }

    stage = "setting YouTube visibility";
    onStep("Setting YouTube visibility");
    await chooseVisibility(page, privacy);

    stage = "publishing the YouTube Short";
    onStep("Publishing the YouTube Short");
    const done = await firstVisible(namedLocators(page, ["Done", "Save", "Publish"]), 0);
    if (!done) throw new Error("YouTube Studio publish control was not found.");
    await done.click();
    await onSubmitted();

    stage = "waiting for YouTube confirmation";
    onStep("Waiting for YouTube confirmation");
    const confirmation = await firstVisible(
      [
        page.getByText(/video (published|uploaded|saved)/i),
        page.getByText(/upload complete/i),
        page.getByRole("heading", { name: /video (published|uploaded)/i })
      ],
      0
    );
    if (!confirmation) {
      throw new ConfirmationError("YouTube did not show a clear upload confirmation. The source video was kept to prevent data loss.");
    }
    await clickIfVisible(page, ["Close"], 2_000);
    return { confirmed: true };
  } catch (error) {
    error.stage = stage;
    const diagnostics = await captureFailure(page, screenshotRoot, videoPath, stage);
    error.screenshotPath = diagnostics.screenshotPath;
    error.diagnosticPath = diagnostics.diagnosticPath;
    throw error;
  }
}

async function chooseGeneratedThumbnail(page, random = Math.random) {
  const candidates = page.locator([
    '[id^="still-"]',
    "ytcp-video-thumbnail-with-info",
    "ytcp-thumbnail-button:not([disabled])",
    '[name="VIDEO_THUMBNAIL"] [role="radio"]',
    '[aria-label*="thumbnail" i][role="radio"]'
  ].join(", "));
  const count = await candidates.count().catch(() => 0);
  if (!count) return false;
  const firstChoice = Math.min(count - 1, Math.floor(random() * count));
  for (let offset = 0; offset < count; offset += 1) {
    const candidate = candidates.nth((firstChoice + offset) % count);
    if (!(await candidate.isVisible().catch(() => false))) continue;
    if (!(await candidate.isEnabled().catch(() => true))) continue;
    if (await candidate.click().then(() => true).catch(() => false)) return true;
  }
  return false;
}

module.exports = { DEFAULT_BASE_URL, publishYouTubeShort, openUpload, chooseAudience, chooseVisibility, chooseGeneratedThumbnail };
