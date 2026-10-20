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
updated_at: 2026-10-20T21:17:32Z
parent: icr-i2ye
---

Build Settings as a peer of Chats in the persistent application sidebar. The latest user-requested tab/On-Off design supersedes the initial three-option motion page and the intermediate Settings-only rail.

## Current acceptance

- [x] Provide Chats and Settings sidebar tabs, with Chats selected by default. Settings fills the remaining application area rather than opening a separate full-page destination.
- [x] Keep direct `#/settings`, inbox and stable thread routes, browser Back/Forward, and the previous Chats selection when switching tabs. Support vertical-arrow/Home/End activation, selected state, named panels and logical focus.
- [x] Preserve App-owned per-thread drafts, reply intent, accepted-version guards and IME; retain logical inbox/history positions and mounted-row bounds. Inactive feature content unmounts without delaying cleanup.
- [x] Expose one compact Animations On/Off switch, with no Reduced or System control. Remove the introductory copy, footer, Back link and bordered Motion card.
- [x] Own the validated boolean `motion` key in one small `storage.local` presentation service. Resolve initial preferences before surfaces render; synchronize windows and report storage failures honestly. Until the user makes a choice, use the initial/live device motion preference as the default. Read prior Full/Reduced saved choices as On/Off respectively.
- [x] Keep preferences separate from canonical Instagram resources, worker persistence, outbox, retry, fetching, cache and retention policy. Add no fake loading controls, empty destinations or generic animation framework.
- [x] Cover behavior/accessibility, navigation, persistence, OS/cross-window semantics, error handling and cleanup. Review appearance manually; no CSS/computed-style/screenshot/pixel-design assertions.
- [x] Run fresh verification and a genuinely separate review. User reviewed the requested refinements and approved commit/push to the existing PR branch.

## Ownership and deferred scope

`route.ts` owns application tabs, retained Chats selection and browser history.
`AppNavigation.tsx` owns the persistent tabs and their keyboard/focus behavior.
App retains draft/acceptance ownership and logical anchors; the existing Chats
features retain virtualization and scroll ownership. Sidebar resizing uses its
content container, so the navigation rail does not shift pointer coordinates or
consume unaccounted width.

This remains the sole consuming global preference owner for polish and later
R3/R4 surfaces. R5 must not add another settings system. Unread-loading
configuration belongs with actual `icr-sik0` capability and prerequisites; no
unsupported options are exposed here. No cache policy is selected; `icr-li1d`
is merged here, not a separate prerequisite. No parent milestone is completed.

## Current revision evidence

- Bun 1.4.3, unchanged per-file `bun run test`: **216 tests across 26 isolated files**, zero failures. Lint, typecheck, production build, diff and Beans checks pass.
- Shared ast-grep scan reports only `parseAnimations(value: unknown)`. This function is the external-storage parser itself; narrowing untrusted input before validation would defeat that boundary. The finding is inapplicable, independently reviewed, and not suppressed.
- Independent reviewer: Pi/OpenAI Codex `gpt-6.1-sol`, high reasoning, agent `859128c6-ff96-41f0-8845-081c96e12de9`. No actionable findings in the current redesign, including untracked `AppNavigation.tsx`; explicitly verified behavior-only test policy. Independently passed 49 browser tests, lint/typecheck/diff/Beans checks and inspected the Settings screenshots. The full 216-test run is implementation-side evidence, not an independent full-suite claim.
- Manually inspected safe mocked Messages/Settings fixtures at 1200×850, 390×844 and 320×720: persistent selected tabs, full content area, compact borderless settings, On/Off states, readable compact chat title/actions, and return to the selected conversation. No real Instagram account was touched. Screenshots are manual evidence, not asserted goldens.
- Browser coverage includes tab mouse/keyboard activation and persistent navigation nodes, direct links and Back/Forward, Chats thread/draft/logical-anchor restoration, send acceptance while Settings is open, device defaults and saved overrides, legacy preference compatibility, reload and cross-window sync, validation, storage failure and initial-read/event ordering.
- Evidence is mocked browser behavior, not installed-extension or live Instagram API verification. The user approved publishing the tab/On-Off and preceding rail refinements to the existing PR branch.

## Delivery history

Initial implementation was published as PR #8, superseding closed PR #4.
It was rebased onto `origin/master` at `dbc9896` as `581bff1`; that historical
revision passed 211 tests and CI. Its original System/Reduced/Full controls and
later Settings-only rail are superseded by the current user-approved design.
