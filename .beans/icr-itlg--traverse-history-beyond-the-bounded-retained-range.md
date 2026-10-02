---
# icr-itlg
title: Retain complete active and recent conversation history
status: completed
type: task
priority: high
tags:
    - solid-restoration
created_at: 2026-09-13T13:04:39Z
updated_at: 2026-10-01T20:25:52Z
parent: icr-siiy
---

Replace the current per-conversation 400-message/20-segment persistence ceiling with a simpler retention policy. Persist every successfully loaded page for the active conversation and recent conversations; keep only Solid projection and mounted DOM windows bounded. When account-level storage pressure requires cleanup, evict whole least-recently-used inactive conversation histories first, while preserving their inbox thread/latest-message facts through resource references. Never evict the active conversation, currently subscribed conversations, recent protected conversations, unsettled operations, or facts referenced by another resource. Do not implement a moving per-conversation range or bidirectional page restoration for ordinary scrolling. The worker still owns opaque older cursors and exact contiguous cursor coverage; the UI receives bounded interest-scoped snapshots and mounts at most 80 rows. Required evidence: traverse beyond 400 messages in the active conversation; persistence survives restart; worker/client/DOM memory stays bounded independently from IndexedDB; inactive-history eviction preserves inbox previews and account isolation; reopening an evicted conversation starts from cache-miss/newest history honestly; provider exhaustion remains distinct from local storage pressure. Targeted Instagram API discovery remains useful for reply jumps to messages never fetched, but is not required for retaining already loaded active history.

## Fix-pass outcome — 2026-09-30

Implementation is complete in v4. Production-code regressions exceed 1,200 messages and cover changed-head/restart, independent 400-ID windows and whole inactive-root eviction with inbox/account protections. Installed production recovered 160 messages after worker stop. Keep this acceptance task open until live >400/pressure evidence exists; synthetic fixtures must not be relabeled as live Instagram data.

## User acceptance

The user confirms that this read-only stage is working and manual testing passed, and explicitly requests completion before continuing to new features. Closed on that acceptance together with the recorded 173-test and installed-production evidence. Earlier agent-only evidence gaps remain historical limitations, not pending stage blockers; no additional per-scenario measurements are claimed.
