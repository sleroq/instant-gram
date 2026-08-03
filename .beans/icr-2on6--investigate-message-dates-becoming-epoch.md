---
# icr-2on6
title: Fix inbox last-activity dates parsing as epoch
status: todo
type: task
priority: high
created_at: 2026-07-04T16:02:42Z
updated_at: 2026-08-03T13:17:50Z
---

## Browser finding (2026-08-03)

All inbox dates render as “Jan 1”. The parser already accepts digit-only numeric strings for message timestamps (`messageTs`), but `parseThread()` still accepts only numeric `last_activity_at_ms` / `last_activity_ms` values and falls back to `0` for Instagram's numeric strings. `ChatRow` formats that zero timestamp.

## Fix

Use the same validated numeric-string timestamp parsing for both thread activity fields. Add a focused parser regression for string activity timestamps and confirm nonzero browser inbox dates after rebuilding.
