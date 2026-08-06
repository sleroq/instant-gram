---
# icr-qq3b
title: Synchronize incoming Instagram DM updates
status: todo
type: task
priority: high
tags:
    - discovered
    - dm
    - realtime
created_at: 2026-08-06T14:50:22Z
updated_at: 2026-08-06T14:50:22Z
---

Incoming updates are not implemented: the UI store loads the inbox only at startup/pagination/retry, the anchor exposes only request/response RPC, and no Iris/MQTT/page-context listener or refresh loop exists. The completed DM-mutations milestone also explicitly excludes incoming live updates.

Implement reliable incoming-DM synchronization so messages, reactions, and inbox activity caused by another user reach and reconcile on the extension client. First validate the currently available Instagram page transport with a live authenticated session and fresh captures; the existing HAR documents Iris/MQTT intent but has no decoded WebSocket frames. Prefer a passive page-context observer of Instagram's own live thread updates. Use bounded polling of the selected thread/inbox only as the fallback if that observer cannot provide a stable, safe event contract. Do not create a second entity cache or put Instagram protocol knowledge in UI components.

Checklist:

- [ ] Capture and document the actual event/update shape and lifecycle from Instagram's own Iris/MQTT/page runtime, including reconnect/auth/tab lifecycle; redact credentials and message content from diagnostics/fixtures.
- [ ] Define a narrow typed update boundary from page/anchor through background to the UI store; retain the closed-capability routing model.
- [ ] Reconcile incoming thread/message/reaction updates into the existing normalized inbox and per-thread histories, deduplicated by stable server message ID and ordered by timestamp without regressing optimistic local sends or newer mutation receipts.
- [ ] Update inbox snippets/activity/order while preserving explicit pin order. For an open thread, merge new messages without resetting the bounded 40–80 row window or displacing an older-reading scroll anchor; follow only when already at bottom and otherwise expose/maintain a new-message route.
- [ ] Handle relevant non-message updates proven by capture (at minimum reaction changes); leave typing/read receipts/unsupported update classes explicitly out of scope unless their data contract is captured.
- [ ] Make listener/polling lifecycle single-flight, generation-safe, and fully disposable across anchor/UI teardown, reconnects, and stale completions. Polling, if used, must be visibility-aware and have an explicit interval/backoff/error policy.
- [ ] Add focused protocol/store tests for duplicate, out-of-order, stale, and optimistic-send reconciliation; add a browser regression for open-thread bottom versus scrolled-up behavior.
- [ ] Run npm test, npm run check, npm run build, and git diff --check; perform a manual two-account verification that an incoming message and reaction appear without user refresh.

Acceptance criteria:

- Another participant's new message updates the inbox and an open conversation without manual reload or pagination.
- Updates are idempotent and cannot duplicate rows, overwrite pending/confirmed local sends, or break normalized ordering/pins.
- Rendering stays bounded and preserves the reader's anchor unless they were following the newest messages.
- Transport remains credential-safe, typed, and isolated outside UI components.
