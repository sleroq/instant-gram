---
# icr-2on6
title: Fix inbox last-activity dates parsing as epoch
status: completed
type: task
priority: high
created_at: 2026-07-04T16:02:42Z
updated_at: 2026-08-03T13:30:37Z
---

## Browser finding (2026-08-03)

All inbox dates render as “Jan 1”. The parser already accepts digit-only numeric strings for message timestamps (`messageTs`), but `parseThread()` does not parse Instagram's `last_activity_timestamp_ms` field and falls back to `0`. `ChatRow` formats that zero timestamp.

## Fix

Use the same validated numeric-string timestamp parsing for the captured `last_activity_timestamp_ms` field and the existing aliases. Add a focused parser regression for string activity timestamps and confirm nonzero browser inbox dates after rebuilding.
