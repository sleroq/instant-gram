---
# icr-gcpy
title: Group nearby messages and preserve the incoming avatar gutter
status: todo
type: bug
priority: high
tags:
    - solid-restoration
    - ux
    - ui-polish
created_at: 2026-10-20T19:29:43Z
updated_at: 2026-10-20T19:47:14Z
parent: icr-i2ye
---

Fix the reported alignment regression: subsequent incoming messages currently lose the avatar column and shift left when showSender is false. Every incoming bubble must remain to the right of the same reserved sender-icon gutter, even when the icon is not repeated. Preserve outgoing right alignment.

- [ ] Use one presentation grouping rule for consecutive messages: same sender and a gap of at most five minutes from the immediately preceding message, not five minutes from the start of the group. Different senders, larger gaps, date boundaries and activity/system separators break groups.
- [ ] Give grouped messages minimal vertical spacing and distinct groups larger spacing. Show author/avatar at appropriate group starts, including multi-participant conversations, without shifting later bubbles left.
- [ ] Keep stable individual message/domain keys. Grouping is presentation, not entity merging, inferred reply/share association, or a new cache.
- [ ] Cover exactly-five-minute and over-five-minute gaps, sender/date/activity transitions, optimistic-to-canonical settlement and bounded-window/page boundaries. Do not fetch extra history just to establish grouping.

Owners: ConversationPane.tsx, MessageRow.tsx, styles.scss. The text/share follow-up must evaluate this rule before proposing anything more specific.
