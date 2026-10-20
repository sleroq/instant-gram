---
# icr-gcpy
title: Group nearby messages and preserve the incoming avatar gutter
status: completed
type: bug
priority: high
tags:
    - solid-restoration
    - ux
    - ui-polish
created_at: 2026-10-20T19:29:43Z
updated_at: 2026-10-20T20:10:49Z
parent: icr-i2ye
---

Fix the reported alignment regression: subsequent incoming messages currently lose the avatar column and shift left when showSender is false. Every incoming bubble must remain to the right of the same reserved sender-icon gutter, even when the icon is not repeated. Preserve outgoing right alignment.

- [x] Use one presentation grouping rule for consecutive messages: same sender and a gap of at most five minutes from the immediately preceding message, not five minutes from the start of the group. Different senders, larger gaps, date boundaries and activity/system separators break groups.
- [x] Give grouped messages minimal vertical spacing and distinct groups larger spacing. Show author/avatar at appropriate group starts, including multi-participant conversations, without shifting later bubbles left.
- [x] Keep stable individual message/domain keys. Grouping is presentation, not entity merging, inferred reply/share association, or a new cache.
- [x] Cover exactly-five-minute and over-five-minute gaps, sender/date/activity transitions, optimistic-to-canonical settlement and bounded-window/page boundaries. Do not fetch extra history just to establish grouping.

Owners: ConversationPane.tsx, MessageRow.tsx, styles.scss. The text/share follow-up must evaluate this rule before proposing anything more specific.

## Implementation and review

- Added one pure presentation rule based on the immediately preceding retained message: matching sender, same local calendar day, and a nonnegative gap of at most five minutes. Activity/reaction-log rows break groups. No extra history requests or entity merging.
- Reserved the 28px incoming avatar column plus 8px gutter on every row. Kept outgoing alignment and individual message IDs; added incoming group-chat author labels and 2px/14px within/between spacing.
- Independent native reviewer `/root/review_grouping` inspected the diff against `e3ed823a80d9e55003e33bdc6b12e03abfaaf24e`. One P2 (long unbroken author name overflowing narrow history) was fixed with wrapping and a 320px regression. Follow-up review independently confirmed the fix; no remaining actionable findings.
- Boundary evidence covers grouping with retained-but-unmounted predecessors and unknown page predecessors without extra fetching. Existing numeric-range rebasing can temporarily unmount rows on projection contraction; this change preserves the existing window/anchor owner and does not claim DOM identity across that rebase. Optimistic settlement separately verifies same-node identity, reply focus and scroll offset.
- Browser evidence uses the mocked-Port production build, with 1100px/600px geometry checks and the 320px overflow regression. No installed-extension/live-account verification or authenticated mutations were performed.
- Implementation and independent review are complete. Explicit user approval covers committing these task-only changes, pushing polish/message-grouping, and opening its PR to master; no merge is authorized.


## Final verification

- `bun run lint`: passed.
- `bun run test`: 200 passed, 0 failed across 26 files (39.89s), including 4 pure grouping and 27 production history-browser tests.
- `bun run check`: passed.
- `bun run build`: passed after the final test run.
- `git diff --check`: passed.
- `beans check`: passed.
- `ast-grep scan --config "$HOME/sgconfig.yml" --no-ignore hidden .`: passed with no findings.
