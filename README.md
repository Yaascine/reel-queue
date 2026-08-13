# Reel Queue

Reel Queue is a local macOS and Windows app that uses visible Google Chrome sessions to queue Instagram Reels, YouTube Shorts, and TikTok videos.

Instagram, YouTube, and TikTok are separate top-level sections. Every platform can have multiple independent queue tabs, and every queue has its own account profile, video directory, metadata, timer, activity log, and start/stop controls. Queues with different profiles can run at the same time, including across platforms.

## Download

Download the ready-to-run macOS DMG or Windows installer from the [latest GitHub release](https://github.com/Yaascine/reel-queue/releases/latest).

- macOS build: Apple Silicon
- Windows build: Windows 10/11 x64
- Google Chrome is required

## Platform setup

1. Select Instagram, YouTube, or TikTok at the top of the app.
2. Use the first queue or add another queue for a separate niche.
3. Add an account profile, open that platform's login, and sign in manually in Chrome.
4. Choose that queue's video folder, content details, visibility where available, and interval.
5. Start the queue. Switch platform sections or queue tabs to configure and run others.

Instagram queues use a caption and thumbnail, and explicitly select Instagram's **Original** crop. YouTube queues use a title, description, visibility, and audience setting. YouTube Shorts are accepted only when square or vertical and no longer than three minutes. TikTok queues use a caption and audience setting.

## Files and safety

- Videos are processed in natural filename order.
- MKV, WebM, AVI, WMV, FLV, MPEG, MOV, MP4, M4V, transport streams, and other common containers are supported.
- Compatible H.264/AAC streams are remuxed to MP4 without re-encoding. Incompatible codecs are converted to high-quality H.264/AAC.
- A source file moves to a `posted` subfolder only after the selected platform shows a positive success confirmation. The folder is created automatically.
- A missing confirmation, login, verification prompt, or changed upload interface stops the queue and preserves the source file.
- Failure screenshots and JSON diagnostics are available from **Open diagnostics**.
- Passwords are never stored by Reel Queue. Each profile has a separate local Chrome session.
- Two simultaneous queues cannot control the same account profile.

Browser automation may violate a platform's terms and can trigger verification, posting restrictions, or account loss. Use content you have permission to publish and test cautiously.

## Development

```bash
npm install
npm test
npm start
```

Build installers on their target operating systems:

```bash
npm run dist:mac
npm run dist:win
```

Artifacts are written to `release/`. Unsigned builds may trigger operating-system security warnings. Production signing requires an Apple Developer ID and a Windows code-signing certificate.

## Maintenance

Instagram, YouTube Studio, and TikTok Studio change their interfaces regularly. When a flow changes, inspect the saved screenshot and JSON diagnostics and update the corresponding publisher in `src/`. Keep the positive-confirmation requirement intact because it prevents posted-source files from being moved prematurely.
