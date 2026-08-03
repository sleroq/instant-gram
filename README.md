# Instagram Client Reels

A Chromium extension for using Instagram direct messages and reels in a
focused client.

## Install

1. Download the Chrome ZIP from the latest [GitHub release](../../releases/latest).
2. Extract the ZIP to a permanent folder.
3. Open `chrome://extensions` in Chrome or another Chromium-based browser.
4. Enable **Developer mode**, select **Load unpacked**, and choose the extracted
   folder.

The extension is not currently distributed through a browser store, so updates
must be installed from a newer release in the same way.

## Develop

Requires Node.js 22 or newer.

```sh
npm ci
npm run dev
```

Before submitting a change, run:

```sh
npm run lint
npm test
npm run build
```

## Release

Set `version` in `package.json`, commit the change, then push a matching tag
(for example, package version `0.2.0` uses tag `v0.2.0`). GitHub Actions checks
the project, packages the extension, and creates a GitHub release containing
the installable ZIP.
