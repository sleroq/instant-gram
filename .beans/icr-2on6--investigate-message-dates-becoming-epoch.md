---
# icr-2on6
title: Investigate message dates becoming epoch
status: completed
type: task
priority: normal
created_at: 2026-07-04T16:02:42Z
updated_at: 2026-07-04T16:04:06Z
---

Root cause: HAR GraphQL payload has message timestamp_ms as a numeric string, while messageTs only accepted numbers and fell back to 0. Fixed parser to parse digit-only timestamp strings.
