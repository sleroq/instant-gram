# Instagram Client

A Chromium extension with a read-only, cache-backed Instagram Messages UI:
primary inbox pagination, conversation history, bounded scrolling, and responsive
navigation on Solid 2.

This is the R1 restoration slice, not full parity with the retired client.
Sending, pinning, read marking, reactions/editing, incoming polling, and the media
player/comments remain later milestones. Opening history does not mark it read;
message/share previews are read-only and do not imply those capabilities.

The audited [Solid restoration checklist](docs/solid-restoration-checklist.md)
separates implemented slices, remaining restoration, and optional product scope.
See [R1 verification](docs/r1-verification.md) for checks and release-evidence gaps.

The extension uses your existing Instagram web session. Its background worker
selects an Instagram tab, verifies the active account through a content-side
provider, validates captured read responses, and persists normalized
account-partitioned resources in IndexedDB. The Solid 2 `ui.html` page receives
bounded worker snapshots. Cached content stays visible during refresh/errors;
unknown account identity and genuinely missing data still require waiting.

## Develop

Requires Bun 1.3.13 or newer; Node.js is not needed. Install dependencies from
the committed lockfile with `--frozen-lockfile`.

```sh
bun install --frozen-lockfile
bun run dev
```

Development uses a dedicated persistent Chromium profile at
`.dev/chromium-profile` (ignored by Git). WXT opens the extension's Messages page
after the addon has loaded, without depending on a background-worker event.
Log into Instagram once in the browser
opened by `bun run dev`; subsequent runs reuse its cookies and session until
Instagram expires it or you log out. Keep an Instagram tab open for the extension
provider. Close the previous dev browser before restarting; do not run two dev
instances against the same profile. Delete `.dev/chromium-profile` with the dev
browser closed to reset it. This directory contains private session data—do not
share it.

The dev browser exposes remote debugging on `127.0.0.1:9223`.
`opencode.json` attaches Chrome DevTools MCP to that same browser; start
`bun run dev` before using browser tools and restart MCP after changing its
configuration. Keep port `9223` free of other browser debugging sessions.

Before submitting a change:

```sh
bun run lint
bun run test
bun run check
bun run build
git diff --check
```

Install browser test Chromium once with `bun run test:setup` when needed.

The repository's local shared lint policy additionally requires an existing
`$HOME/sgconfig.yml`:

```sh
ast-grep scan --config "$HOME/sgconfig.yml" --no-ignore hidden .
```

## Install the unpacked extension

```sh
bun install --frozen-lockfile
bun run build
```

Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**,
and select `.output/chrome-mv3`. Reload an existing Instagram tab after updating
the extension so its content provider uses the current protocol. This does not
imply feature parity with earlier releases or live-account verification.
