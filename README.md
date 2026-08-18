# Reel Queue

Reel Queue is a local macOS and Windows app that uses visible Google Chrome sessions to queue Instagram Reels, YouTube Shorts, and TikTok videos.

Instagram, YouTube, and TikTok are separate top-level sections. Every platform can have multiple independent queue tabs, and every queue has its own account profile, empty Chrome data directory, video directory, metadata, timer, activity log, and start/stop controls. Adding a queue automatically creates and selects its fresh account session; profiles already assigned to another queue are not offered for reuse. Queues can run at the same time, including across platforms.

## Download

Download the ready-to-run macOS DMG or Windows installer from the [latest GitHub release](https://github.com/Yaascine/reel-queue/releases/latest).

- macOS build: Apple Silicon
- Windows build: Windows 10/11 x64
- Google Chrome is required

## Platform setup

1. Select Instagram, YouTube, or TikTok at the top of the app.
2. Use the first queue or add another queue for a separate niche.
3. Add an account profile, open that platform's login, and sign in manually in Chrome.
4. Choose that queue's video folder, content details, visibility where available, and either a fixed or randomized interval. Gaps can use whole minutes or seconds; set the fixed gap to `0` (or the random range to `0–0`) to start the next post immediately.
5. Start the queue. Switch platform sections or queue tabs to configure and run others.

Instagram queues explicitly select Instagram's **Original** crop. A queue can let Instagram choose its cover automatically, reuse one image, or randomly select an image from a thumbnail folder for every Reel. It can also use one fixed caption or randomly select from a saved caption pool. YouTube Short titles come from each source filename with only the final extension removed and are safely trimmed to YouTube's 100-character limit; saved description pools can be shuffled per upload, and the uploader selects one of YouTube's generated video-frame thumbnail options when available. TikTok captions come from each source filename with only the final extension removed. Both platforms default to public visibility, while their queue visibility controls remain available. YouTube Shorts are accepted only when square or vertical and no longer than three minutes.

Reel Queue allows up to 22 accepted uploads per account profile, then starts a full 24-hour cooldown from that account's newest (22nd) accepted upload. When the cooldown ends, that account receives a fresh allowance of 22 and its queue resumes automatically; other account profiles continue independently. This limit tracks uploads made by Reel Queue, not posts made manually outside the app.

Queue control shows the current account's accepted-upload count, remaining allowance, and cooldown state. TikTok confirmation uses success messages, Studio navigation, and upload-form reset signals; if TikTok removes every visible success signal after accepting the final Post action, Reel Queue continues instead of waiting forever or retrying the same video.

## Files and safety

- Videos are processed in natural filename order.
- MKV, WebM, AVI, WMV, FLV, MPEG, MOV, MP4, M4V, transport streams, and other common containers are supported.
- Compact H.264/AAC streams are remuxed to MP4 without re-encoding. Videos that are oversized, above 30 FPS, above the fast-upload bitrate, or use incompatible codecs are converted into smaller H.264/AAC MP4s.
- Fast conversion automatically tries Apple VideoToolbox, NVIDIA NVENC, Intel Quick Sync, or AMD AMF. If no compatible GPU is available, it falls back to fast CPU encoding instead of failing the queue.
- Fast uploads preserve the source aspect ratio, cap oversized vertical video at 1080×1920 (landscape at 1920×1080), target 7 Mbps video with a 9 Mbps ceiling, and use 128 kbps AAC audio.
- The next daily batch is prepared with two background converter workers. Prepared MP4s are cached across safe stops and restarts, so stopping before upload 22 does not discard completed conversion work.
- Files over 50 MB are passed to the local Chrome session directly instead of through Playwright's remote-transfer channel.
- Upload, processing, and final-confirmation waits do not expire while Chrome remains open, so slow connections are not treated as failures.
- A source file moves to a `posted` subfolder after positive confirmation, or after the platform accepted the final submission click but its success screen could not be read. The folder is created automatically.
- The app records the platform's final submission handoff before waiting for the success screen. If that screen changes or Windows briefly locks the history file, the source is still moved and excluded from retry to prevent duplicate posts.
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
