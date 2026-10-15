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

The packaged application is `dist/mac-arm64/Reel.app`. It is an unsigned local build for Apple Silicon. Closing the window keeps downloads running; quit using the tray or application menu.

## Windows build

Build on Windows x64 with Node.js 24+, Python 3.12, CMake, Visual Studio 2022 C++ build tools and vcpkg. macOS native binaries cannot be included in a Windows installer.

```powershell
vcpkg install libtorrent:x64-windows-static
cd reel
npm ci
node node_modules/electron/install.js
npm run native -- --runtime electron --runtime-version 44.7.2 --arch x64 --CDCMAKE_TOOLCHAIN_FILE="$env:VCPKG_ROOT/scripts/buildsystems/vcpkg.cmake" --CDVCPKG_TARGET_TRIPLET=x64-windows-static --CDCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded
py -3.12 scripts/subtitle-tools/build.py
npm run typecheck
npm test
npm run build
npm run test:smoke
npm run package:win
```

The Windows installer is emitted into `dist`. Windows compilation and runtime must be verified on a Windows machine before distribution. The timing fixture test currently runs on macOS only.

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
