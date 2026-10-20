---
# icr-r54z
title: Build a settings page with one shared preference and motion owner
status: completed
type: feature
priority: high
tags:
    - solid-restoration
    - ux
    - ui-polish
created_at: 2026-10-20T19:41:26Z
updated_at: 2026-10-20T20:16:52Z
parent: icr-i2ye
---

Build the settings page for animations, caching and loading with one shared preference authority. Expose cache/loading controls only after their policies and capabilities are defined.

- [x] Design and implement an accessible routed settings page/entry point in the sole Solid UI, preserving Messages route, draft, focus and logical scroll restoration on return. Do not add an empty navigation rail or unsupported switches.
- [x] Own small global preferences in one storage.local service with validated defaults and cross-window updates. Resolve System/Reduced/Full animation mode before animated surfaces mount, follow live OS changes in System mode, and support immediate cleanup/focus restoration when effective motion is reduced.
- [x] When taking on settings design, agree which configuration controls and defaults should exist; cache/loading choices are not a question the user must settle now. Initially expose functioning animation preferences. Connect unread loading to icr-sik0 (recent unread conversations, configurable lookback or authorized capped fallback) and expose each control only when its actual capability exists. Create concrete cache-policy work only if selected; icr-li1d is merged here, not a separate prerequisite.
- [x] Separate global presentation choices from account-partitioned Instagram resources and worker read/storage policy. UI owns no alternate persistence authority for canonical facts, outbox or retry state.
- [x] Cover persistence, validation, live cross-window/OS updates, routing/accessibility and motion gating; no new animation framework. Add storage permission only with the consuming implementation if needed.

This is the sole consuming owner for current polish and later R3/R4 surfaces; R5 must not implement a second settings system. Configuration details/defaults are decided during this task. The user has resolved unread preload scope and approved physical sidebar sliding; those are not outstanding design blockers. No cache policy change is implied by a settings-page request.


## Implementation outcome

- Initial design exposes only System (default), Reduced and Full motion. No cache policy was selected; no unsupported cache/loading control or backend follow-up was invented. Unread loading stays with icr-sik0.
- The shell creates the sole global presentation preference service in `lib/preferences/motion.ts`, validates `presentation.motion` in storage.local, resolves effective mode before UI mount, follows live OS/storage events, and orders rapid writes with rollback/error feedback. Storage permission now has this real consumer.
- Routed Settings keeps App-owned per-thread drafts/acceptance guards and logical inbox/history anchors. History entries preserve focus origins through repeated Back/Forward. Compact headers wrap at 320px; settings-entry focus survives a delayed resize event when returning.
- Independent reviewer: native review-only agent `/root/review_settings`. Three P2 findings (repeated navigation focus, stale queued-save errors, 320px header overflow) and a resize focus race are fixed. Final review: no remaining blockers; independent resize reproduction passed 10/10 times. Reviewer edited no tracked files.
- Final verification: `bun run lint`, `bun run test` (209 pass, 0 fail across 26 files), `bun run check`, `bun run build`, `git diff --check`, `beans check`, and `ast-grep scan --config "$HOME/sgconfig.yml" --no-ignore hidden .` all completed successfully. Shared-scan advisories were read: untrusted storage/test boundary types, verified test focus assertions, and style guidance; no suppressions or cosmetic rewrites. Changed documentation links resolve.
- Browser evidence uses production builds with mocked extension Ports/storage and safe fixtures: initial motion, keyboard controls, save failures, live OS/storage changes, reduced CSS gating, drafts/anchors/focus at 320/390/1100px, repeated history traversal and resize. This is not installed-extension or live-account evidence; no authenticated mutations were performed.
