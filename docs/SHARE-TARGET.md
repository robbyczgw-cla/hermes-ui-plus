# Share to HUI+

Other apps can share links, text, images and files to HUI+. A compact sheet opens where you pick the target, an
optional quick intent and your own instruction. Nothing is sent until you tap **Send** in that sheet.

| Platform | Status | How |
|---|---|---|
| Android | supported | `ACTION_SEND` / `ACTION_SEND_MULTIPLE` intent filters ([expo-share-intent](https://github.com/achorein/expo-share-intent) + `app/plugins/withShareTarget.js`) |
| iOS (native app) | prepared, off by default | share extension from the same library, built only with `HUI_IOS_SHARE_EXTENSION=1` (see [iOS](#ios)) |
| Web app (PWA) | supported where the browser implements Web Share Target (Chrome / Edge on Android and desktop, installed PWA) | `share_target` in `manifest.webmanifest`, handled by the service worker |
| Desktop app (macOS / Linux) | not supported | the Tauri shell has no share target; drag and drop / the dock icon cover the same need there |

## What can be shared

The share sheet takes exactly what the chat composer takes (`app/src/attachments/mime.ts` `classifyFile`):

- **Links**: sent as text. Hermes fetches the page itself; the app does not download it.
- **Text**: sent as it is, cut at 60 000 characters (one Hermes text part); the sheet says so when that happens.
- **Images** (`image/*`, up to 10): prepared like gallery picks (long edge 2048 px, JPEG) and uploaded through the bridge.
- **Files**: PDF, plain text / Markdown / CSV, JSON, YAML, XML, docx, xlsx, up to 20 MB each (`LIMITS.maxUploadBytes`).

Anything else (videos, archives, files over the limit, more than 10 files) is listed in the sheet under "Not sent
along" and never sent. HUI+ does not register for `*/*` or `application/octet-stream`, so it does not show up for
content it would refuse anyway. On Android, sharing images together with a PDF is reported as `*/*` by the system, so
mixed shares of different type families do not list HUI+; share them one type at a time.

## The sheet

- **Send to**: *New chat* (default) or *Last chat* (the most recently used chat with messages whose connection still
  exists; archived and demo chats are skipped). For a new chat with more than one connection, the connection is a
  choice; if the connection has Hermes profiles (bots), the bot is one too (default first).
- **Quick intents**: *Summarize*, *What is this?*, *Translate* (into the app language), *Save for later*. One at a
  time, tap again to clear. The chosen intent becomes the first line of the message, followed by your own instruction
  and then the shared content.
- **Send** opens the target chat and hands the message and files to its composer, which sends through the normal
  path (attachment preparation, bridge upload, offline handling). **Cancel** (or back / backdrop) drops the share.

## States

| Situation | Behaviour |
|---|---|
| App cold-started by the share | the share is kept until stored connections and chats are loaded, then the sheet opens |
| App in the background | the running app is brought to the front (`singleTask`), the sheet opens over the open screen |
| First start / onboarding on screen | the share waits; the sheet opens once the flow is closed |
| Not paired (only the demo connection) | the sheet explains that and offers *Connect*; the share is kept while you pair |
| App lock | the share waits while the app is locked and the sheet opens after unlocking. Today only the desktop app has a lock (and it receives no shares); a future mobile lock plugs into `useAppLocked` in `app/src/share/ShareHost.tsx` |
| Offline, or the upload fails | the files stay in the composer with their error and *Retry*, the text stays in the input, and a notice says so. A text-only message goes to the chat and shows the usual failed state with *Retry* |
| A turn is still running in the last chat | the content waits in the composer with a notice; send it when the answer is done |
| You had unsent text in the target chat | the share is added below it and not sent automatically |
| Unreadable file (no read access, provider error) | listed as "could not be opened" in the sheet instead of a crash (the Android module is patched, see `app/patches/README.md`) |
| Android recreates the activity (font size change) | a share that started the app is not offered a second time |

## Android

`app/plugins/withShareTarget.js` passes the MIME list to expo-share-intent's config plugin, which adds the intent
filters to `MainActivity`. The native module copies shared `content://` files into the app cache; the composer then
imports them like picked documents (`importSharedFiles` in `app/src/attachments/pickers.ts`).

Test on an emulator / device (package `xyz.hermesui.app` for the official flavor):

```sh
# a link or text (works from adb as is)
adb shell am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT "https://example.com/" xyz.hermesui.app
```

Files need a `content://` uri the app may read. A real sender (Files, Photos, a browser download) grants that access
with the share. `adb shell am start … --grant-read-uri-permission` cannot: on API 35 the app gets a `SecurityException`
for a MediaStore uri whether the command runs as root or as the shell user, and the sheet then lists the file as "could
not be opened". The E2E suite (`share_image`, `share_pdf` in `scripts/e2e/suite.py`) therefore serves its test files
through the app's own FileProvider, which runs the same intake path without a cross-app grant.

## iOS

The library can generate a share extension target (`ShareExtension`, bundle id `<app bundle id>.share-extension`) and
an App Group `group.<app bundle id>`. Both derive from the bundle id of the flavor being built (`app.config.ts`), so
the `hermes` and `personal` builds never share them and no id is written into the repository.

It is off by default (`HUI_IOS_SHARE_EXTENSION` unset): the extension needs its own App ID with the App Group
capability in the provisioning, which the automatic-signing path of `scripts/build-ios.sh` can create, but its local
signing fallback (no Apple ID in Xcode, wildcard profile) cannot. To try it:

1. In the Apple Developer account, add the App Group `group.<bundle id>` and enable it for the app's App ID; Xcode's
   automatic signing creates the extension's App ID.
2. Build with `HUI_IOS_SHARE_EXTENSION=1 scripts/build-ios.sh` (device) or `--simulator`.
3. Share from Safari or Photos; the extension hands over to the app (`<scheme>://dataUrl=…`, mapped to `/` in
   `app/src/app/+native-intent.tsx`) and the same sheet opens.

Until that has been verified on a device, the iOS app does not offer sharing.

## Web app

`app/public/manifest.webmanifest` declares `share_target` (POST, `multipart/form-data`, fields `title`, `text`,
`url`, `files`). The service worker (`app/public/sw.js`) answers that POST itself: it stores the share in its own
cache (`hui-share-inbox`, never the app-shell cache), redirects to `/#huiShare=<id>`, and the app reads the entry,
removes the fragment from the address bar and deletes the cached entry as soon as its files are read into memory,
before showing the sheet. Closing the tab therefore leaves no consumed share in Cache Storage. Entries
older than a day are dropped.

If no service worker controls the page yet, the POST reaches the server. The bridge (`BRIDGE_WEB_DIR`) answers it with
`303 /#huiShare=missed` and discards the body; the app then says that the share did not arrive. Builds without a
service worker (`WEB_SW=0`) leave `share_target` out of the manifest. Safari (iOS, macOS) does not implement Web
Share Target, so the iOS home-screen web app is not a share target.
