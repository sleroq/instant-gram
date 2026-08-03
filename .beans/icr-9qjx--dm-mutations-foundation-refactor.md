---
# icr-9qjx
title: 'DM mutations: send, reply, and react'
status: todo
type: milestone
priority: high
tags:
    - dm
    - sending
    - replies
    - reactions
created_at: 2026-07-04T16:57:29Z
updated_at: 2026-08-03T13:36:40Z
---

# DM mutations: send, reply, and react

Deliver a reliable first writable-DM slice in the current TypeScript/Teact client: send text, reply to a loaded message, and create/change emoji reactions. This milestone merges the former foundation, send/reply, reactions, and mutation-hardening beans because their contracts, optimistic state, reconciliation, and QA are one behavioral boundary.

## Current state verified against the codebase

- `lib/domain.ts` owns normalized message entities and `RpcMap`; `shim.d.ts` projects it into `webext-bridge` typing.
- `entrypoints/ui/store.ts` owns RPC, normalized histories, generations, single-flight rules, bounded `listedIds`/`viewportIds`, and selection. Mutation state belongs here, not in parallel component caches.
- `entrypoints/ui/App.tsx` renders replies but has no composer, row actions, reaction display, or bottom-state mutation behavior.
- `entrypoints/background.ts` routes read RPCs and pin persistence; `entrypoints/ig-anchor.content.ts` already has the authenticated GraphQL transport and response envelope helpers.
- `lib/config.ts` has read-operation names/doc IDs only.
- Captured Instagram payloads and responses are sufficient for this milestone:
  - `docs/examples/www.instagram.com-with-my-message-and-sending.har` and `www.instagram.com-with-reply-by-me.har` show `IGDirectTextSendMutation` returning server `message_id` and `timestamp_ms`.
  - `docs/examples/www.instagram.com-live-communication.har` shows `IGDirectReactionSendMutation` returning the target message ID and complete current `reactions` array.
  - Loaded message payloads already include `reactions: [{ reaction, reaction_timestamp_ms, sender_fbid }]`; the parser currently ignores them.

## Architecture decisions

1. **No prerequisite transport rewrite.** Reuse the existing authenticated `graphql()` path. Add the smallest pure mutation request/response helpers needed for strict boundary validation and focused tests; do not split every read parser or introduce a generic action framework.
2. **The store owns mutation lifecycle.** Components collect input and DOM bottom position, then invoke store actions. Keep pending sends, per-thread drafts/reply targets, per-message reaction flight state, rollback data, and retries in normalized history state.
3. **Server entities stay separate from local operation state.** Parse server reactions into `Message`; track pending/failed delivery metadata beside messages in `HistoryState`, keyed by the optimistic local ID. Do not put UI error strings or retry callbacks into shared API entities.
4. **Use mutation responses as the normal reconciliation path.** A successful text response has enough data to replace the optimistic local ID with the server ID/timestamp. A successful reaction response contains the authoritative reactions array. Do not add a post-mutation thread refetch or polling loop by default.
5. **Make retry duplicate-safe and preserve render identity.** Generate one collision-resistant numeric `offline_threading_id`/client ID per local send and retain it across retries. Atomically replace the local ID in `byId`, `listedIds`, and `viewportIds` after success, but keep the client ID as the row-key bridge in mutation metadata so Teact does not remount the row; later server merges still deduplicate by server message ID.
6. **Preserve bounded history and user position.** Appending a local/server message must keep the 80-row DOM cap. `MessagePane` measures whether the user was at the bottom before submission; only the bottom path follows the new outgoing message. Sending or reaction updates while reading older history must not disturb the logical anchor.
7. **Serialize reactions per message.** Permit one reaction mutation per message at a time so stale responses cannot overwrite a newer choice. Apply the desired emoji optimistically, replace it with the returned reaction list on success, and restore the snapshot on failure.

## Phase 1 — Protocol and domain boundary

- [ ] Add `sendText` and `sendReaction` payload/result contracts to `RpcMap` and wire typed UI/background/content-script routes.
- [ ] Add `IGDirectTextSendMutation` (`26911679871773184`) and `IGDirectReactionSendMutation` (`24374451552236906`) to `lib/config.ts`.
- [ ] Build the exact HAR-backed variables documented in `docs/instagram-live-communication.md`; resolve the Instagram request key as `thread.cursor ?? thread.key` in the store.
- [ ] Strictly validate the required mutation response paths even when HTTP status is 200; return the existing `Result<T>` error envelope when data is absent/malformed.
- [ ] Add `MessageReaction` (`emoji`, `senderId`, timestamp) and parse the existing message `reactions` arrays for every renderable message variant.
- [ ] Keep reaction removal out of scope until a capture confirms its request shape.

## Phase 2 — Optimistic store actions and reconciliation

- [ ] Extend each `HistoryState` with per-thread draft/reply target, pending/failed sends keyed by local ID, and per-message reaction mutation state; preserve stale-generation protection on every async completion.
- [ ] Implement `sendText(threadId, text, replyToMessageId?)`: trim/validate non-empty user input, create one optimistic outgoing text message, append it once, and start the RPC without blocking other threads.
- [ ] Preserve reply context on the optimistic row. Clear the composer/reply selection only after the store accepts the send operation; do not lose the pending row on failure.
- [ ] On send success, atomically replace the optimistic ID with the returned server ID/timestamp across normalized/index arrays, retain its client ID as a stable row-key bridge, and clear delivery state without duplicating or remounting the row.
- [ ] On send failure, retain the row with accessible failed state and expose retry/remove. Retry reuses the original offline ID and cannot create a second local row.
- [ ] Update the inbox entity's snippet/activity and move the thread to the front of the unpinned server-order segment after an accepted outgoing send while retaining explicit pinned order.
- [ ] Reject reactions on unsent local rows. For server messages, implement create/change with a per-message single flight, optimistic viewer reaction, authoritative success replacement, rollback/error on failure, and no effect on message ordering.

## Phase 3 — Teact UI

- [ ] Add a fixed conversation composer with a labeled textarea and send button. Enter sends; Shift+Enter inserts a newline. Preserve per-thread drafts while switching chats.
- [ ] Add an accessible reply action to eligible loaded message rows plus a composer reply preview/cancel control. Use the existing message-summary/reply-preview behavior for quoted context.
- [ ] Render pending and failed delivery state without changing message identity during an attempt; provide keyboard-accessible retry and remove controls.
- [ ] Render grouped reaction chips with counts and an accessible label indicating the viewer's reaction.
- [ ] Add an accessible, bounded first-pass emoji picker (`❤ 😂 😮 😢 😡 👍`) for create/change. Disable or mark the target busy while its mutation is in flight.
- [ ] Keep mutation controls operable on narrow layouts, retain visible focus, and honor reduced motion.
- [ ] Follow the outgoing message only when the pane was already at bottom before send; otherwise preserve the existing anchor and expose a clear route to newest messages.

## Phase 4 — Focused verification

- [ ] Pure request/response tests cover text, reply, reaction, malformed HTTP-200 GraphQL data, and reaction parsing using sanitized HAR-shaped fixtures.
- [ ] Store regression: optimistic send inserts once, failed retry reuses its operation/local row, success replaces IDs in all normalized/window arrays while retaining the stable row key, and the viewport never exceeds 80 rows.
- [ ] Store regression: a failed reaction rolls back and a late/stale completion cannot overwrite newer state or another thread.
- [ ] Browser regression: composer keyboard behavior, reply selection/cancel, failed-send controls, and reaction picker are accessible.
- [ ] Browser regression: sending at bottom follows the new row; sending while scrolled up preserves the measured anchor.
- [ ] Manual extension pass against a real Instagram thread covers plain send, reply, reaction create/change, retry after simulated failure, thread switching, narrow layout, and console output.
- [ ] Run `npm test`, `npm run check`, `npm run build`, and `git diff --check`.

## Acceptance criteria

- A user can send text, reply to a loaded message, and create/change a reaction from the extension UI.
- Every mutation has visible pending/failure behavior and an explicit recovery path; retries do not duplicate messages.
- Successful responses reconcile directly into normalized state, update inbox metadata where relevant, and do not force a history refetch.
- Existing older-history pagination, anchor restoration, 40–80 row bounding, pin ordering, warmups, and responsive behavior remain intact.
- No Instagram protocol constants/request shapes enter UI components, and no Telegram application source/style/assets are copied.

## Explicit non-goals

Attachments, reaction removal, edit/delete/forward, read receipts, incoming live updates/Iris/MQTT, typing indicators, offline persistence, and a generalized Telegram-style action framework. Incoming-message synchronization should be a separate milestone because it has a different transport and consistency boundary.


## Telegram Web A behavioral reference

Reviewed pinned `Ajaxy/telegram-tt@a323b1f` as behavioral guidance only. Its GPL source, styles, icons, and assets must not be copied.

Useful invariants adapted to this smaller client:

- Composer dispatches intent while normalized store actions resolve reply context and create optimistic entities: [`Composer.tsx` L1484–1518](https://github.com/Ajaxy/telegram-tt/blob/a323b1f29f5b91e9a32b8c14866234e925fb0bfa/src/components/common/Composer.tsx#L1484-L1518), [`messages.ts` L475–608](https://github.com/Ajaxy/telegram-tt/blob/a323b1f29f5b91e9a32b8c14866234e925fb0bfa/src/global/actions/api/messages.ts#L475-L608).
- Temporary-to-server ID reconciliation retains a local identity bridge so keyed rows and scroll/focus survive: [`apiUpdaters/messages.ts` L688–725](https://github.com/Ajaxy/telegram-tt/blob/a323b1f29f5b91e9a32b8c14866234e925fb0bfa/src/global/actions/apiUpdaters/messages.ts#L688-L725), [`messageKey.ts` L5–21](https://github.com/Ajaxy/telegram-tt/blob/a323b1f29f5b91e9a32b8c14866234e925fb0bfa/src/util/keys/messageKey.ts#L5-L21). ICR should retain the client ID in store mutation metadata and derive a stable row key from it after server-ID replacement rather than adding Telegram's generalized key layer.
- Failed sends remain normalized rows with their content/reply context and retry the same mutation identity: [`methods/messages.ts` L360–410](https://github.com/Ajaxy/telegram-tt/blob/a323b1f29f5b91e9a32b8c14866234e925fb0bfa/src/api/gramjs/methods/messages.ts#L360-L410), [`apiUpdaters/messages.ts` L1120–1131](https://github.com/Ajaxy/telegram-tt/blob/a323b1f29f5b91e9a32b8c14866234e925fb0bfa/src/global/actions/apiUpdaters/messages.ts#L1120-L1131). ICR shows pending immediately rather than copying Telegram's delayed indicator.
- Reaction changes snapshot, update optimistically, and rollback on failure; authoritative updates replace normalized reactions: [`reactions.ts` L183–272](https://github.com/Ajaxy/telegram-tt/blob/a323b1f29f5b91e9a32b8c14866234e925fb0bfa/src/global/actions/api/reactions.ts#L183-L272), [`apiUpdaters/messages.ts` L1247–1289](https://github.com/Ajaxy/telegram-tt/blob/a323b1f29f5b91e9a32b8c14866234e925fb0bfa/src/global/actions/apiUpdaters/messages.ts#L1247-L1289). ICR additionally serializes per message because its mutation response is authoritative and reaction removal is unverified.
- Loaded IDs are consumed before network pagination and temporary local IDs are never pagination cursors: [`messages.ts` L218–252](https://github.com/Ajaxy/telegram-tt/blob/a323b1f29f5b91e9a32b8c14866234e925fb0bfa/src/global/actions/api/messages.ts#L218-L252), [`MessageList.tsx` L758–778](https://github.com/Ajaxy/telegram-tt/blob/a323b1f29f5b91e9a32b8c14866234e925fb0bfa/src/components/middle/MessageList.tsx#L758-L778).
- Telegram focuses an own optimistic send and uses near-bottom checks for incoming updates: [`apiUpdaters/messages.ts` L282–306](https://github.com/Ajaxy/telegram-tt/blob/a323b1f29f5b91e9a32b8c14866234e925fb0bfa/src/global/actions/apiUpdaters/messages.ts#L282-L306), [`MessageList.tsx` L943–987](https://github.com/Ajaxy/telegram-tt/blob/a323b1f29f5b91e9a32b8c14866234e925fb0bfa/src/components/middle/MessageList.tsx#L943-L987). ICR deliberately preserves an older-reading anchor when the composer is used away from bottom, matching this project's existing scroll requirement; the new-message affordance provides explicit navigation.

Omit Telegram's GramJS worker/update pipeline, topics, scheduled/paid messages, albums/uploads, multitab viewports, send-collapse animations, unread-reaction effects, and wholesale refresh/reset machinery. If incoming synchronization is later added, preserve optimistic rows and surviving viewport IDs rather than resetting history; Telegram's broader refresh behavior is referenceable at [`sync.ts` L119–219](https://github.com/Ajaxy/telegram-tt/blob/a323b1f29f5b91e9a32b8c14866234e925fb0bfa/src/global/actions/api/sync.ts#L119-L219).
