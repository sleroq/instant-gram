# Repository guidance

Before frontend changes, read:

- [`docs/frontend-architecture.md`](docs/frontend-architecture.md) for source
  ownership, exact current state, cursor/single-flight/warmup rules,
  virtualization, and implemented-versus-Milestone-2 behavior.
- [`docs/teact-guide.md`](docs/teact-guide.md) for the pinned local Teact API,
  lifecycle/reconciliation caveats, TSX setup, and component conventions.
- [`docs/frontend-rewrite-plan.md`](docs/frontend-rewrite-plan.md) for the
  reviewed milestone design and pinned Telegram Web A references.

Non-negotiable frontend rules:

- Keep entities normalized (`orderedIds`/`listedIds` plus `byId`); components do
  not own parallel caches. Store actions own RPC, cursor semantics,
  single-flight, retries, and stale-generation checks.
- Preserve bounded rendering: fixed 72px absolute inbox rows, stable domain
  keys, the existing chat window, and at most 80 history rows when Milestone 2
  is implemented. Consume loaded local IDs before network pagination.
- Use TypeScript/TSX, vendored Teact, and SCSS. Do not add React as a runtime or
  assume unsupported React APIs. Animate transform/opacity, honor reduced
  motion, reserve media geometry, and retain accessible status/error/focus UI.
- `vendor/teact` is pinned MIT code; preserve its `LICENSE` and provenance.
  Telegram Web A is GPL-3.0-or-later: do not copy its source, styles, icons, or
  assets into this unlicensed repository. Independently implement documented
  behavior unless the repository's licensing boundary is explicitly changed.

For complex, performance-sensitive, or controversial frontend behavior, check
the pinned Telegram Web A source referenced in `docs/frontend-rewrite-plan.md`
for concrete examples before choosing an implementation. Inspect only the
relevant paths, verify the behavior against our smaller API and scope, and
record any lasting architectural decision in `docs/frontend-architecture.md`.
Use Telegram as a behavioral reference, not as source to paste: preserve the
GPL clean-room boundary and omit machinery that our measured requirements do
not need.

Instagram API/query documentation is in `docs/instagram-*.md`. Browser request
examples are in `docs/examples/*.har`; consult them when request or response
shape is relevant, and keep Instagram protocol knowledge out of UI components.

Use DevTools MCP selectively when code inspection and automated checks are not
enough to verify tricky behavior or inspect the live add-on or Instagram web
client. Do not use it for routine changes that can be verified locally.

Frontend verification:

```sh
npm test
npm run check
npm run build
git diff --check
```
