---
# icr-vlv6
title: Reject malformed read envelopes before replacing cache
status: completed
type: bug
priority: high
tags:
    - discovered
    - solid-restoration
created_at: 2026-09-13T12:43:59Z
updated_at: 2026-09-13T12:56:12Z
parent: icr-siiy
---

The retained parseInboxResponse/parseThreadResponse helpers tolerate missing containers and return empty pages. The live read boundary must not accept HTTP 200 GraphQL errors or malformed/missing connections as authoritative empty success, which would replace cached conversations. Validate captured response connection shape at the live reader before shared parsers; preserve legitimate known-empty pages and intentionally suppressed message variants. Add focused live-reader fixture regression alongside exact descriptor and account-scoped mailbox checks.

## Resolution

The live reader now validates captured connection envelopes before shared parsing,
rejects GraphQL errors/missing data, preserves legitimate empty connections, and
classifies HTTP 401/403 as authentication failures. Mailbox identity is scoped to
the current storage account. Older reads now use the exact captured catalog
descriptor rather than a separately reconstructed request shape.

Verified by `tests/instagram-reads.test.ts` and `tests/inbox-provider.test.ts`
(10 passing focused tests), catalog/handler coverage, and zero shared-scan
diagnostics on the touched provider/API/test paths. Live endpoint verification
remains a separate R0 gate.
