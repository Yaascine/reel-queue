const {
  LoginRequiredError,
  ConfirmationError,
  firstVisible,
  namedLocators,
  clickIfVisible,
  waitForAttachedInput,
  captureFailure
} = require("./instagram");

const DEFAULT_BASE_URL = "https://www.tiktok.com/tiktokstudio/upload?lang=en";

async function assertTikTokLogin(page) {
  if (/\/login|login\.tiktok\.com/i.test(page.url())) {
    throw new LoginRequiredError("TikTok login is required for this account profile. Open TikTok login, sign in, and try again.");
  }
  const login = await firstVisible(namedLocators(page, ["Log in", "Login"]), 1_500);
  if (login) throw new LoginRequiredError("TikTok login is required for this account profile. Open TikTok login, sign in, and try again.");
}

async function waitForVideoInput(page, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    await assertTikTokLogin(page);
    const input = await waitForAttachedInput(
      page,
      ['input[type="file"][accept*="video" i]', 'input[type="file"]'],
      500
    );
    if (input) return input;
  }
  return null;
}

async function fillCaption(page, caption) {
  const editor = await firstVisible(
    [
      page.getByRole("textbox", { name: /caption|description/i }),
      page.locator('textarea[placeholder*="caption" i], textarea[placeholder*="description" i]'),
      page.locator('[contenteditable="true"][data-placeholder*="caption" i]'),
      page.locator('[contenteditable="true"]').first()
    ],
    60_000
  );
  if (!editor) throw new Error("TikTok caption field was not found.");
  await editor.click();
  await editor.fill(caption).catch(async () => {
    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    await editor.press(`${modifier}+A`);
    await editor.press("Backspace");
    await editor.pressSequentially(caption);
  });
}

async function choosePrivacy(page, privacy) {
  const labels = { public: ["Everyone", "Public"], friends: ["Friends"], private: ["Only you", "Private"] };
  const requested = labels[privacy] || labels.public;
  const current = await firstVisible(
    [
      page.getByRole("combobox", { name: /who can (view|watch)/i }),
      ...namedLocators(page, ["Everyone", "Public", "Friends", "Only you", "Private"]),
      page.getByText(/who can (view|watch) this (video|post)/i)
    ],
    20_000
  );
  if (!current) {
    if (privacy === "public") return;
    throw new Error(`TikTok privacy control was not found: ${privacy}.`);
  }
  await current.click();
  const option = await firstVisible(namedLocators(page, requested, ["option", "menuitem", "radio", "button"]), 8_000);
  if (!option) {
    const textOption = await firstVisible(requested.map((label) => page.getByText(new RegExp(`^\\s*${label}\\s*$`, "i"), { exact: true })), 3_000);
    if (!textOption) throw new Error(`TikTok privacy option was not found: ${privacy}.`);
    await textOption.click();
    return;
  }
  await option.click();
}

async function publishTikTok({
  page,
  videoPath,
  caption,
  privacy = "public",
  screenshotRoot,
  onStep = () => {},
  baseUrl = DEFAULT_BASE_URL
}) {
  let stage = "opening TikTok Studio";
  try {
    onStep("Opening TikTok Studio");
    await page.bringToFront();
    await page.goto(baseUrl, { waitUntil: "commit", timeout: 60_000 });
    await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => {});
    await assertTikTokLogin(page);

    stage = "selecting the video";
    onStep("Selecting the TikTok video");
    const input = await waitForVideoInput(page);
    if (!input) {
      await assertTikTokLogin(page);
      throw new Error("TikTok Studio did not provide a video selector.");
    }
    await input.setInputFiles(videoPath);

    stage = "adding the caption";
    onStep("Adding TikTok details");
    await fillCaption(page, caption);

    stage = "setting TikTok privacy";
    await choosePrivacy(page, privacy);

    stage = "posting to TikTok";
    onStep("Posting to TikTok");
    const post = await firstVisible(namedLocators(page, ["Post", "Publish"]), 120_000);
    if (!post) throw new Error("TikTok Studio post control was not found.");
    await post.click();
    await clickIfVisible(page, ["Post now", "Post anyway", "Confirm"], 5_000);

    stage = "waiting for TikTok confirmation";
    onStep("Waiting for TikTok confirmation");
    const confirmation = await firstVisible(
      [
        page.getByText(/your video (has been|was) (uploaded|posted|published)/i),
        page.getByText(/video (uploaded|posted|published) successfully/i),
        page.getByText(/post (submitted|published) successfully/i)
      ],
      180_000
    );
    if (!confirmation) {
      throw new ConfirmationError("TikTok did not show a clear post confirmation. The source video was kept to prevent data loss.");
    }
    return { confirmed: true };
  } catch (error) {
    error.stage = stage;
    const diagnostics = await captureFailure(page, screenshotRoot, videoPath, stage);
    error.screenshotPath = diagnostics.screenshotPath;
    error.diagnosticPath = diagnostics.diagnosticPath;
    throw error;
  }
}

module.exports = { DEFAULT_BASE_URL, publishTikTok, assertTikTokLogin, waitForVideoInput, fillCaption, choosePrivacy };
