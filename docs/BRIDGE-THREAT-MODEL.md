# UI Bridge threat model

The self-hosted bridge is a single owner's API gateway to Hermes Agent. A device token grants access to that
owner's conversations and configured profiles. Profiles and session IDs select resources; they are not separate
users or authorization boundaries. This model assumes the host, bridge configuration and upstream Hermes are trusted.

## Assets and actors

| Asset | Exposure and protection |
| --- | --- |
| Device tokens and admin token | Bearer credentials in transit; device tokens are stored as hashes. Admin can issue/revoke devices; devices cannot manage them. |
| Pairing page codes and device pair codes | Page code: short, one use, ten minutes, five failed attempts. Device pair code: 32 random bytes, one use, one hour. |
| Chat history and live answers | Authenticated API routes, credential/profile-scoped replay, bounded SSE observers. All paired devices share the owner's history. |
| Uploads and generated media | Authenticated access, constrained paths, private file modes, upload size/concurrency/quota/retention limits. |
| Upstream API key | Server-side configuration; client authentication is replaced before forwarding. Never part of pairing payloads in the default mode. |

Threat actors are an unauthenticated LAN/tailnet peer, a malicious page open in the owner's browser, a thief with a
paired phone/token, and malicious agent/tool output containing URLs, filenames or stream data. A compromised Hermes
or host can already read the owner's files and run tools; the bridge does not sandbox the agent.

## Trust boundaries and mitigations

| Boundary | Existing mitigation and implementation |
| --- | --- |
| Peer/browser → bridge API | Bearer auth using SHA-256 and `timingSafeEqual`; revocable device tokens; admin-only device management ([auth.mjs](../bridge/src/auth.mjs), [devices.mjs](../bridge/src/devices.mjs), [device-admin.mjs](../bridge/src/device-admin.mjs)). No ambient cookie authentication. CORS grants response access only to configured origins. Open development mode checks origins before state changes ([server.mjs](../bridge/src/server.mjs)). |
| Browser → pairing | Local pairing requires a direct loopback peer, loopback Host, no forwarding headers and compatible fetch metadata. Remote page access needs its one-time code; known Host checks resist rebinding. Device redemption uses atomic consume-and-issue under a file lock, generic invalid-code responses, failure budgets and body/in-flight/deadline caps ([pair.mjs](../bridge/src/pair.mjs), [devices.mjs](../bridge/src/devices.mjs)). |
| Bridge → Hermes | Narrow method/path allowlists, strict decoding and profile names, preservation of the upstream base path, request header allowlist, replacement of Authorization, stripping upstream cookies/CORS; body caps and upstream deadlines ([paths.mjs](../bridge/src/paths.mjs), [profiles.mjs](../bridge/src/profiles.mjs), [bridge.mjs](../bridge/src/bridge.mjs)). Stop is scoped to profile and session. WebSocket proxying is refused. |
| Untrusted file → filesystem | Basename sanitization, random storage IDs, exclusive temporary files, atomic rename, byte limits, backpressure, quota reservations and private modes. MIME is a declared-type filter: files are not decoded, scanned or extracted. ZIP/polyglot bytes can be stored under another allowed MIME; they remain untrusted ([uploads.mjs](../bridge/src/uploads.mjs)). Media uses real-path containment ([media.mjs](../bridge/src/media.mjs)). |
| Agent URL → outbound socket | Image proxy permits public HTTPS on port 443, validates every resolved address, pins checked lookup results to connections, rechecks each redirect, and limits redirects, bytes, content types, queue/concurrency/rate and total time. SVG and encoded bodies are rejected; raster magic determines the served type, with `nosniff` and a sandbox CSP ([image-proxy.mjs](../bridge/src/image-proxy.mjs)). |
| Agent stream → memory/client | Bounded SSE parsing and assistant collection, bounded replay bytes/subscribers with backpressure, credential/profile replay namespaces, per-credential/global chat budgets and turn deadlines. Live inbox queues cap at 256 KiB; stalled readers disconnect and recover through session sync ([sse.mjs](../bridge/src/sse.mjs), [replay.mjs](../bridge/src/replay.mjs), [bridge.mjs](../bridge/src/bridge.mjs), [inbox.mjs](../bridge/src/push/inbox.mjs)). |
| Unauthenticated peer → `GET /bridge/live` | Constant `ok` body, no Hermes call, no state, no log line; reveals only that a bridge process answers, which `/health` already does ([server.mjs](../bridge/src/server.mjs)). |
| Unauthenticated browser → landing page | Fixed HTML independent of configuration, credentials and pairing state; strict CSP, no script, no-store, no-referrer ([static.mjs](../bridge/src/static.mjs)). |

Use TLS or a trusted encrypted transport; a reachable HTTP listener exposes Bearer credentials to network observers.
`BRIDGE_ALLOW_NO_AUTH=1`, wildcard CORS, and legacy admin-token pairing are explicit trust reductions, intended only
for controlled use. Open mode is not protection against hostile native clients or DNS rebinding. A stolen device
token retains the owner's normal API privileges until revoked; replay/streaming is not a per-message revocation
protocol. Timing-safe hash comparisons do not imply constant HTTP latency: parsing, disk locks and persistence vary.

## Repeatable verification

`scripts/check.sh bridge-security` runs the dependency-free local security corpus; `scripts/check.sh all` includes it.
The corpus starts only ephemeral loopback bridges/mock upstreams, passes explicit environments, and uses seeds
`0x16c0ffee`, `0x5eed1234`, `0x20261016`. Default property loops run 64 iterations per seed.

```sh
scripts/check.sh bridge-security
HUI_BRIDGE_FUZZ_LONG=1 scripts/check.sh bridge-security
cd bridge && npm test
```

Long mode runs 2,048 property/HTTP iterations per seed and additional redirect chains. Timing samples are diagnostic,
not statistical proof. Tests cover pairing brute force/replay/expiry/concurrency, auth parsing, profile/path mutation,
upload traversal/spoofing/polyglots/limits/partial bodies, SSRF numeric/mapped addresses/rebinding/redirects/response
limits, resume offsets/UTF-8/chunking, JSON prototype keys, Origin/CSRF, slow request bodies/headers, WebSocket refusal,
landing-page invariance and stalled inbox readers. The full bridge suite additionally exercises stop scoping, live
replay backpressure, TLS/SNI, upload quota and device-store locking. These are regression tests, not a security proof.
