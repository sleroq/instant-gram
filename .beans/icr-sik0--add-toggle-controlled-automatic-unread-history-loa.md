---
# icr-sik0
title: Add toggle-controlled automatic unread-history loading
status: todo
type: feature
priority: normal
tags:
    - solid-restoration
    - ux
created_at: 2026-10-20T19:41:26Z
updated_at: 2026-10-20T19:51:41Z
parent: icr-sphm
blocked_by:
    - icr-fscs
    - icr-r54z
---

The user selected account-wide recent unread conversations, not only the open chat. Preferred scope: all unread conversations whose latest message is younger than a configurable one-month lookback. Last-message timestamps are already normalized in Thread.lastMessage.ts, so the age check itself needs no new provider capability. Full inbox discovery and its cost must still be assessed separately.

If discovering all eligible conversations is materially complicated or expensive, the user authorizes a simpler fallback: inspect the first 10 inbox conversations and preload those that are unread, with the conversation limit configurable. Do not search arbitrarily far to find 10 unread chats, silently make 10 a hard cap on the preferred recent-conversation mode, or assume pinned inbox ordering is chronological. Choose the simplest supported policy when implementing; no speculative dual scheduling framework.

- [ ] After icr-fscs establishes trustworthy read boundaries/count completeness, choose and document the supported discovery policy using existing inbox data/pagination. Use actual latest-message timestamps for recency; missing/invalid evidence is not proof that a conversation is recent. Test cutoff boundaries, old pinned rows and unloaded inbox pages.
- [ ] Expose the real automatic-loading toggle and applicable lookback/limit through icr-r54z's single settings owner. Set precise units and the initial toggle default when this feature/settings design is undertaken, not as another present-day product blocker.
- [ ] Load eligible unread history through the worker shared scheduler until its known read boundary, exhaustion, failure or cancellation. Keep concurrency, backoff, account generations, cursor progress and lifecycle worker-owned; no unlimited hidden UI subscriptions or second timer.
- [ ] Disabling stops eligible speculative work, not explicit user reads, and does not silently delete retained history. Persist loaded pages in IndexedDB while preserving 400-ID client windows, 80 mounted messages and declared runtime/interest bounds.
- [ ] Background loading never marks messages read. Preserve actual seen-message marking, account isolation, durable outbox/dedup evidence and honest count completeness.
- [ ] Cover both the chosen recency discovery behavior and any adopted capped fallback, unread spans beyond one page, quota/rate limits, toggle changes, cancellation and teardown.

Scope is resolved; this is no longer a draft. Keep existing prerequisites icr-fscs and icr-r54z and the unread epic's after-polish gate. Settings-specific defaults are decided when taking on that work.
