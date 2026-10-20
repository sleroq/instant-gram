# Development

## Setup

Requires Bun 1.4.3 or newer. Node.js is not required.

```sh
bun install --frozen-lockfile
bun run dev
```

- WXT opens a persistent Chromium profile at `.dev/chromium-profile` in the
  original Git checkout (next to the shared `.git` directory). Linked worktrees,
  including Paseo workspaces, reuse this profile and its Instagram login.
- Log into Instagram there and keep an Instagram tab open.
- Use **Instagram DM Client (Dev)**. Disable other installed copies to avoid testing the wrong build.
- The Messages page opens automatically. Existing conversation tabs are reused.
- Close the dev browser before restarting or switching workspaces. Run only one
  dev browser at a time; worktrees share its profile and debugging port.
- To reset the session, close Chromium and delete `.dev/chromium-profile` in the
  original checkout, not in a worktree.
  This directory contains private session data. Never share it.

## Unpacked build

```sh
bun run build
```

In `chrome://extensions`, enable Developer mode and load `.output/chrome-mv3`.
After updates, reload the extension and existing Instagram tabs so both use the same protocol.

## Browser tools and tests

- The dev browser exposes CDP at `127.0.0.1:9223`. Keep that port free.
- `opencode.json` connects Chrome DevTools MCP to this browser.
  Start the dev browser first; restart MCP after configuration changes.
- Install test Chromium once with `bun run test:setup`.
- Run the checks in [repository guidance](../AGENTS.md#verification).
- Tests run each file in a separate Bun process to preserve isolation without
  Bun's [Linux `--isolate` stdio leak](https://github.com/oven-sh/bun/issues/37968),
  which remains present in 1.4.3.
- `bun run format` formats the repository. Avoid unrelated formatting changes.
- Browser tests use mocked extension Ports. They do not prove live API behavior.
- Use a test conversation for live checks. Visible latest messages can be marked read.
  Sends, pins, and other mutations affect the real account.

## Performance targets

These are provisional budgets, not measured guarantees:

- At most 31 mounted inbox rows and 80 mounted history rows.
- Warm navigation p95: 100 ms. Authorized retained-cold navigation p95: 300 ms.
- Main-thread merge/window work: less than 50 ms per task.
- Incremental feature bundle: aim for at most +15 KiB gzip.
  Agree a different budget before larger work.

Measure input to visible content, including identity and chunk readiness.
Separate warm, retained-cold, missing-cache, and unknown-identity cases.
Record fixture, browser, hardware, cache state, and bundle baseline.
Measure speculative feedback separately from durable acceptance.
Do not compare different feature sets to claim a performance gain.
