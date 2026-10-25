# Reel mobile

React Native / Expo development build for Android and iOS. The app pairs with Reel desktop, lists completed movies and TV episodes, and copies original video and available Vietnamese/English SRT files for offline use. It has no torrent engine and no built-in player.

## Run locally

Use Node.js 24+. Install dependencies inside this folder:

```sh
npm ci --registry=https://registry.npmjs.org
npm run typecheck
npm start
```

A native development build is required for the configured Files access, local network permissions, background transfer, secure credentials and SQLite storage. With Xcode/iOS tooling or an Android SDK/device configured, create that build locally:

```sh
npm run ios
npm run android
```

Run only the command for the platform you want to install. Expo Go is not the acceptance target. No EAS account or cloud build is required for local development. iPhone installation requires the normal Xcode device-signing setup.

## Copy movies

1. Run the updated desktop source (`npm run dev` from the repository root), or package/install a desktop build containing Mobile transfer. The previously published Windows 0.2.0 test installer predates this feature.
2. On desktop, open Settings → Mobile transfer → Start sharing. Sharing starts only on explicit activation and stops when disabled or Reel quits.
3. Put both devices on the same trusted private Wi-Fi. Allow incoming access for Reel on the computer if the operating system asks. Desktop uses TCP port 47653. Guest/client-isolated Wi-Fi may prevent devices from reaching each other.
4. In the mobile Connect tab, scan the QR code or paste the pairing link from desktop. Codes expire after five minutes and work once. Choose the computer's Wi-Fi address on desktop if it has several network interfaces.
5. Open On PC, refresh, and select Save to phone. Each item includes the original video and existing SRT files. Files are checked for size and MD5 integrity before being marked available offline.
6. Use On phone → Open in another app. On Android, Save video and subtitles to a folder copies the files to a folder chosen with the system picker. On iOS, use Files → On My iPhone → Reel → Movies to select videos and matching subtitles from your preferred player. Player support for opening documents in place and importing SRT files varies.
7. The computer can be turned off after the files are saved. Removing an item in the mobile app deletes only its local copy.

## Transfer behavior

The native HTTP downloader supports pausing and resuming. The queue is persisted in app-private SQLite; credentials are kept in the platform credential store. Files and partial downloads live in Documents/Movies. The app retains completed files after a disconnect. Desktop remembers hashed device tokens; revoke a phone in Mobile transfer to remove its access and stop that phone's active transfers.

On app relaunch, interrupted entries are paused for manual continuation. Fully downloaded partial files are checked and adopted; an interrupted native task without saved resume data starts its current file again. Background transfer behavior, process termination and screen-lock recovery still require validation on physical Android/iOS devices. The app does not claim unrestricted background execution.

Local transfer uses HTTP on the private LAN. There is no relay, remote Internet access or cloud sync. Browser-origin requests are refused. The API is read-only and exposes only completed library items, not arbitrary filesystem paths or desktop credentials. Tokens grant access to the completed library until revoked.

Videos are copied in their original format without transcoding. The external app must support that format. Exporting to another folder/player can create an additional copy and require more storage. Files in Reel's own container are removed if Reel is uninstalled; export anything you want to retain independently.

## Verification

```sh
npm run typecheck
npm run export:check
```

Repository-root tests cover the transfer API and the platform-independent queue. Desktop smoke tests use an invisible Electron window and an isolated profile/server bound to loopback. Native mobile installation and physical-device acceptance testing are separate from JavaScript bundle verification.
