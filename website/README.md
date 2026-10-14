# Project website (hermesui.xyz)

A static site: no build step on the host, no JavaScript, no external fonts or requests. System fonts, light and dark mode.

| Page | Source |
|---|---|
| `/` (`index.html`) | written in `build.mjs` (tagline, demos, platforms with their honest status, self-hosting links) |
| `/privacy` (`privacy.html`) | generated from [`../PRIVACY.md`](../PRIVACY.md): the same text. The app and the store listings link this URL. |
| `/security` (`security.html`) | generated from [`../SECURITY.md`](../SECURITY.md) |
| `/support` (`support.html`) | written in `build.mjs`: GitHub issues, docs, the support address from `app/brand/identity.json` |
| `404.html` | not-found page |

Name, URLs and the support address come from `app/brand/identity.json`.

## Editing

The HTML files are generated and committed. After you change `PRIVACY.md`, `SECURITY.md`, `identity.json` or `build.mjs`:

```
node website/build.mjs           # rewrite the pages
node website/build.mjs --check   # fail when they are stale
node --test scripts/website.test.mjs   # also part of scripts/check.sh (stale pages, external requests, dead links)
```

When the platform status changes (a release is published, iOS or macOS ships), edit the Platforms table in `build.mjs` and rebuild.

## Demo videos

Posters (`media/*.jpg`) are committed. The videos (`media/*.mp4`, about 70 MB) are too large for git (`.gitignore`) and are copied in at deploy time from the demo export:

```
cp dist/share/demos/[01][0-9]-*.mp4 dist/share/demos/trailer.mp4 website/media/
```

A deploy from Git alone shows the poster frames only; the player then has nothing to play. Use the CLI deploy below, or host the videos somewhere else and rebuild with `WEBSITE_MEDIA_BASE=https://<media-host>/ node website/build.mjs` (then widen `media-src` in `vercel.json`).

## Deploy on Vercel (owner steps)

The domain's nameservers already point at Vercel (`ns1.vercel-dns.com`, `ns2.vercel-dns.com`), so DNS is managed in the Vercel dashboard (Domains), not at the registrar.

1. Vercel dashboard, **Add New > Project**, import the GitHub repository. Set **Root Directory** to `website`, **Framework Preset** to *Other*, leave build and install commands empty, output directory empty. Deploy. (Or from a checkout: `cd website && npx vercel link`.)
2. For the demo videos, copy them in (above) and deploy from the checkout: `cd website && npx vercel deploy --prod`. `.vercelignore` makes the CLI upload the git-ignored `media/*.mp4`.
3. Project **Settings > Domains**: add `hermesui.xyz` and `www.hermesui.xyz`. Make one the redirect target of the other (recommended: `www` redirects to the apex `hermesui.xyz`).
4. DNS: the domain uses Vercel nameservers, so Vercel creates the records itself once the domain is attached to a project. Check **Domains > hermesui.xyz > DNS Records**: an `A` record for `@` (the value Vercel shows, currently `76.76.21.21` or the project-specific IP it lists) and a `CNAME` for `www` (the value Vercel shows). If the domain is not in the project's team account yet, add it there first (Domains > Add). If you would rather keep DNS at the registrar, set exactly the records the Domains page asks for and switch the nameservers back to the registrar's.
5. Wait for the certificate (usually a minute). The project's Domains page shows **Valid Configuration** for both names.
6. Optional: e-mail. The domain has no MX record; the support address in `identity.json` is on another domain, so nothing is required.

Verify:

```
curl -sI https://hermesui.xyz/privacy | head -3     # HTTP/2 200
curl -sI https://www.hermesui.xyz/ | head -3        # redirect to https://hermesui.xyz/
curl -sI https://hermesui.xyz/privacy.html | head -3   # redirect to /privacy (cleanUrls)
```

Then tick item 3 in [docs/STORE.md](../docs/STORE.md) (privacy policy URL live). Before every store submission and after every release, rebuild so `/privacy` equals `PRIVACY.md` ([docs/RELEASING.md](../docs/RELEASING.md), step 10).

## Hardening

`vercel.json` sets `cleanUrls`, a strict Content-Security-Policy (`default-src 'none'`, own images, own media, own stylesheet), `nosniff`, `Referrer-Policy: no-referrer`, HSTS and a minimal Permissions-Policy. The site sets no cookies and loads nothing from third parties; there is no analytics.
