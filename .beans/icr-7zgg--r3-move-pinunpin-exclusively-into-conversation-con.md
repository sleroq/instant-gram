---
# icr-7zgg
title: 'R3: Move Pin/Unpin exclusively into conversation context menus'
status: todo
type: task
priority: normal
tags:
    - solid-restoration
    - ux
created_at: 2026-10-20T19:29:43Z
updated_at: 2026-10-20T19:47:35Z
parent: icr-jce7
blocked_by:
    - icr-u9ok
---

After icr-u9ok provides accessible conversation menus, move the existing durable pin/unpin command into those menus and remove the chat-title-bar Pin/Unpin button. Keep that header button throughout the current polish phase so pinning is never temporarily lost.

- [ ] Provide Pin/Unpin only in the conversation context menu, reachable by right-click plus keyboard/touch equivalents; support selected and unselected conversations where appropriate.
- [ ] Reuse the accepted R2 pin command, receipt validation, optimistic state, pending/error feedback and stable pin order. No new provider mutation or second pin store.
- [ ] Remove the title-bar action only when its replacement is usable; retain pin-state indicators and restore invoking focus after reorder.
- [ ] Cover pointer/keyboard/touch pin and unpin, pending/failure handling and header-button removal.

This is a future R3 placement migration, deliberately outside icr-i2ye.
