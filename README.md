# Instagram Client

A Chromium extension that shows a read-only view of the first page of your
Instagram primary inbox.

This is a clean-restart scope: the current product does **not** open conversation
history, send or mutate messages, paginate, or load avatars and media. Those
capabilities may be rebuilt later against explicit engine contracts.

The audited [Solid restoration checklist](docs/solid-restoration-checklist.md)
describes **planned** restoration and optional scope; it does not claim those
features are implemented.

The extension uses your existing Instagram web session. Its background worker
selects an Instagram tab, verifies the active account through a content-side
provider, fetches and validates the first inbox page, and persists normalized
account-partitioned facts in IndexedDB. The Solid 2 `ui.html` page receives
complete worker snapshots and renders a bounded virtual list.

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
and select `.output/chrome-mv3`. This installs the current clean-restart inbox;
it does not imply feature parity with earlier releases.
