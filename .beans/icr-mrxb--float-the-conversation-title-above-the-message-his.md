---
# icr-mrxb
title: Float the conversation title above the message history
status: todo
type: task
priority: normal
tags:
    - solid-restoration
    - ux
    - ui-polish
created_at: 2026-10-20T19:29:43Z
updated_at: 2026-10-20T19:29:43Z
parent: icr-i2ye
blocked_by:
    - icr-yqp8
---

Restyle the chat title/header as a rounded floating cloud above the messages, matching the composer visual language rather than a full-width bordered block.

- [ ] Reuse the overlay/clearance conventions established by icr-yqp8; preserve the oldest message's reachable position, logical anchors, responsive Back behavior, title truncation and keyboard focus.
- [ ] Keep Pin/Unpin usable for now. Its removal is explicitly deferred to the R3 conversation-menu migration; do not remove the only current pin affordance during this restyle.
- [ ] Coordinate the retained-history orb and refresh-button decision with their owning polish beans, rather than independently redesigning them here.
- [ ] Verify desktop/compact layout, overlay hit targets and scrolling without remounting history or changing mount bounds.

Owners: ConversationPane.tsx and styles.scss.
