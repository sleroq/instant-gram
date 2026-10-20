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
updated_at: 2026-10-20T21:04:49Z
parent: icr-i2ye
---

Fix the reported alignment regression: subsequent incoming messages currently lose the avatar column and shift left when showSender is false. Every incoming bubble must remain to the right of the same reserved sender-icon gutter, even when the icon is not repeated. Preserve outgoing right alignment.

- [x] Use one presentation grouping rule for consecutive messages: same sender and a gap of at most five minutes from the immediately preceding message, not five minutes from the start of the group. Different senders, larger gaps, date boundaries and activity/system separators break groups.
- [x] Give grouped messages minimal vertical spacing and distinct groups larger spacing. Show author/avatar at appropriate group starts, including multi-participant conversations, without shifting later bubbles left.
- [x] Keep stable individual message/domain keys. Grouping is presentation, not entity merging, inferred reply/share association, or a new cache.
- [x] Cover exactly-five-minute and over-five-minute gaps, sender/date/activity transitions, optimistic-to-canonical settlement and bounded-window/page boundaries through production behavior, observable author/message content, identity/order, navigation and mount bounds. Do not fetch extra history just to establish grouping. Follow tests/AGENTS.md: manually inspect spacing/alignment/overflow; never automate design assertions or relocate them to a grouping helper.

Owners: ConversationPane.tsx, MessageRow.tsx, styles.scss. The text/share follow-up must evaluate this rule before proposing anything more specific.

## Implementation and evidence

- Group starts use the immediately preceding retained ID, including a predecessor outside the mounted slice. No new reads, cache/entity merging or inferred text/share association. Author labels appear for incoming group starts in group chats, with full-name/username/sender-ID fallback.
- Incoming rows reserve the avatar gutter independently of avatar rendering. Outgoing rows retain their right alignment. Within-group spacing is smaller than group-start spacing; long author names wrap.
- Fresh verification on Bun 1.4.3: lint, the isolated `bun run test` script (190 passing tests across 25 files), TypeScript check, production build, diff check and beans check passed. Shared scan findings in new test organization/function declarations were corrected; scan is now clean.
- Manually inspected production `/ui.html` in a local mocked-Port fixture using agent-browser at 1280×900 and 390×844: incoming first/continuation gutter, outgoing short/long right edges, rolling five-minute grouping, six-minute/sender/activity/day boundaries, long spaced/unbroken participant names and long unbroken message content. Screenshots inspected locally at `/tmp/icr-gcpy-{desktop-top,desktop-bottom,compact-top,compact-middle,compact-bottom}.png`; no screenshot assertions or geometry comparisons. Existing compact header crowding is outside this task.
- Evidence is mock/browser-only; no installed-extension/live Instagram behavior or real-account mutations claimed.
- [x] Independent Pi/OpenAI review under the updated test policy and final quality gate. Reviewer `d67c56a8-175f-4efd-a1fc-a7e7b29a4c83` (Pi / OpenAI Codex `gpt-6.1-sol`, high reasoning) approved with no blocking findings or actionable nits. Independently reran all 21 history-browser tests, lint, typecheck, diff/beans checks and the shared scan; inspected the desktop/compact screenshots and explicitly confirmed behavior-only test-policy compliance.
- Implementation complete on this task branch; replacement PR supersedes closed #2. This does not claim merge, deployment, live-account acceptance or completion of the parent polish milestone.
