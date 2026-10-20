# Repository guidance

Before frontend work, read the stable
[`docs/application-architecture.md`](docs/application-architecture.md) contract,
then [`docs/frontend-architecture.md`](docs/frontend-architecture.md),
[`docs/solid-2-guide.md`](docs/solid-2-guide.md), and
[`docs/engine-inbox-contract.md`](docs/engine-inbox-contract.md) for the current
implemented slice.

The sole production UI is the Solid 2 `ui.html` Messages client with locally implemented R2 core messaging. Keep
entities normalized, fixed 72px inbox rows bounded to at most 31 mounted rows,
history windows bounded to 80 rows, stable domain keys, logical scroll/focus
restoration, explicit refresh/retry, and worker-owned RPC, identity, persistence,
single-flight, and stale-generation behavior. Resource retention is not proof of
contiguous cursor coverage. Message previews do not imply a media player.
R2 durable send/reply, pin/read commands, and visible-interest polling are worker-owned;
Solid owns per-window drafts and projection only. Keep operation snapshots bounded
(200 active commands plus 200 settled send aliases); immutable persisted dedup
tombstones have no expiry policy. Unknown sends are never blindly retried; mark
only the latest actually seen message read. R0–R2 are complete by user acceptance;
independent evidence limits remain documented. R3 is next: reactions/edit/forward. R4
media-info/player/comments, and R5 settings remain future, never UI-owned adapters.

Use TypeScript/TSX and SCSS with the pinned Solid 2 stack. Keep Instagram protocol
knowledge outside components. Documentation and sanitized captures under `docs`
remain protocol references for future rebuilding.

You can verify UI and UX behaviour by testing the extension via chrome mcp skill yourself if the task requires it.

Verify frontend changes with `bun run lint`, `bun run test`, `bun run check`,
`bun run build`, `git diff --check`, and the shared repository scan:

```sh
ast-grep scan --config "$HOME/sgconfig.yml" --no-ignore hidden .
```
