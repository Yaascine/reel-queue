const {
  LoginRequiredError,
  ConfirmationError,
  firstVisible,
  namedLocators,
  clickIfVisible,
  waitForAttachedInput,
  captureFailure
} = require("./instagram");

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
    30_000
  );
  if (!create) throw new Error("YouTube Studio control not found: Create.");
  await create.click();

  const upload = await firstVisible(namedLocators(page, ["Upload videos", "Upload video"]), 10_000);
  if (!upload) throw new Error("YouTube Studio control not found: Upload videos.");
  await upload.click();

  input = await waitForAttachedInput(page, ['input[type="file"][accept*="video" i]', 'input[type="file"]'], 15_000);
  if (!input) throw new Error("YouTube Studio opened the upload dialog but did not provide a video selector.");
  return input;
}

async function chooseAudience(page, madeForKids) {
  const label = madeForKids ? /yes,? it(?:(?:'|’)s| is) made for kids/i : /no,? it(?:(?:'|’)s| is) not made for kids/i;
  const option = await firstVisible(
    [page.getByText(label), page.getByRole("radio", { name: label }), page.getByLabel(label)],
    20_000
  );
  if (!option) throw new Error("YouTube Studio audience setting was not found.");
  await option.click();
}

async function chooseVisibility(page, privacy) {
  const labels = { public: /^public$/i, unlisted: /^unlisted$/i, private: /^private$/i };
  const label = labels[privacy] || labels.public;
  const option = await firstVisible(
    [page.getByRole("radio", { name: label }), page.getByText(label, { exact: true }), page.getByLabel(label)],
    20_000
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
  onStep = () => {},
  baseUrl = DEFAULT_BASE_URL
}) {
  let stage = "opening YouTube Studio";
  try {
    onStep("Opening YouTube Studio");
    await page.bringToFront();
    const videoInput = await openUpload(page, baseUrl);

    stage = "selecting the video";
    onStep("Selecting the YouTube Short");
    await videoInput.setInputFiles(videoPath);

    stage = "adding video details";
    onStep("Adding YouTube details");
    const titleEditor = await firstVisible(
      [
        page.locator('#title-textarea #textbox'),
        page.locator('[aria-label*="title" i][contenteditable="true"]'),
        page.getByRole("textbox", { name: /title/i })
      ],
      45_000
    );
    if (!titleEditor) throw new Error("YouTube Studio title field was not found.");
    await fillEditor(titleEditor, title);

    const descriptionEditor = await firstVisible(
      [
        page.locator('#description-textarea #textbox'),
        page.locator('[aria-label*="description" i][contenteditable="true"]'),
        page.getByRole("textbox", { name: /description/i })
      ],
      10_000
    );
    if (descriptionEditor) await fillEditor(descriptionEditor, description);
    await chooseAudience(page, madeForKids);

    for (let index = 0; index < 3; index += 1) {
      stage = `opening YouTube upload step ${index + 2}`;
      const next = await firstVisible(namedLocators(page, ["Next"]), 120_000);
      if (!next) throw new Error("YouTube Studio control not found: Next.");
      await next.click();
    }

    stage = "setting YouTube visibility";
    onStep("Setting YouTube visibility");
    await chooseVisibility(page, privacy);

    stage = "publishing the YouTube Short";
    onStep("Publishing the YouTube Short");
    const done = await firstVisible(namedLocators(page, ["Done", "Save", "Publish"]), 120_000);
    if (!done) throw new Error("YouTube Studio publish control was not found.");
    await done.click();

    stage = "waiting for YouTube confirmation";
    onStep("Waiting for YouTube confirmation");
    const confirmation = await firstVisible(
      [
        page.getByText(/video (published|uploaded|saved)/i),
        page.getByText(/upload complete/i),
        page.getByRole("heading", { name: /video (published|uploaded)/i })
      ],
      180_000
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

module.exports = { DEFAULT_BASE_URL, publishYouTubeShort, openUpload, chooseAudience, chooseVisibility };
