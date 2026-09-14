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

Requires Node.js 22 or newer.

```sh
npm ci
npm run dev
```

Before submitting a change:

```sh
npm run lint
npm test
npm run check
npm run build
git diff --check
```

Install browser test Chromium once with `npm run test:setup` when needed.

The repository's local shared lint policy additionally requires an existing
`$HOME/sgconfig.yml`:

```sh
ast-grep scan --config "$HOME/sgconfig.yml" --no-ignore hidden .
```

## Install the unpacked extension

```sh
npm ci
npm run build
```

Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**,
and select `.output/chrome-mv3`. Reload an existing Instagram tab after updating
the extension so its content provider uses the current protocol. This does not
imply feature parity with earlier releases or live-account verification.
