---
# icr-w08c
title: Correct read-only navigation and identity-reset window state
status: completed
type: bug
priority: high
tags:
    - discovered
    - ux
created_at: 2026-09-30T00:57:38Z
updated_at: 2026-09-30T22:14:25Z
parent: icr-siiy
---

Static review: ConversationPane.tsx 129-138 drops the boundary anchor and follows the replacement window bottom during local newer traversal, skipping readable messages. App.tsx 26-39 clears anchors/routes only for different non-null account IDs, not authoritative null/same-account epoch resets. route.ts 8-9 throws on malformed encoded hashes such as #/thread/%. Fix with focused browser regressions: newer traversal preserves visible boundary and offset; authoritative identity resets clear window state while transport reconnect preserves it; malformed routes recover to inbox. Preserve worker-owned data/cursors and 80/31 mount bounds. Also review delayed inbox hydration restoration and sidebar separator-width clamping.

Live dev-extension confirmation, 2026-09-30: local newer-window traversal retained the prior boundary in the DOM but moved it 3,805px above the viewport, skipping the reading position. Fresh navigation to #/thread/% rendered a blank body and threw URIError / REACTIVITY_HALTED at route.ts:9. At a 720px desktop viewport, separator End selects 400px; 400+8+320=728px causes horizontal overflow and leaves only 312px of available conversation space. Compact Back preserved focus but restored inbox scrollTop 720 to 718 (2px offset); inspect border/offset arithmetic in InboxList.tsx. Also ordinary conversation buttons use aria-selected although button does not support that selection semantic; expose the current route with supported semantics. Preserve the 80 history /31 inbox mount bounds.

## Fix-pass outcome — 2026-09-30

Completed visible-ID/pixel anchoring, disconnected-scroll rejection, safe routes, authoritative resets, separator clamp and aria-current semantics. Checking epoch 0/1 on worker restart preserves route; actual auth failure clears it. Installed production retest: malformed route works, 392+8+320=720, compact Back 449→449 with selected focus, ≤80 history rows, real worker restart preserves route. Historical 720→718 is also fixture-covered. Final suite: 173 passed.
