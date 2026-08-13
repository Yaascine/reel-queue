const fs = require("node:fs/promises");
const path = require("node:path");
const { VIDEO_FILE_SELECTION_TIMEOUT, setVideoInputFile } = require("./file-upload");

const DEFAULT_BASE_URL = "https://www.instagram.com";

class LoginRequiredError extends Error {
  constructor(message = "Instagram login is required for this account profile. Open Instagram login, sign in, and try again.") {
    super(message);
    this.name = "LoginRequiredError";
    this.code = "LOGIN_REQUIRED";
  }
}

class ConfirmationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfirmationError";
    this.code = "CONFIRMATION_MISSING";
  }
}

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function firstVisible(locators, timeout = 12_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const locator of locators) {
      try {
        const count = await locator.count();
        for (let index = 0; index < count; index += 1) {
          const candidate = locator.nth(index);
          if (await candidate.isVisible({ timeout: 250 })) return candidate;
        }
      } catch {
        // Instagram frequently replaces the composer DOM while media is processing.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

function namedLocators(page, names, roles = ["button", "link", "menuitem", "tab"]) {
  const patterns = names.map((name) => new RegExp(`^\\s*${escapePattern(name)}\\s*$`, "i"));
  return [
    ...patterns.flatMap((pattern) => roles.map((role) => page.getByRole(role, { name: pattern }))),
    ...patterns.map((pattern) => page.getByText(pattern, { exact: true }))
  ];
}

async function clickNamed(page, names, timeout = 15_000, options = {}) {
  const target = await firstVisible(namedLocators(page, names, options.roles), timeout);
  if (!target) throw new Error(`Instagram control not found: ${names.join(" or ")}.`);
  await target.click();
  return target;
}

async function clickIfVisible(page, names, timeout = 1_000) {
  const target = await firstVisible(namedLocators(page, names), timeout);
  if (!target) return false;
  await target.click().catch(() => {});
  return true;
}

async function dismissCommonPrompts(page) {
  for (const label of ["Not Now", "Not now", "Cancel", "Close"]) {
    if (await clickIfVisible(page, [label], 500)) return;
  }
}

async function assertLoggedIn(page) {
  if (page.url().includes("/accounts/login")) throw new LoginRequiredError();
  const loginInput = page.locator('input[name="username"], input[autocomplete="username"]');
  const count = await loginInput.count();
  if (count && (await loginInput.nth(0).isVisible({ timeout: 800 }).catch(() => false))) {
    throw new LoginRequiredError();
  }
}

async function waitForAttachedInput(page, selectors, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const locator = page.locator(selector);
      const count = await locator.count().catch(() => 0);
      if (count) return locator.nth(count - 1);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

async function openComposer(page, baseUrl = DEFAULT_BASE_URL) {
  const root = baseUrl.replace(/\/$/, "");

  // Instagram currently treats /create/select/ as the public @create profile on
  // some accounts. Always open the composer from the signed-in home navigation.
  await page.goto(`${root}/?hl=en`, { waitUntil: "domcontentloaded" });
  await dismissCommonPrompts(page);
  await assertLoggedIn(page);

  const createControl = await firstVisible(
    [
      ...namedLocators(page, ["Create", "New post", "Post"]),
      page.locator('[aria-label="Create"], [aria-label="New post"]'),
      page.locator('a[href*="/create/"]')
    ],
    30_000
  );
  if (!createControl) throw new Error("Instagram control not found: Create or New post.");
  await createControl.click();
  await clickIfVisible(page, ["Reel"], 2_000);

  const input = await waitForAttachedInput(
    page,
    [
      '[role="dialog"] input[type="file"][accept*="video" i]',
      'input[type="file"][accept*="video" i]'
    ],
    15_000
  );
  if (!input) throw new Error("Instagram opened the composer but did not provide a video selector.");
  return input;
}

async function setVideoFile(input, videoPath, page) {
  return setVideoInputFile(input, videoPath, {
    platform: "Instagram",
    isAccepted: page
      ? async () => Boolean(await firstVisible([
        ...namedLocators(page, ["Select crop", "Crop", "Change aspect ratio"]),
        page.locator('[role="dialog"] video, [role="dialog"] button:has-text("Next")')
      ], 300))
      : undefined
  });
}

async function setOriginalAspectRatio(page) {
  const cropControl = await firstVisible(
    [
      ...namedLocators(page, ["Select crop", "Crop", "Change aspect ratio"]),
      page.locator(
        '[aria-label*="select crop" i], [aria-label*="aspect ratio" i], button:has(svg[aria-label*="crop" i])'
      )
    ],
    15_000
  );
  if (!cropControl) return false;

  await cropControl.click();
  const originalOption = await firstVisible(
    [
      ...namedLocators(page, ["Original"], ["button", "menuitem", "option", "radio"]),
      page.getByText(/^\s*Original\s*$/i, { exact: true })
    ],
    8_000
  );
  if (!originalOption) return false;

  await originalOption.click();
  return true;
}

async function setCoverFile(page, thumbnailPath) {
  const coverControl = await firstVisible(namedLocators(page, ["Cover photo", "Edit cover", "Cover"]), 15_000);
  if (!coverControl) return false;
  await coverControl.click();

  let imageInput = await waitForAttachedInput(
    page,
    ['input[type="file"][accept*="image"]', 'input[type="file"][accept*="jpeg"]', 'input[type="file"][accept*="png"]'],
    2_000
  );

  if (!imageInput) {
    const selectButton = await firstVisible(namedLocators(page, ["Select from computer", "Upload from computer"]), 5_000);
    if (!selectButton) return false;

    const chooserPromise = page.waitForEvent("filechooser", { timeout: 8_000 }).catch(() => null);
    await selectButton.click();
    const chooser = await chooserPromise;
    if (chooser) {
      await chooser.setFiles(thumbnailPath);
    } else {
      imageInput = await waitForAttachedInput(page, ['input[type="file"][accept*="image"]', 'input[type="file"]'], 3_000);
      if (!imageInput) return false;
      await imageInput.setInputFiles(thumbnailPath);
    }
  } else {
    await imageInput.setInputFiles(thumbnailPath);
  }

  await clickIfVisible(page, ["Done", "Save"], 8_000);
  return true;
}

async function fillCaption(page, caption) {
  const editor = await firstVisible(
    [
      page.locator('textarea[aria-label*="caption" i]'),
      page.locator('[contenteditable="true"][aria-label*="caption" i]'),
      page.getByRole("textbox", { name: /caption/i })
    ],
    15_000
  );
  if (!editor) throw new Error("Instagram caption field was not found.");
  await editor.fill(caption);
}

async function waitForPositiveConfirmation(page, timeout = 120_000) {
  const confirmation = await firstVisible(
    [
      page.getByText(/your (reel|post) has been shared/i),
      page.getByText(/(reel|post) (was )?shared/i),
      page.getByText(/shared successfully/i),
      page.getByRole("heading", { name: /shared/i })
    ],
    timeout
  );
  return Boolean(confirmation);
}

async function captureFailure(page, screenshotRoot, videoPath, stage) {
  await fs.mkdir(screenshotRoot, { recursive: true });
  const base = path.basename(videoPath).replace(/[^a-z0-9._-]+/gi, "-");
  const prefix = path.join(screenshotRoot, `${Date.now()}-${base}`);
  const screenshotPath = `${prefix}.png`;
  const diagnosticPath = `${prefix}.json`;
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});

  const diagnostics = await page
    .evaluate(() => ({
      url: location.href,
      title: document.title,
      visibleText: document.body?.innerText?.slice(0, 12_000) || "",
      controls: [...document.querySelectorAll("button, a, input, textarea, [role]")].slice(0, 250).map((element) => ({
        tag: element.tagName,
        role: element.getAttribute("role"),
        type: element.getAttribute("type"),
        name: element.getAttribute("name"),
        ariaLabel: element.getAttribute("aria-label"),
        accept: element.getAttribute("accept"),
        text: element.textContent?.trim().slice(0, 160) || ""
      }))
    }))
    .catch(() => ({ url: page.url(), title: "", visibleText: "", controls: [] }));
  await fs.writeFile(diagnosticPath, `${JSON.stringify({ stage, ...diagnostics }, null, 2)}\n`, "utf8").catch(() => {});
  return { screenshotPath, diagnosticPath };
}

async function publishReel({
  page,
  videoPath,
  thumbnailPath,
  caption,
  screenshotRoot,
  onStep = () => {},
  baseUrl = DEFAULT_BASE_URL
}) {
  let stage = "opening Instagram";
  try {
    onStep("Opening Instagram composer");
    await page.bringToFront();
    const videoInput = await openComposer(page, baseUrl);

    stage = "selecting the video";
    onStep("Loading the video into Instagram (large files can take several minutes)");
    await setVideoFile(videoInput, videoPath, page);

    const formatDialog = await firstVisible(namedLocators(page, ["OK", "Continue"]), 2_000);
    if (formatDialog) await formatDialog.click();

    stage = "setting the original aspect ratio";
    onStep("Keeping the original aspect ratio");
    const originalAspectRatioApplied = await setOriginalAspectRatio(page);
    if (!originalAspectRatioApplied) {
      throw new Error(
        "Instagram did not expose its Original aspect-ratio option. The video was not posted to prevent an unwanted crop."
      );
    }

    stage = "waiting for video processing";
    onStep("Preparing the video");
    await clickNamed(page, ["Next"], 120_000);

    // The cover picker is on the edit step. It must be handled before the second Next click.
    stage = "setting the thumbnail";
    onStep("Setting the thumbnail");
    const coverApplied = await setCoverFile(page, thumbnailPath);
    if (!coverApplied) {
      throw new Error("Instagram did not expose its cover image picker on the edit step. The video was not posted.");
    }

    stage = "opening the caption step";
    onStep("Opening caption settings");
    await clickNamed(page, ["Next"], 30_000);

    stage = "adding the caption";
    onStep("Adding the caption");
    await fillCaption(page, caption);

    stage = "sharing the Reel";
    onStep("Sharing the Reel");
    await clickNamed(page, ["Share"], 15_000);

    stage = "waiting for Instagram confirmation";
    onStep("Waiting for Instagram confirmation");
    const confirmed = await waitForPositiveConfirmation(page);
    if (!confirmed) {
      throw new ConfirmationError(
        "Instagram did not show a clear success confirmation. The source video was kept to prevent data loss."
      );
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

module.exports = {
  DEFAULT_BASE_URL,
  VIDEO_FILE_SELECTION_TIMEOUT,
  LoginRequiredError,
  ConfirmationError,
  firstVisible,
  namedLocators,
  clickNamed,
  clickIfVisible,
  waitForAttachedInput,
  captureFailure,
  openComposer,
  publishReel,
  setVideoFile,
  setOriginalAspectRatio,
  setCoverFile,
  waitForPositiveConfirmation
};
