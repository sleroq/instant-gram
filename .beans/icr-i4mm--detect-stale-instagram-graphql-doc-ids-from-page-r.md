---
# icr-i4mm
title: Detect stale Instagram GraphQL doc IDs from page requests
status: todo
type: task
priority: normal
tags:
    - instagram
    - graphql
created_at: 2026-07-04T14:21:00Z
updated_at: 2026-07-04T14:21:00Z
---

Add a passive MAIN-world monitor that watches Instagram's own GraphQL requests and warns when known operation names use doc_ids different from the extension's hardcoded values.

Checklist:

- [ ] Add a page-context request observer for fetch and, if needed, XMLHttpRequest on instagram.com.
- [ ] Parse only safe request metadata from /api/graphql and /graphql/query: friendly name, doc_id, endpoint; avoid logging tokens, cookies, variables, or message content.
- [ ] Compare observed friendly names against the extension's configured DOC_IDS/FRIENDLY_NAMES.
- [ ] Emit/store a warning when Instagram uses a different doc_id for a known operation, including operation name, configured doc_id, observed doc_id, endpoint, and timestamp.
- [ ] Surface the warning somewhere developer-visible, such as debugAuth output, console warning, extension storage, or UI diagnostic.
- [ ] Do not auto-update doc_ids; document that matching friendly names do not guarantee compatible variables or response shape.
- [ ] Verify with a mocked/simulated request or local instrumentation without exposing Instagram session data.
