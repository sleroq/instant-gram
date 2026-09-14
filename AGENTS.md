# Repository guidance

Before frontend work, read the stable
[`docs/application-architecture.md`](docs/application-architecture.md) contract,
then [`docs/frontend-architecture.md`](docs/frontend-architecture.md),
[`docs/solid-2-guide.md`](docs/solid-2-guide.md), and
[`docs/engine-inbox-contract.md`](docs/engine-inbox-contract.md) for the current
implemented slice.

The sole production UI is the Solid 2 `ui.html` read-only Messages client. Keep
entities normalized, fixed 72px inbox rows bounded to at most 31 mounted rows,
history windows bounded to 80 rows, stable domain keys, logical scroll/focus
restoration, explicit refresh/retry, and worker-owned RPC, identity, persistence,
single-flight, and stale-generation behavior. Resource retention is not proof of
contiguous cursor coverage. Message previews do not imply a media player.
Mutations, read marking, polling, media-info/player/comments, and settings remain
later restoration milestones and must not be added as UI-owned adapters.

Use TypeScript/TSX and SCSS with the pinned Solid 2 stack. Keep Instagram protocol
knowledge outside components. Documentation and sanitized captures under `docs`
remain protocol references for future rebuilding.

Verify frontend changes with `npm run lint`, `npm test`, `npm run check`,
`npm run build`, `git diff --check`, and the shared repository scan:

```sh
ast-grep scan --config "$HOME/sgconfig.yml" --no-ignore hidden .
```

Do not copy Telegram GPL source or assets. Keep this repository's source and
assets clean-room and repository-owned.
