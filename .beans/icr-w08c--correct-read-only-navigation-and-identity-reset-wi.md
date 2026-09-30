---
# icr-w08c
title: Correct read-only navigation and identity-reset window state
status: todo
type: bug
priority: high
tags:
    - discovered
    - ux
created_at: 2026-09-30T00:57:38Z
updated_at: 2026-09-30T00:57:38Z
parent: icr-siiy
---

Static review: ConversationPane.tsx 129-138 drops the boundary anchor and follows the replacement window bottom during local newer traversal, skipping readable messages. App.tsx 26-39 clears anchors/routes only for different non-null account IDs, not authoritative null/same-account epoch resets. route.ts 8-9 throws on malformed encoded hashes such as #/thread/%. Fix with focused browser regressions: newer traversal preserves visible boundary and offset; authoritative identity resets clear window state while transport reconnect preserves it; malformed routes recover to inbox. Preserve worker-owned data/cursors and 80/31 mount bounds. Also review delayed inbox hydration restoration and sidebar separator-width clamping.
