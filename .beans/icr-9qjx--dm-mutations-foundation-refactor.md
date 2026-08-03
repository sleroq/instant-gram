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
updated_at: 2026-08-03T13:17:24Z
---

Prepare the current TypeScript/Teact DM client for sending, replies, and reactions without expanding `App.tsx` or the Instagram anchor into mutation-specific state machines.

## Verified current state

- The production UI is Teact (`entrypoints/ui/App.tsx` and `store.ts`), not Svelte.
- The Instagram transport and parsing currently live in `entrypoints/ig-anchor.content.ts`.
- `lib/domain.ts` and typed RPC are the authoritative shared boundary.

## Scope

- Extract only the reusable Instagram GraphQL transport/auth-retry and parser helpers needed to keep mutation additions maintainable; preserve existing read paths.
- Add mutation-oriented domain/RPC types for send state, replies, and reactions.
- Add documented send/reaction operation configuration without putting Instagram protocol details in UI components.
- Keep inbox, bounded history, pins, and share rendering working.

## Acceptance criteria

- Mutation features can use typed store actions and RPC without importing Instagram request details into `App.tsx`.
- Existing read-only flows continue to pass the repository checks.
