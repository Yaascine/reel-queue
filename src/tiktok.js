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

const DEFAULT_BASE_URL = "https://www.tiktok.com/tiktokstudio/upload?lang=en";

async function dismissTikTokOverlays(page) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const overlay = page.locator('#react-joyride-portal, [data-test-id="overlay"], .react-joyride__overlay').first();
    if (!(await overlay.isVisible({ timeout: 250 }).catch(() => false))) return true;

    const dismiss = await firstVisible(
      namedLocators(page, ["Skip", "Skip tour", "Got it", "Done", "Close", "Next"], ["button", "link"]),
      750
    );
    if (dismiss) {
      await dismiss.click({ force: true, timeout: 2_000 }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 150));
      continue;
    }

    await page.keyboard.press("Escape").catch(() => {});
    await page.locator("#react-joyride-portal").evaluate((element) => element.remove()).catch(() => {});
    await page.locator('[data-test-id="overlay"], .react-joyride__overlay').evaluateAll((elements) => elements.forEach((element) => element.remove())).catch(() => {});
  }
  return !(await page.locator('[data-test-id="overlay"], .react-joyride__overlay').first().isVisible({ timeout: 250 }).catch(() => false));
}

async function assertTikTokLogin(page) {
  if (/\/login|login\.tiktok\.com/i.test(page.url())) {
    throw new LoginRequiredError("TikTok login is required for this account profile. Open TikTok login, sign in, and try again.");
  }
  const login = await firstVisible(namedLocators(page, ["Log in", "Login"]), 1_500);
  if (login) throw new LoginRequiredError("TikTok login is required for this account profile. Open TikTok login, sign in, and try again.");
}

async function waitForVideoInput(page, timeout = 0) {
  const deadline = timeout > 0 ? Date.now() + timeout : Number.POSITIVE_INFINITY;
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
  await dismissTikTokOverlays(page);
  const editor = await firstVisible(
    [
      page.getByRole("textbox", { name: /caption|description/i }),
      page.locator('textarea[placeholder*="caption" i], textarea[placeholder*="description" i]'),
      page.locator('[contenteditable="true"][data-placeholder*="caption" i]'),
      page.locator('[contenteditable="true"]').first()
    ],
    0
  );
  if (!editor) throw new Error("TikTok caption field was not found.");
  await editor.click({ force: true, timeout: 0 });
  await editor.fill(caption).catch(async () => {
    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    await editor.press(`${modifier}+A`);
    await editor.press("Backspace");
    await editor.pressSequentially(caption);
  });
}

async function choosePrivacy(page, privacy) {
  await dismissTikTokOverlays(page);
  const labels = { public: ["Everyone", "Public"], friends: ["Friends"], private: ["Only you", "Private"] };
  const requested = labels[privacy] || labels.public;
  const current = await firstVisible(
    [
      page.getByRole("combobox", { name: /who can (view|watch)/i }),
      ...namedLocators(page, ["Everyone", "Public", "Friends", "Only you", "Private"]),
      page.getByText(/who can (view|watch) this (video|post)/i)
    ],
    0
  );
  if (!current) {
    if (privacy === "public") return;
    throw new Error(`TikTok privacy control was not found: ${privacy}.`);
  }
  await current.click();
  const option = await firstVisible(namedLocators(page, requested, ["option", "menuitem", "radio", "button"]), 0);
  if (!option) {
    const textOption = await firstVisible(requested.map((label) => page.getByText(new RegExp(`^\\s*${label}\\s*$`, "i"), { exact: true })), 3_000);
    if (!textOption) throw new Error(`TikTok privacy option was not found: ${privacy}.`);
    await textOption.click();
    return;
  }
  await option.click();
}

async function waitForPostConfirmation(page, caption, privacy, timeout = 0) {
  const deadline = timeout > 0 ? Date.now() + timeout : Number.POSITIVE_INFINITY;
  const expectedPrivacy = { public: /everyone|public/i, friends: /friends/i, private: /only you|private/i }[privacy] || /everyone|public/i;
  while (Date.now() < deadline) {
    await clickIfVisible(page, ["Post now", "Post anyway", "Confirm"], 500);
    const confirmation = await firstVisible(
      [
        page.getByText(/your video (has been|was) (uploaded|posted|published)/i),
        page.getByText(/video (uploaded|posted|published) successfully/i),
        page.getByText(/post (submitted|published) successfully/i)
      ],
      750
    );
    if (confirmation) return true;

    if (/\/tiktokstudio\/content/i.test(page.url())) {
      const title = page.getByText(caption, { exact: true }).first();
      if (await title.isVisible({ timeout: 750 }).catch(() => false)) {
        const row = title.locator('xpath=ancestor::div[@height="100px"]').first();
        const rowText = await row.innerText().catch(() => "");
        if (expectedPrivacy.test(rowText)) return true;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function publishTikTok({
  page,
  videoPath,
  caption,
  privacy = "public",
  screenshotRoot,
  onSubmitted = async () => {},
  onStep = () => {},
  baseUrl = DEFAULT_BASE_URL
}) {
  let stage = "opening TikTok Studio";
  try {
    onStep("Opening TikTok Studio");
    await page.bringToFront();
    await page.goto(baseUrl, { waitUntil: "commit", timeout: 0 });
    await page.waitForLoadState("domcontentloaded", { timeout: 0 }).catch(() => {});
    await assertTikTokLogin(page);

    stage = "selecting the video";
    onStep("Loading the video into TikTok (large files can take several minutes)");
    const input = await waitForVideoInput(page);
    if (!input) {
      await assertTikTokLogin(page);
      throw new Error("TikTok Studio did not provide a video selector.");
    }
    await setVideoInputFile(input, videoPath, {
      platform: "TikTok",
      page,
      isAccepted: async () => Boolean(await firstVisible([
        page.getByRole("textbox", { name: /caption|description/i }),
        page.locator('textarea[placeholder*="caption" i], textarea[placeholder*="description" i]'),
        ...namedLocators(page, ["Post", "Publish"])
      ], 300))
    });

    stage = "adding the caption";
    onStep("Adding TikTok details");
    await fillCaption(page, caption);

    stage = "setting TikTok privacy";
    await choosePrivacy(page, privacy);

    stage = "posting to TikTok";
    onStep("Posting to TikTok");
    await dismissTikTokOverlays(page);
    const post = await firstVisible(namedLocators(page, ["Post", "Publish"]), 0);
    if (!post) throw new Error("TikTok Studio post control was not found.");
    await post.waitFor({ state: "visible", timeout: 0 });
    while (true) {
      const disabled = await post.getAttribute("aria-disabled");
      const nativeDisabled = await post.isDisabled().catch(() => false);
      if (disabled !== "true" && !nativeDisabled) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    await post.click({ timeout: 0 });
    await clickIfVisible(page, ["Post now", "Post anyway", "Confirm"], 5_000);
    await onSubmitted();

    stage = "waiting for TikTok confirmation";
    onStep("Waiting for TikTok confirmation");
    const confirmation = await waitForPostConfirmation(page, caption, privacy);
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

module.exports = { DEFAULT_BASE_URL, publishTikTok, assertTikTokLogin, waitForVideoInput, fillCaption, choosePrivacy, waitForPostConfirmation, dismissTikTokOverlays };
