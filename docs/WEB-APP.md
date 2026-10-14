# Install the Hermes UI+ web app (PWA)

The web app is the same Hermes Interactive UI+ app that runs on Android and iOS, built for the browser. You open it from your own bridge, and you can install it to the home screen so it behaves like an app (own icon, full screen, notifications).

There is nothing to sign up for and no store. The bridge serves the web app, and everything stays between your device and your bridge.

## What you need

| Need | Details |
|---|---|
| A running UI-Bridge | See [SELF-HOSTING.md](SELF-HOSTING.md). The wizard (`npx hermes-ui-plus-bridge setup`) does the whole setup. |
| HTTPS | Browsers only allow installing, the offline copy and push on secure origins. `tailscale serve` gives you a valid certificate on your tailnet ([SELF-HOSTING.md](SELF-HOSTING.md), section 3). Over plain `http://` on the LAN the web app only runs in a browser tab. For a first test, a browser on the bridge machine itself is enough: `http://127.0.0.1` counts as secure (see [First test without HTTPS](#first-test-without-https)). |
| The web bundle | A prebuilt release file (below), or build it yourself. |
| A modern browser | Safari (iOS 16.4+, or Safari 17+ on macOS 13 or newer), Chrome, Edge or Firefox. |

Do not expose the bridge to the public internet. Stay on your tailnet or trusted LAN.

## 1. Get the bundle on the server

Download these two files from the [GitHub Releases](https://github.com/robbyczgw-cla/hermes-ui-plus/releases) page onto the machine that runs the bridge:

- `hermes-ui-plus-web-<version>.tar.gz`
- `hermes-ui-plus-web-<version>.tar.gz.sha256`

First pick the folder to match how the bridge runs. If you used the setup wizard as a normal user (the usual case), it is the second row.

| Bridge runs as | Extract to | Why |
|---|---|---|
| systemd system unit (root setup) | `/opt/hermes-ui-plus-web` | The unit uses `ProtectHome`, so it cannot read your home directory. |
| systemd user unit, launchd, `npx` | `~/.local/share/hermes-ui-plus-web` | No root needed. |
| Docker | a folder you mount into the container | Set `BRIDGE_WEB_DIR` to the path inside the container. |

Verify and unpack (replace `<version>`, for example `0.1.0-alpha.1`), here into `~/.local/share/hermes-ui-plus-web`:

```bash
sha256sum -c hermes-ui-plus-web-<version>.tar.gz.sha256        # must print: OK
mkdir -p ~/.local/share/hermes-ui-plus-web
tar -xzf hermes-ui-plus-web-<version>.tar.gz -C ~/.local/share/hermes-ui-plus-web --strip-components=1
```

For `/opt/hermes-ui-plus-web`, run `mkdir` and `tar` with `sudo`. On macOS, use `shasum -a 256 -c` instead of `sha256sum -c`.

The archive keeps the precompressed `.br` and `.gz` files. The bridge uses them automatically.

## 2. Tell the bridge where it is

Either re-run the wizard with the folder (it works in place and keeps your settings):

```bash
npx hermes-ui-plus-bridge setup --web-dir ~/.local/share/hermes-ui-plus-web
```

Or set the variable yourself in the bridge's env file and restart the bridge:

```bash
BRIDGE_WEB_DIR=/home/<user>/.local/share/hermes-ui-plus-web
```

```bash
systemctl --user restart hermes-ui-plus-bridge      # user unit
sudo systemctl restart hermes-ui-plus-bridge        # system unit
```

The bridge then serves the app at `/`, on the same origin as the API. No CORS setting is needed. If the folder does not exist, the bridge logs `BRIDGE_WEB_DIR does not exist, web app disabled`.

Check it: open `https://<host>.<tailnet>.ts.net:8790/` in a browser on a device in your tailnet. You should see the app's welcome screen. (With `setup --https-port 443` the address has no port.) On the bridge machine itself, `http://127.0.0.1:8790/` shows it too.

### Alternative: build from source

If you prefer not to use the release file, build the bundle yourself with `FLAVOR=hermes scripts/build-web.sh` and point `BRIDGE_WEB_DIR` at `dist/web`. The build is heavy (several GB of RAM). See [BUILD.md](BUILD.md).

### Alternative: host the folder without the bridge

Any static host on your tailnet works, for example `tailscale serve --bg --https=443 /opt/hermes-ui-plus-web`. Then the web app and the bridge are on different origins, and you must add the web app's origin to `BRIDGE_CORS_ORIGINS`. Serving it from the bridge is simpler.

## 3. Pair the web app

The setup wizard ends with a QR code and a **web pair link**, if you gave it `--web-dir`:

```
Web app: https://<host>.<tailnet>.ts.net:8790/#pair?u=...&c=...&n=...
```

Open that link in the browser on the device you want to pair (send it to yourself over a private channel, and do not share it). The app shows the target and asks you to confirm. The link carries a one-time pairing code (`c=`), not a token, in the part after `#`, which the browser never sends to the server; the app exchanges the code for its own device token.

The link carries a one-time pairing code. It expires **1 hour after it was created** if it was never used. Every browser or installed app needs its own link. Opening or scanning the link sends nothing yet: the code is used only when you tap **Connect** on the connection screen. If that fails with "expired or already used", create a new link.

### First test without HTTPS

No Tailscale yet? Without an HTTPS address the wizard also prints

```
Web app, in a browser on this machine: http://127.0.0.1:8790/#pair?u=...&c=...&n=...
```

Open it in a browser on the bridge machine. Browsers treat `http://127.0.0.1` and `http://localhost` as secure, so the full web app works there, including the offline copy. On a headless server, forward the port from your computer first, `ssh -L 8790:127.0.0.1:8790 <user>@<server>`, and open the same link on your computer. The printed links share one one-time code: only the first one you open works.

A plain `http://<lan-ip>:8790` address (if you let the wizard listen on the LAN) also works in a browser tab, but cannot be installed and has no push.

To pair another device later:

| Goal | Command |
|---|---|
| New web pair link | `npx hermes-ui-plus-bridge devices add "Laptop"`. It prints a QR, the app link and the web-app link. Re-running the wizard (`setup --yes`) also prints a fresh link. |
| New QR for the native app | `npx hermes-ui-plus-bridge devices add "Phone"` |
| See paired devices | `npx hermes-ui-plus-bridge devices list` |
| Remove a lost device | `npx hermes-ui-plus-bridge devices revoke <id>` |

The `devices` commands read the env file the wizard wrote. If yours lives elsewhere, add `--env-file <file>`. With a global install (`npm i -g hermes-ui-plus-bridge`), leave out `npx`.

**Installed app on iPhone and iPad:** the home-screen app has its own storage, separate from Safari, and a link you tap opens in Safari. So install first, then open the installed app and use **Or paste a link** in the onboarding screen. You can paste the web link or the `hermesuiplus://pair?...` link the wizard prints.

## 4. Install to the home screen

Open the web app's HTTPS address in the browser, then:

| Platform | Steps |
|---|---|
| **iPhone / iPad** | Use **Safari**. Tap **Share**, then **Add to Home Screen**, then **Add**. Open the new "Hermes UI+" icon. Needs iOS 16.4 or newer for notifications. |
| **Android** | Use **Chrome**. Tap the **⋮** menu, then **Install app** (or **Add to Home screen**). |
| **Desktop Chrome / Edge** | Click the install icon at the right end of the address bar, then **Install**. |
| **macOS Safari 17+** | **File**, **Add to Dock**. |
| **Firefox (desktop)** | No install option. The app works as a normal tab. Pin the tab if you like. |

If you only want to try it, you do not have to install. The app works in a normal tab as well.

### Turn on notifications

Notifications are optional. They tell you when a long answer is finished or when Hermes waits for an approval.

1. Open the installed app (on iPhone and iPad this **must** be the home-screen app, not a Safari tab).
2. Open **Settings**, then **Notifications**, and turn on notifications for the profile.
3. Allow the permission prompt. The prompt needs a tap, so it cannot appear on its own.
4. Use **Send test notification** to check.

The bridge must have Web Push set up for this (the wizard offers it and generates the keys). See [SELF-HOSTING.md](SELF-HOSTING.md), section 6.

## 5. Update

Install a new release the same way as the first one:

```bash
sha256sum -c hermes-ui-plus-web-<new-version>.tar.gz.sha256
mkdir hermes-ui-plus-web.new
tar -xzf hermes-ui-plus-web-<new-version>.tar.gz -C hermes-ui-plus-web.new --strip-components=1
```

Then swap the folders (`sudo` if needed) and restart the bridge:

```bash
mv /opt/hermes-ui-plus-web /opt/hermes-ui-plus-web.old
mv hermes-ui-plus-web.new /opt/hermes-ui-plus-web
systemctl restart hermes-ui-plus-bridge        # add --user or sudo as in step 2
rm -rf /opt/hermes-ui-plus-web.old
```

Restart the bridge after replacing the folder. It resolves the folder once at startup.

How devices pick up the new version:

- The app shell is fetched **network-first**, so the next time you open or reload the app it loads the new files. The paired state and your chats stay on the device.
- The service worker keeps an offline copy of the shell. A new release installs a new worker in the background and replaces the old copy. The previous copy is kept while a window of the old version is still open.
- If the app still looks old: close it completely (swipe it away) and open it again, sometimes twice.
- Release bundles are built with the service worker on. A build made with `WEB_SW=0` ships a "retirement worker" instead. It removes the offline cache and unregisters itself the next time a device checks for updates.

Update the bridge and the web app together when the release notes say so ([../CHANGELOG.md](../CHANGELOG.md)).

## Troubleshooting

| Symptom | What to do |
|---|---|
| White screen, or the old version after an update | Hard reload (Ctrl+Shift+R, or Cmd+Shift+R). On a phone, close the app completely and reopen. Still old: remove the home-screen icon, clear the site data for the address in the browser settings, and add it again. Check that you restarted the bridge after replacing the folder. |
| "Not reachable", or the page does not open | Is Tailscale on, on that device? Does the HTTPS address open in the browser? Does `BRIDGE_PUBLIC_URL` match it exactly? Is the bridge running (`systemctl --user status hermes-ui-plus-bridge`)? A wrong `Host` is refused with status 421. |
| The address opens but shows "not found" | `BRIDGE_WEB_DIR` is missing, wrong, or the folder is empty. It must contain `index.html`. Look for "web app disabled" in the bridge log. |
| No "Install" option in the browser | The page must be on HTTPS (or `localhost` / `127.0.0.1`). Plain `http://` over the LAN cannot install a PWA. On iPhone, use Safari. |
| "Pairing link expired or already used" after tapping **Connect** | Each link works once. A link already used in another browser or app (or older than 1 hour) needs a new link (`npx hermes-ui-plus-bridge devices add "Laptop"`). |
| Pair link says expired or invalid | Links expire 1 hour after creation if unused. Create a new one (section 3). Use one link per device. |
| Network error in the browser console, or "CORS" | The web app is served from another origin than the bridge. Add that origin to `BRIDGE_CORS_ORIGINS`, or serve the app from the bridge. |
| Push never arrives on iPhone | Web Push only works from the app installed to the home screen, on iOS 16.4 or newer. Open the home-screen app, enable notifications there and use **Send test notification**. Also check that the bridge has VAPID keys (SELF-HOSTING.md, section 6) and that notifications are allowed in the iOS settings for "Hermes UI+". |
| Push never arrives anywhere | Check the permission in the browser or system settings and the bridge log. Some browsers pause push for sites you rarely open. |
| Paired in the browser, but the installed app asks to pair | The home-screen app has its own storage on iPhone. Create a new link and paste it into the installed app (section 3). |

More server-side checks: [SELF-HOSTING.md](SELF-HOSTING.md), section 8.

## Privacy

Everything stays between your device and your bridge. The web bundle contains no analytics, and the developers run no server that your data touches ([../PRIVACY.md](../PRIVACY.md)).
