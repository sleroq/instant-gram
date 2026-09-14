---
# icr-bst8
title: Resolve the restored history browser-suite hang
status: completed
type: bug
priority: high
tags:
    - discovered
    - browser
created_at: 2026-09-13T13:19:31Z
updated_at: 2026-09-13T13:22:33Z
parent: icr-siiy
---

Full npm test during R1 integration exceeds a 90-second timeout after the cached-window, prepend, and compact navigation history tests. The next message-variant browser fixture does not settle, preventing later suites from running. This is an introduced integration failure, not a pre-existing baseline failure. Bound all browser tests, fix the concrete render/lifecycle or fixture hang, preserve real message-variant assertions, and rerun the complete quality gate. Do not mark R1 complete with this failure.

## Resolution

The final isolated failure was the missing-history transition: an effect treated
an absent resource's `threadId` as a new route on every tracked range write.
It now tracks `props.threadId` and restores a bounded newest window when content
arrives. The late-hydration fixture also preserves numeric chronological order
rather than lexically sorting message IDs. All seven history browser tests and
the complete 106-test suite pass; lint/type/build/diff/shared-scan gates pass.
