# Repository guidance

- Read [application ownership](docs/application-architecture.md) before changing boundaries.
- Follow scoped `AGENTS.md` files for engine, provider, worker, and UI rules.
- Before adding or changing tests, read [test policy](tests/AGENTS.md). UI tests
  cover behavior, not visual/design properties.
- Use TypeScript/TSX and SCSS with the pinned dependencies. Do not add another UI runtime.
- Keep entrypoints as composition. Put protocol, persistence, and state changes in their owning modules.
- Keep changes local. Do not commit, push, or publish without approval.

## Work planning

- [Roadmap](docs/roadmap.md) summarizes current and future scope.
- Beans own task requirements and dependencies. Check existing tasks before creating new work.
- Current UI polish (`icr-i2ye`) precedes R3. Do not pull future capabilities into polish.
- Parsers and protocol captures are evidence, not proof of a working feature.

## Verification

Run from the repository root after code changes:

```sh
bun run lint
bun run test
bun run check
bun run build
git diff --check
ast-grep scan --config "$HOME/sgconfig.yml" --no-ignore hidden .
```

For documentation-only changes, check links and diffs and run the shared scan.
Run `beans check` when tasks change. Read scan findings and fix real issues;
do not add cosmetic rewrites or suppressions.
See [development](docs/development.md) for setup and performance targets.
