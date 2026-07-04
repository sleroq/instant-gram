---
# icr-9qjx
title: DM mutations foundation refactor
status: todo
type: milestone
priority: high
tags:
    - dm
    - refactor
created_at: 2026-07-04T16:57:29Z
updated_at: 2026-07-04T16:57:29Z
---

Large milestone for making the read-only DM client ready for sending, replies, and reactions without bloating App.svelte or the anchor content script.

## Scope
Refactor current read-only Instagram communication and UI state boundaries before adding mutations.

## Checklist
- [ ] Split Instagram GraphQL transport/auth retry code out of `entrypoints/ig-anchor.content.ts` into a reusable module.
- [ ] Move thread/message parsing into a focused parser module with existing behavior preserved.
- [ ] Add mutation-oriented domain types in `lib/domain.ts` for message status, reply previews, reactions, and RPC payload/results.
- [ ] Add placeholders/config entries for documented send/reaction friendly names and doc ids.
- [ ] Move thread cache/update helpers out of `entrypoints/ui/App.svelte` into a local state module.
- [ ] Keep existing inbox, thread history, reel opening, pinning, and scroll behavior working.
- [ ] Verify with `npm run check`.

## Notes
Use the existing docs in `docs/instagram-live-communication.md` and preserve the current WXT + Svelte 5 patterns.
