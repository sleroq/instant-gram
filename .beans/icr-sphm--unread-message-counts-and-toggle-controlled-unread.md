---
# icr-sphm
title: Unread message counts and toggle-controlled unread-history loading
status: todo
type: epic
priority: normal
tags:
    - solid-restoration
    - ux
    - approved-expansion
    - unread
created_at: 2026-10-20T19:41:26Z
updated_at: 2026-10-20T19:51:41Z
blocked_by:
    - icr-i2ye
---

Approved product expansion from the unread-count optional expansion scope, separate from ordinary R2 polling and the pre-R3 visual polish milestone. Current Thread exposes only isUnread; the UI cannot turn that boolean into an exact unread-message total.

Deliver trustworthy per-conversation unread counts instead of blue dots and an optional automatic unread-history loader using the same normalized worker resources. Count completeness/read-boundary evidence must precede badges or bulk loading. Loading messages does not mark them read, and all loading remains bounded in concurrency, runtime projection and DOM, independently of durable history retention.

Do not block pre-R3 presentation polish on proving new provider count semantics. This epic is explicitly blocked by icr-i2ye; its evidence/count child must carry that gate as well because hierarchy alone is not scheduling authority. Loading also depends on icr-r54z. The user selected all unread conversations with latest messages within a configurable one-month lookback; if account-wide discovery is materially complex, a configurable first-10-inbox-chats fallback is authorized. icr-sik0 owns the implementation assessment; exact settings units/defaults are decided when that work is taken on.

Exit requires known/partial/unknown count semantics, account isolation, safe cursor coverage, no invisible read marking, and settings/network/storage/teardown tests. R5 live-transport research is not a prerequisite: reuse the existing worker read scheduler and polling.
