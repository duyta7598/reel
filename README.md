# Reel Electron

Desktop client for macOS and Windows, using React, TypeScript, Electron and the existing libtorrent C++ engine. Catalogs, torrent providers, download queue, subtitle recommendations, scheduled subtitle acquisition, audio-based timing checks and local preview run in one app.

## macOS development

Requires Node.js 24+, Xcode Command Line Tools and CMake. The engine source is in `native/engine`; native static libraries, headers, subtitle executables and licenses are included in `Vendor`. No sibling Swift project is required. Python 3.12 is required only when rebuilding subtitle tools.

```sh
cd /Users/duyta/app/mine/reel
npm ci
node node_modules/electron/install.js
npm run native -- --runtime electron --runtime-version 44.7.2 --arch arm64
npm run dev
```

```sh
npm run typecheck
npm test
npm run build
npm run test:smoke
npm run package:mac
```

The packaged application is `dist/mac-arm64/Reel.app`. It is an ad-hoc-signed local build for Apple Silicon, without a Developer ID. Closing the window keeps downloads running; quit using the tray or application menu.

## Windows build

Build on Windows x64 with Node.js 24+, Python 3.12, CMake, Visual Studio 2022 C++ build tools and vcpkg. macOS native binaries cannot be included in a Windows installer.

```powershell
cd reel
npm ci
node node_modules/electron/install.js
npm run native -- --runtime electron --runtime-version 44.7.2 --arch x64 --CDCMAKE_TOOLCHAIN_FILE="$env:VCPKG_ROOT/scripts/buildsystems/vcpkg.cmake" --CDVCPKG_MANIFEST_DIR="$PWD/native" --CDVCPKG_OVERLAY_TRIPLETS="$PWD/native/triplets" --CDVCPKG_TARGET_TRIPLET=x64-windows-static --CDCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded
py -3.12 scripts/subtitle-tools/build.py
npm run typecheck
npm test
npm run build
npm run test:smoke
npm run package:win
```

The Windows installer is emitted into `dist`. Windows compilation and runtime must be verified on a Windows machine before distribution. The timing fixture test currently runs on macOS only.

GitHub Actions → Windows installer → Run workflow builds Windows x64 on demand, caches native dependencies and subtitle tools, checks localhost torrent transfer and the packaged app, and saves the installer in a draft prerelease. The job has a 90-minute timeout and does not run automatically on pushes.

## Data and credentials

macOS data: `~/Library/Application Support/Reel Electron`. Windows data: `%APPDATA%/Reel Electron`.

Reel Electron uses its own library and settings. It does not import data or credentials from the Swift app.

Enter API keys directly in Settings. Secrets are encrypted using Electron safeStorage and cached in memory; they are never sent to the renderer.

TMDB and subtitle providers require the corresponding API keys. Prowlarr is optional through its Torznab endpoint. TV shows support selecting an entire season or one episode. TV metadata requires a TMDB token; torrent results depend on your configured sources. Internet Archive is used for movie searches only.

Preview uses the original file when Chromium supports its codecs, with a local FFmpeg compatibility mode otherwise. Compatible preview converts a temporary stream, preserving the source movie. Subtitle timing checks run locally and can reject weak matches; rejected candidates remain available for manual selection. Copy the movie and same-name `.vi.srt` / `.en.srt` files to USB.

## 1337x source

1337x is included in the default torrent sources for movies and TV shows and requires no API key. Existing profiles receive the source once; deleting it afterwards is respected. Its endpoint can be edited in Settings → Torrent sources.

Search reads the result table and the selected release's detail page is resolved to a magnet only when starting the download. Cloudflare challenges, blocked HTTP responses and missing magnets produce an explicit error. If direct access is blocked, use a reachable official endpoint or configure the indexer through the existing Torznab connector.

Fixture tests cover parsing, category selection, magnet resolution, duplicate detection and profile upgrades. The live probe to `https://1337x.to` was blocked in the development environment; live search/download from that endpoint remains unverified.

## Network and WARP

Settings → Network defaults to Automatic with `http://127.0.0.1:40000`. Install and open Cloudflare WARP once; Reel can then prepare its local proxy mode automatically. WARP must remain running. Prepare WARP switches WARP from full-device tunneling to local proxy mode.

Automatic tries direct HTTP requests first and retries supported blocked or failed requests through WARP. TMDB metadata/posters, torrent-source HTTP requests and subtitle providers can be routed separately. Native torrent peer/tracker traffic stays outside Reel's HTTP proxy. Local network services remain direct.

Advanced settings allow editing the proxy URL, disabling automatic WARP management and selecting which service groups use the proxy. Direct disables proxy routing; Always proxy requires the configured proxy for enabled groups. Test connection checks TMDB reachability without sending an API key. Proxy routing does not solve every provider's anti-bot challenge.

## TV downloads

Open a TV show in Discover, choose a season and either Entire season or an episode, then find releases and select a torrent. Season searches omit single-episode releases; episode searches can also use a season pack when its title contains the season number.

The engine selects videos matching the requested season/episode and skips samples, trailers and extras. Supported names include `S01E02`, `1x02`, and numbered videos inside a `Season 1` folder. A torrent with no matching episodes displays an error instead of downloading an unrelated video.

Each torrent is managed as one download. Its Episodes list shows individual file progress. A completed episode is available in Library while other episodes continue downloading. Pause/resume affects the entire torrent. Playback, subtitle search/import, alignment and restoration operate on the selected episode; subtitles are saved beside that episode's video. Full-season subtitle ZIPs are filtered by episode filename and ambiguous archives require manual import.

## Headless verification

`npm run test:smoke` launches an invisible Electron window with an isolated temporary profile, avoiding the user's active window, library and credential store. Core tests cover matching, providers, independent storage, validation, HTTP proxy routing, authorized poster delivery, a real localhost torrent transfer and bundled subtitle alignment. Set `REEL_TEST_WARP=1` to include a live TMDB check through the installed WARP proxy in the isolated smoke profile.

## Verification — 2026-10-15

- Native ARM64 engine rebuilt from the project-local source and static libraries with a fresh CMake cache.
- TypeScript checking and all 37 core/integration tests passed, including localhost peer transfer, independent SQLite storage, season/episode selection, per-episode subtitle sync, season ZIP selection and audio timing alignment.
- `npm run package:mac` produced `dist/mac-arm64/Reel.app` without Developer ID signing.
- The packaged app passed invisible smoke checks for native worker startup, isolated IPC, Settings, light/dark, Vietnamese, library, torrent dialog, video playback, subtitle overlay, byte-range seek, local server authorization, compatible preview, TV episode lists and separate video/subtitle playback for two episodes. Checks used synthetic local media and an isolated temporary profile.
- Network settings passed packaged smoke checks; live TMDB requests succeeded through both HTTP and SOCKS5 WARP proxy connections, and a TMDB poster returned HTTP 200. Internet torrent swarms on the home connection remain unverified.
- Authenticated live subtitle-provider downloads and Windows compilation/runtime remain unverified.

## Mobile offline transfers

The `mobile` folder contains the Android/iOS Expo app for browsing the desktop library and saving original videos plus SRT subtitles offline. Open Settings → Mobile transfer on desktop to enable local sharing and pair a phone by QR. Sharing is off by default. Phones use external apps to open saved files. See `mobile/README.md` for local development, transfer behavior, storage/export options and device-testing limits.

## Desktop updates

Settings → Updates checks for stable versions, downloads in the background, shows progress and release notes, and offers Restart to update. Windows applies the update silently and reopens Reel without an installer wizard. The installer also recognizes the updater flag from older builds and switches to silent update mode. Checks also run at startup and every six hours. Downloads, active mobile file transfers and subtitle tasks must be paused or finished before applying an update. Closing the window or quitting normally does not trigger installation. Library/settings remain in the existing Reel Electron data directory; downloaded media stays in its selected folder.

Source code and update files are hosted together in the public repository `duyta7598/reel`. No GitHub access token is shipped with the app. Drafts and prereleases are ignored. Each stable release must have a higher package.json version than the previous one; overwrite neither an existing version nor its files. Existing 0.2.0 installations need one manual install of an updater-enabled build.

Windows uses NSIS. Build with `npm run package:win:release`; upload the generated installer, its `.blockmap`, and `latest.yml` together to a draft `v<version>` release. Validate the draft before publishing. In the Windows workflow, enable `update_release` to save a stable draft in the same repository using the built-in workflow token; no separate release token is needed. A push to main that changes package.json automatically builds a stable update draft; manual workflow runs also default to a stable draft. Set update_release to false only for a test prerelease draft. Drafts remain invisible to the updater until build validation passes and the releases are published. Releases use an empty description.

macOS local builds (`npm run package:mac`) use ad-hoc signing and display that automatic updates are unavailable. To build a distributable update, set `REEL_MAC_SIGN_IDENTITY` to a Developer ID Application identity and run `npm run package:mac:release`. This produces signed DMG/ZIP targets; configure notarization with Apple credentials as required for distribution. Upload DMG, ZIP, blockmaps and `latest-mac.yml` to the same version's draft release. Keep the same signing identity/team and app ID across updates. A macOS release build refuses to proceed without the signing identity. Builds and publishing are separate; these commands never publish automatically.

Controller tests cover check/download errors, retries, concurrent checks, busy-task blocking and shutdown ordering. The hidden packaged smoke test checks Settings and unsigned-build gating. A real Windows installed-app upgrade and signed macOS upgrade still need verification with two released versions before relying on the updater for distribution.

## Removing library items

Remove from library keeps files by default. Enable Also delete movie files from disk to permanently delete known videos (including partial downloads) and matching English/Vietnamese SRT files and timing backups. For a season this applies to all its known episodes. Other files and folders remain. Paths outside the movie folder and files shared with another library item are rejected. Subtitle processing and active mobile transfers must finish first. A file error keeps the library entry so deletion can be retried; files already deleted before an error cannot be restored.

The background tray now uses the bundled Reel icon rather than a placeholder. Windows uses its multi-resolution ICO for both tray and window icons; macOS uses a small color Reel icon.

New releases are published with an empty description; no description approval step is required. Existing release descriptions are left unchanged. The Windows workflow builds and validates a draft before publication.

Windows windows do not display the native application menu bar. Existing 0.3.1+ Windows installations use Settings → Updates and Restart to update; no manual installer download is needed for published stable versions. The 0.3.0 build still targets the old release repository and needs the previously agreed one-time transition install. The app still downloads update data in the background; initial installation remains available through the installer.
