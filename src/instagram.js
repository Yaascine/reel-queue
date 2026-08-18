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

function isTerminalBrowserError(error) {
  return /browser has been closed|page has been closed|target page.*closed|target closed|crashed/i.test(error?.message || "");
}

async function firstVisible(locators, timeout = 12_000) {
  const deadline = timeout > 0 ? Date.now() + timeout : Number.POSITIVE_INFINITY;
  while (Date.now() < deadline) {
    for (const locator of locators) {
      try {
        const count = await locator.count();
        for (let index = 0; index < count; index += 1) {
          const candidate = locator.nth(index);
          if (await candidate.isVisible({ timeout: 250 })) return candidate;
        }
      } catch (error) {
        if (isTerminalBrowserError(error)) throw error;
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
  const deadline = timeout > 0 ? Date.now() + timeout : Number.POSITIVE_INFINITY;
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const locator = page.locator(selector);
      const count = await locator.count().catch((error) => {
        if (isTerminalBrowserError(error)) throw error;
        return 0;
      });
      if (count) return locator.nth(count - 1);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

async function openComposer(page, baseUrl = DEFAULT_BASE_URL) {
  const root = baseUrl.replace(/\/$/, "");
  const videoInputSelectors = [
    '[role="dialog"] input[type="file"][accept*="video" i]',
    'input[type="file"][accept*="video" i]'
  ];

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
    0
  );
  if (!createControl) throw new Error("Instagram control not found: Create or New post.");
  await createControl.click();

  // Some accounts open a Create flyout containing a second "Post" choice,
  // while others go straight to the file selector. Prefer the direct selector
  // when it appears and only click Post when that intermediate flyout exists.
  let postClicked = false;
  let reelClicked = false;
  while (true) {
    const input = await waitForAttachedInput(page, videoInputSelectors, 500);
    if (input) return input;

    if (!postClicked) {
      const postChoice = await firstVisible(
        [
          page.getByRole("menuitem", { name: /^\s*Post\s*$/i }),
          page.locator('[role="menu"] [role="button"]').filter({ hasText: /^\s*Post\s*$/i }),
          page.getByText(/^\s*Post\s*$/i, { exact: true })
        ],
        500
      );
      if (postChoice) {
        await postChoice.click();
        postClicked = true;
        continue;
      }
    }

    if (!reelClicked && await clickIfVisible(page, ["Reel"], 500)) {
      reelClicked = true;
      continue;
    }
    await assertLoggedIn(page);
  }
}

async function setVideoFile(input, videoPath, page) {
  return setVideoInputFile(input, videoPath, {
    platform: "Instagram",
    page,
    isAccepted: page
      ? async () => Boolean(await firstVisible([
        ...namedLocators(page, ["Select crop", "Crop", "Change aspect ratio"]),
        page.locator('[role="dialog"] video, [role="dialog"] button:has-text("Next")')
      ], 300))
      : undefined
  });
}

function originalOptionLocators(page) {
  return [
    ...namedLocators(page, ["Original"], ["button", "menuitem", "option", "radio"]),
    page.getByText(/^\s*Original\s*$/i, { exact: true })
  ];
}

function aspectRatioControlLocators(page) {
  const hint = /(select|change|adjust|choose|toggle)?\s*(crop|aspect ratio|media size|resize|expand|fit)/i;
  return [
    ...namedLocators(page, [
      "Select crop", "Crop", "Change aspect ratio", "Aspect ratio", "Adjust crop",
      "Choose crop", "Toggle crop", "Media size", "Resize", "Expand", "Fit"
    ]),
    page.getByRole("button", { name: hint }),
    page.locator([
      '[aria-label*="crop" i]', '[aria-label*="aspect" i]', '[aria-label*="media size" i]',
      '[aria-label*="resize" i]', '[aria-label*="expand" i]', '[title*="crop" i]',
      '[title*="aspect" i]', '[title*="resize" i]', '[title*="expand" i]',
      'button:has(svg[aria-label*="crop" i])', '[role="button"]:has(svg[aria-label*="crop" i])',
      'button:has(svg[aria-label*="aspect" i])', '[role="button"]:has(svg[aria-label*="aspect" i])',
      'button:has(svg[aria-label*="expand" i])', '[role="button"]:has(svg[aria-label*="expand" i])'
    ].join(", "))
  ];
}

async function structuralAspectRatioControls(page) {
  const dialogs = page.locator('[role="dialog"]:visible');
  const dialogCount = await dialogs.count().catch(() => 0);
  const scope = dialogCount ? dialogs.nth(dialogCount - 1) : page.locator("body");
  const scopeBox = await scope.boundingBox().catch(() => null);
  if (!scopeBox) return [];

  const mediaElements = scope.locator("video:visible, canvas:visible, img:visible");
  let mediaBox = null;
  for (let index = 0, count = await mediaElements.count().catch(() => 0); index < count; index += 1) {
    const box = await mediaElements.nth(index).boundingBox().catch(() => null);
    if (box && (!mediaBox || box.width * box.height > mediaBox.width * mediaBox.height)) mediaBox = box;
  }
  const anchor = mediaBox || scopeBox;
  const controls = scope.locator('button:visible, [role="button"]:visible');
  const ranked = [];
  for (let index = 0, count = await controls.count().catch(() => 0); index < count; index += 1) {
    const control = controls.nth(index);
    const box = await control.boundingBox().catch(() => null);
    if (!box || box.width < 18 || box.height < 18 || box.width > 110 || box.height > 110) continue;
    const details = await control.evaluate((element) => ({
      text: (element.textContent || "").trim(),
      label: [
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        ...[...element.querySelectorAll("svg")].flatMap((svg) => [
          svg.getAttribute("aria-label"), svg.getAttribute("title"), svg.querySelector("title")?.textContent
        ])
      ].filter(Boolean).join(" ")
    })).catch(() => ({ text: "", label: "" }));
    const description = `${details.label} ${details.text}`.trim();
    if (/next|back|cancel|close|share|multiple|carousel|gallery|select from|computer/i.test(description)) continue;

    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    const isAspectHint = /crop|aspect|resize|expand|fit|media size/i.test(description);
    const isBottomLeftIcon = details.text.length === 0
      && centerX >= anchor.x - 20
      && centerX <= anchor.x + anchor.width * 0.45
      && centerY >= anchor.y + anchor.height * 0.5
      && centerY <= anchor.y + anchor.height + 20;
    if (!isAspectHint && !isBottomLeftIcon) continue;

    const targetX = anchor.x + Math.min(42, anchor.width * 0.08);
    const targetY = anchor.y + anchor.height - Math.min(42, anchor.height * 0.08);
    const distance = Math.hypot(centerX - targetX, centerY - targetY);
    ranked.push({ control, score: (isAspectHint ? -10_000 : 0) + distance });
  }
  return ranked.sort((left, right) => left.score - right.score).map(({ control }) => control);
}

async function clickOriginalOption(page, timeout = 800) {
  const option = await firstVisible(originalOptionLocators(page), timeout);
  if (!option) return false;
  await option.click({ force: true });
  return true;
}

async function setOriginalAspectRatio(page) {
  while (true) {
    // Some account variants leave the aspect-ratio menu open after processing.
    if (await clickOriginalOption(page, 300)) return true;

    const labelledControl = await firstVisible(aspectRatioControlLocators(page), 700);
    if (labelledControl) {
      await labelledControl.click({ force: true }).catch(() => {});
      if (await clickOriginalOption(page, 2_500)) return true;
    }

    // Instagram's newer composer renders the lower-left crop arrow as an
    // unlabeled div. Rank only small icon controls in the lower-left of the
    // active media preview so the lower-right multiple-files button is ignored.
    for (const control of await structuralAspectRatioControls(page)) {
      await control.click({ force: true }).catch(() => {});
      if (await clickOriginalOption(page, 2_500)) return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function setCoverFile(page, thumbnailPath) {
  const coverControl = await firstVisible(namedLocators(page, ["Cover photo", "Edit cover", "Cover"]), 0);
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
    0
  );
  if (!editor) throw new Error("Instagram caption field was not found.");
  await editor.fill(caption);
}

async function waitForPositiveConfirmation(page, timeout = 0) {
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
  onSubmitted = async () => {},
  onStep = () => {},
  baseUrl = DEFAULT_BASE_URL
}) {
  let stage = "opening Instagram";
  try {
    onStep("Opening Instagram composer");
    await page.bringToFront();
    const videoInput = await openComposer(page, baseUrl);

    stage = "selecting the video";
    onStep("Uploading the prepared MP4 to Instagram");
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
    await clickNamed(page, ["Next"], 0);

    // The cover picker is optional. With no chosen image Instagram keeps its automatic video-frame cover.
    if (thumbnailPath) {
      stage = "setting the thumbnail";
      onStep("Setting the thumbnail");
      const coverApplied = await setCoverFile(page, thumbnailPath);
      if (!coverApplied) {
        throw new Error("Instagram did not expose its cover image picker on the edit step. The video was not posted.");
      }
    }

    stage = "opening the caption step";
    onStep("Opening caption settings");
    await clickNamed(page, ["Next"], 0);

    stage = "adding the caption";
    onStep("Adding the caption");
    await fillCaption(page, caption);

    stage = "sharing the Reel";
    onStep("Sharing the Reel");
    await clickNamed(page, ["Share"], 0);
    await onSubmitted();

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
