# Repository guidance

Before frontend work, read [`docs/frontend-architecture.md`](docs/frontend-architecture.md),
[`docs/solid-2-guide.md`](docs/solid-2-guide.md), and
[`docs/engine-inbox-contract.md`](docs/engine-inbox-contract.md).

The sole production UI is the Solid 2 `ui.html` read-only primary inbox. Keep
entities normalized, fixed 72px rows bounded to at most 31 mounted rows, stable
domain keys, explicit refresh/retry, and worker-owned RPC, identity, persistence,
single-flight, and stale-generation behavior. History, pagination, selection,
media, and mutations are future work and must not be implied or added as UI
adapters.

Use TypeScript/TSX and SCSS with the pinned Solid 2 stack. Keep Instagram protocol
knowledge outside components. Documentation and sanitized captures under `docs`
remain protocol references for future rebuilding.

Verify frontend changes with `npm test`, `npm run check`, `npm run build`, and
`git diff --check`.

Do not copy Telegram GPL source or assets. Keep this repository's source and
assets clean-room and repository-owned.
