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

Fix the reported alignment regression: subsequent incoming messages currently lose the avatar column and shift left when showSender is false. In group chats, every incoming bubble must remain to the right of the same reserved sender-icon gutter, even when the icon is not repeated. Private chats omit message avatars and the gutter. Preserve outgoing right alignment.

- [x] Use one presentation grouping rule for consecutive messages: same sender and a gap of at most five minutes from the immediately preceding message, not five minutes from the start of the group. Different senders, larger gaps, date boundaries and activity/system separators break groups.
- [x] Give grouped messages minimal vertical spacing and distinct groups larger spacing. Show author labels at appropriate time-group starts and avatars only at the start of an uninterrupted same-sender run in group conversations, without shifting later bubbles left. Time/date gaps alone do not repeat the avatar.
- [x] Keep stable individual message/domain keys. Grouping is presentation, not entity merging, inferred reply/share association, or a new cache.
- [x] Cover exactly-five-minute and over-five-minute gaps, sender/date/activity transitions, optimistic-to-canonical settlement and bounded-window/page boundaries through production behavior, observable author/message content, identity/order, navigation and mount bounds. Do not fetch extra history just to establish grouping. Follow tests/AGENTS.md: manually inspect spacing/alignment/overflow; never automate design assertions or relocate them to a grouping helper.

Owners: ConversationPane.tsx, MessageRow.tsx, styles.scss. The text/share follow-up must evaluate this rule before proposing anything more specific.

## Implementation and evidence

- Group starts use the immediately preceding retained ID, including a predecessor outside the mounted slice. No new reads, cache/entity merging or inferred text/share association. Author labels appear for incoming group starts in group chats, with full-name/username/sender-ID fallback.
- Incoming group-chat rows reserve the avatar gutter independently of avatar rendering. Private chats omit message avatars and the gutter. Outgoing rows retain their right alignment. Within-group spacing is smaller than group-start spacing; long author names wrap.
- Fresh verification on Bun 1.4.3: lint, the isolated `bun run test` script (190 passing tests across 25 files), TypeScript check, production build, diff check and beans check passed. Shared scan findings in new test organization/function declarations were corrected; scan is now clean.
- Manually inspected production `/ui.html` in a local mocked-Port fixture using agent-browser at 1280×900 and 390×844: incoming first/continuation gutter, outgoing short/long right edges, rolling five-minute grouping, six-minute/sender/activity/day boundaries, long spaced/unbroken participant names and long unbroken message content. Screenshots inspected locally at `/tmp/icr-gcpy-{desktop-top,desktop-bottom,compact-top,compact-middle,compact-bottom}.png`; no screenshot assertions or geometry comparisons. Existing compact header crowding is outside this task.
- Evidence is mock/browser-only; no installed-extension/live Instagram behavior or real-account mutations claimed.
- [x] Independent Pi/OpenAI review under the updated test policy and final quality gate. Reviewer `d67c56a8-175f-4efd-a1fc-a7e7b29a4c83` (Pi / OpenAI Codex `gpt-6.1-sol`, high reasoning) approved with no blocking findings or actionable nits. Independently reran all 21 history-browser tests, lint, typecheck, diff/beans checks and the shared scan; inspected the desktop/compact screenshots and explicitly confirmed behavior-only test-policy compliance.
- Implementation complete on this task branch; replacement PR supersedes closed #2. This does not claim merge, deployment, live-account acceptance or completion of the parent polish milestone.

## Follow-up: top-aligned sticky avatars

- One avatar sits at the top of each rendered incoming sender run and sticks within that run while scrolling, stopping at its final message. A run crossing the mounted-window boundary retains an avatar without mounting extra messages or fetching older history. Private/outgoing rows remain avatar-free.
- Native CSS sticky positioning uses an absolute gutter track spanning the mounted run. The existing history ResizeObserver measures first/last rows after anchor corrections; reads are batched before style writes. No new scroll handler, message wrappers, entity grouping, observer lifecycle or animation owner.
- Fresh verification: all 200 tests passed via the isolated Bun 1.4.3 script; lint, typecheck, build, diff check, beans check and shared scan passed. New behavior coverage preserves logical anchor/message identity through content growth, viewport resize and bounded local traversal, with no extra read commands or visual assertions.
- Manually inspected top alignment, within-run sticking and sender/activity handoff on the safe mock at 1280×900 and 390×844. Also inspected a 120-message same-sender history whose first real message is outside the mounted slice, including resize to 1000×700. Mock fixture snapshots are cloned before delivery. Also confirmed private chats remain avatar-free. The same independent Pi/OpenAI reviewer approved with no findings after explicitly reviewing the new module, native sticky containment, bounded measurements, cleanup and test-policy compliance; independently passed 29 history-browser tests plus lint/typecheck/diff/beans/shared scan. The user approved committing and pushing all follow-ups to the existing PR.

## Follow-up: uninterrupted sender runs

- Separate adjacent-sender continuity from time-based grouping. In group chats, do not repeat a profile picture while consecutive messages have the same sender, even across a larger time gap or date change. Sender changes and activity/system messages interrupt the run. Keep existing rolling-five-minute author labels/spacing, stable IDs and reserved incoming gutters; private chats remain avatar-free.
- The full isolated test script passed all 199 tests on retry, and lint/typecheck/build/diff/shared scan passed. The initial run hit a 30-second timeout in an unchanged repository test during heavy host load; no test or timeout configuration was changed.
- Manually inspected safe mocked production UI screenshots at 1280×900 and 390×844 for the six-minute gap, day boundary, sender/activity boundaries, incoming gutter and outgoing alignment. Appearance remains manually reviewed only; no new design assertions. The same independent Pi/OpenAI reviewer approved with no findings, checked short-circuiting/reactivity and test-policy compliance, and independently passed 28 history-browser tests plus lint/typecheck/diff/beans/shared scan. Included in the user-approved PR update.

## Follow-up: private chats

- Use the existing normalized `isGroup` metadata (`is_group` / `is_group_thread` at the provider boundary), not a projected participant count that can omit the viewer. Keep sender avatars, author labels and the reserved incoming gutter only in group conversations; private messages keep grouping and outgoing alignment without avatars or an empty gutter. Inbox avatars are unchanged.
- Fresh local follow-up gates on Bun 1.4.3 passed: 199 tests via the isolated script, lint, typecheck, build, diff check and shared scan. New tests cover server group-flag semantics and observable author/message content, stable identity and Reply targeting, not appearance.
- Manually compared group and private conversation appearance at 390×844 and private desktop/outgoing appearance at 1280×900 with the safe mocked-Port production fixture. Group avatars/gutters remain; private messages have neither. Mock-only evidence, no live-account claim. The same independent Pi/OpenAI reviewer approved the follow-up with no findings, confirmed behavior-only policy compliance and independently passed all 40 tests in the two affected test files plus lint/typecheck/diff/shared scan. Included in the user-approved PR update.
