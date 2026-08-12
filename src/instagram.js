const path = require("node:path");

class LoginRequiredError extends Error {
  constructor(message = "Instagram login is required for this account profile.") {
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

async function firstVisible(locators, timeout = 12_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const locator of locators) {
      try {
        if (await locator.first().isVisible({ timeout: 300 })) return locator.first();
      } catch {
        // The interface may be re-rendering while controls are checked.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

async function clickNamed(page, names, timeout = 15_000) {
  const patterns = names.map((name) => new RegExp(`^${name}$`, "i"));
  const locators = patterns.flatMap((pattern) => [
    page.getByRole("button", { name: pattern }),
    page.getByRole("link", { name: pattern }),
    page.getByText(pattern, { exact: true })
  ]);
  const target = await firstVisible(locators, timeout);
  if (!target) throw new Error(`Instagram control not found: ${names.join(" or ")}.`);
  await target.click();
}

async function dismissCommonPrompts(page) {
  for (const label of ["Not Now", "Cancel"]) {
    const button = await firstVisible(
      [page.getByRole("button", { name: new RegExp(`^${label}$`, "i") })],
      800
    );
    if (button) await button.click().catch(() => {});
  }
}

async function assertLoggedIn(page) {
  if (page.url().includes("/accounts/login")) throw new LoginRequiredError();
  const loginInput = page.locator('input[name="username"]');
  if (await loginInput.isVisible({ timeout: 1000 }).catch(() => false)) throw new LoginRequiredError();
}

async function setVideoFile(page, videoPath) {
  const input = page.locator('input[type="file"]').first();
  await input.waitFor({ state: "attached", timeout: 15_000 });
  await input.setInputFiles(videoPath);
}

async function setCoverFile(page, thumbnailPath) {
  await clickNamed(page, ["Cover photo", "Edit cover"], 8_000).catch(() => {});

  const imageInput = page.locator('input[type="file"][accept*="image"]');
  if (await imageInput.count()) {
    await imageInput.last().setInputFiles(thumbnailPath);
    await clickNamed(page, ["Done", "Save"], 8_000).catch(() => {});
    return true;
  }

  const selectButton = await firstVisible(
    [
      page.getByRole("button", { name: /select from computer/i }),
      page.getByText(/select from computer/i)
    ],
    4_000
  );
  if (!selectButton) return false;
  await selectButton.click();

  const inputs = page.locator('input[type="file"]');
  if (!(await inputs.count())) return false;
  await inputs.last().setInputFiles(thumbnailPath);
  await clickNamed(page, ["Done", "Save"], 8_000).catch(() => {});
  return true;
}

async function fillCaption(page, caption) {
  const editor = await firstVisible(
    [
      page.locator('textarea[aria-label*="caption" i]'),
      page.locator('[contenteditable="true"][aria-label*="caption" i]'),
      page.getByRole("textbox", { name: /caption/i })
    ],
    12_000
  );
  if (!editor) throw new Error("Instagram caption field was not found.");
  await editor.fill(caption);
}

async function waitForPositiveConfirmation(page, timeout = 90_000) {
  const confirmation = await firstVisible(
    [
      page.getByText(/your (reel|post) has been shared/i),
      page.getByText(/(reel|post) shared/i),
      page.getByRole("heading", { name: /shared/i })
    ],
    timeout
  );
  return Boolean(confirmation);
}

async function captureFailure(page, screenshotRoot, videoPath) {
  const base = path.basename(videoPath).replace(/[^a-z0-9._-]+/gi, "-");
  const output = path.join(screenshotRoot, `${Date.now()}-${base}.png`);
  await page.screenshot({ path: output, fullPage: true }).catch(() => {});
  return output;
}

async function publishReel({ page, videoPath, thumbnailPath, caption, screenshotRoot, onStep }) {
  try {
    onStep("Opening Instagram");
    await page.bringToFront();
    await page.goto("https://www.instagram.com/?hl=en", { waitUntil: "domcontentloaded" });
    await dismissCommonPrompts(page);
    await assertLoggedIn(page);

    onStep("Opening the Reel composer");
    await clickNamed(page, ["Create"]);
    const reelChoice = await firstVisible(
      [page.getByRole("button", { name: /reel/i }), page.getByText(/^reel$/i)],
      2_500
    );
    if (reelChoice) await reelChoice.click();

    onStep("Selecting the video");
    await setVideoFile(page, videoPath);

    const formatDialog = await firstVisible(
      [page.getByRole("button", { name: /ok/i }), page.getByRole("button", { name: /continue/i })],
      2_000
    );
    if (formatDialog) await formatDialog.click();

    onStep("Preparing the video");
    await clickNamed(page, ["Next"], 90_000);
    await clickNamed(page, ["Next"], 90_000).catch(() => {});

    onStep("Setting the thumbnail");
    const coverApplied = await setCoverFile(page, thumbnailPath);
    if (!coverApplied) {
      throw new Error("Instagram did not expose its cover image picker. The video was not posted.");
    }

    onStep("Adding the caption");
    await fillCaption(page, caption);

    onStep("Sharing the Reel");
    await clickNamed(page, ["Share"], 15_000);

    onStep("Waiting for Instagram confirmation");
    const confirmed = await waitForPositiveConfirmation(page);
    if (!confirmed) {
      throw new ConfirmationError(
        "Instagram did not show a clear success confirmation. The source video was kept to prevent data loss."
      );
    }

    return { confirmed: true };
  } catch (error) {
    error.screenshotPath = await captureFailure(page, screenshotRoot, videoPath);
    throw error;
  }
}

module.exports = {
  LoginRequiredError,
  ConfirmationError,
  firstVisible,
  publishReel,
  waitForPositiveConfirmation
};
