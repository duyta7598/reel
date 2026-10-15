# Reel Electron

Desktop client for macOS and Windows, using React, TypeScript, Electron and the existing libtorrent C++ engine. Catalogs, torrent providers, download queue, subtitle recommendations, scheduled subtitle acquisition, audio-based timing checks and local preview run in one app.

## macOS development

Requires Node.js 24+, CMake and the native static libraries already included in this repository. Python 3.12 is required only when rebuilding subtitle tools.

```sh
cd ~/app/mine/Reel/electron
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

The packaged application is `dist/mac-arm64/Reel Electron.app`. It is an unsigned local build for Apple Silicon. Closing the window keeps downloads running; quit using the tray or application menu.

## Windows build

Build on Windows x64 with Node.js 24+, Python 3.12, CMake, Visual Studio 2022 C++ build tools and vcpkg. macOS native binaries cannot be included in a Windows installer.

```powershell
vcpkg install libtorrent:x64-windows-static
cd electron
npm ci
node node_modules/electron/install.js
npm run native -- --runtime electron --runtime-version 44.7.2 --arch x64 --CDCMAKE_TOOLCHAIN_FILE="$env:VCPKG_ROOT/scripts/buildsystems/vcpkg.cmake" --CDVCPKG_TARGET_TRIPLET=x64-windows-static --CDCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded
py -3.12 ../scripts/subtitle-tools/build.py
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

TMDB and subtitle providers require the corresponding API keys. Prowlarr is optional through its Torznab endpoint. TV catalogs are supported; season/episode downloading is not yet implemented.

Preview uses the original file when Chromium supports its codecs, with a local FFmpeg compatibility mode otherwise. Compatible preview converts a temporary stream, preserving the source movie. Subtitle timing checks run locally and can reject weak matches; rejected candidates remain available for manual selection. Copy the movie and same-name `.vi.srt` / `.en.srt` files to USB.

## Headless verification

`npm run test:smoke` launches an invisible Electron window with an isolated temporary profile, avoiding the user's active window, library and credential store. Core tests cover matching, providers, independent storage, validation, a real localhost torrent transfer and bundled subtitle alignment.

## Verification — 2026-10-15

- TypeScript checking and production build passed.
- 15 Electron core/integration tests passed, including actual localhost peer transfer, subtitle matching/sync, SQLite migration, redirects and audio timing alignment.
- The installed macOS packaged app passed invisible UI/runtime checks for worker startup, isolated IPC, Settings, light/dark, Vietnamese, library, torrent dialog, actual video playback with subtitle overlay, byte-range seek, preview token protection and compatible transcoding. Tests used synthetic local media and temporary data, without reading saved user API keys.
- Native Swift regression: 36 passed, 1 optional live-network test skipped.
- Authenticated live subtitle-provider downloads and Windows compilation/runtime have not been verified in this migration.
