---
# icr-0c4s
title: Animate new incoming and outgoing messages at the chat tail
status: todo
type: task
priority: normal
tags:
    - solid-restoration
    - ux
    - ui-polish
created_at: 2026-10-20T19:41:26Z
updated_at: 2026-10-20T19:47:14Z
parent: icr-i2ye
blocked_by:
    - icr-r54z
    - icr-yqp8
    - icr-xmnd
---

Add the requested flowing-in entrance for newly received bottom messages and optimistic local sends, gated by icr-r54z.

- [ ] Animate only genuinely new tail arrivals while following the newest conversation and new local sends. Use a short inner-content transform/opacity effect after final geometry is established; never animate layout height, virtual placement, anchor correction or maintenance scrolling.
- [ ] Animate a logical send once: durable acceptance, receipt/server echo, alias settlement and retries must not replay the entrance or create another row.
- [ ] Initial history, cached reopen, older-page prepend, window recycling, reply-jump/return and adopting already-existing coverage do not become new-message animations. Scrolled-up readers retain their exact anchor.
- [ ] Full/System/Reduced behavior follows the shared gate, including live preference changes. Reduced settles immediately without delaying focus, operation status or DOM cleanup.
- [ ] Test incoming/local-send eligibility, echo deduplication, bottom clearance and bounded history, including reduced motion and rapid messages.

This pulls forward the applicable tail-entry scope, without a generic motion framework.
