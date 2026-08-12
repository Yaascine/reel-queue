# Reel Queue

Reel Queue is a local desktop application for macOS and Windows. It uses a visible Google Chrome window to post videos through Instagram's normal web interface.

## Download

Download the ready-to-run macOS DMG or Windows installer from the [latest GitHub release](https://github.com/Yaascine/reel-queue/releases/latest).

- macOS build: Apple Silicon
- Windows build: Windows 10/11 x64
- Google Chrome is required

## Safety behavior

- Instagram passwords are never stored by Reel Queue. Each account profile has a separate Chrome session directory.
- Account switching is manual. The app does not rotate profiles automatically when Instagram restricts an account.
- A source video is moved to the operating system Trash or Recycle Bin only after Instagram displays a positive sharing confirmation.
- When confirmation is missing, the source video remains untouched and a screenshot is saved in the application's data directory.
- A matching JSON diagnostic is saved beside each failure screenshot. Use **Open diagnostics** in the Activity panel to inspect it.
- Stop requests finish the current browser action safely, then prevent the next upload.

Browser automation can violate Instagram's terms and may result in verification prompts, posting restrictions, or account loss. Test with an account you can afford to lose.

## Troubleshooting

The app opens Instagram's composer from the signed-in home navigation, then follows the current two-screen workflow: video edit and cover selection first, caption and sharing second. If Instagram changes this flow again, Reel Queue stops without deleting the video and captures the current controls for diagnosis.

If a run reports that login is required, select the account profile, click **Open Instagram login**, finish login or verification in Chrome, and retry. Do not close the Chrome window while a queue is running.

## Requirements

- macOS 12 or newer, or Windows 10/11
- Google Chrome
- Node.js 20 or newer for development

## Run from source

```bash
npm install
npm start
```

In the app:

1. Add an account profile.
2. Click **Open Instagram login** and sign in manually in Chrome.
3. Return to Reel Queue and choose the video folder, thumbnail, caption, and interval.
4. Click **Start queue**.

Videos are processed in natural filename order. Supported extensions are MP4, MOV, and M4V.

## Build clickable applications

On macOS:

```bash
npm run dist:mac
```

On Windows:

```powershell
npm run dist:win
```

Installers and portable builds are written to `release/`. Build the Windows installer on Windows and the signed macOS installer on macOS for production distribution.

For a quick unpacked Windows x64 build, run `npm run pack:win`. Its clickable executable is `release/win-unpacked/Reel Queue.exe`.

Unsigned builds may trigger operating system security warnings. Code signing requires your own Apple Developer ID and Windows signing certificate.

## Maintenance note

Instagram changes its web interface regularly. If the posting flow stops, open the saved failure screenshot and update the accessible labels in `src/instagram.js`. The conservative confirmation rule should not be weakened because it protects source videos from accidental deletion.
