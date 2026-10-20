# Provider boundary

Own authentication, transport, response validation, and receipt parsing; keep
cache policy and application state in the engine. Captured Instagram descriptors
and operation-specific parsers live under `lib/instagram-api`.

- Keep the provider capability surface closed. Validate external JSON once into
  domain values; malformed successful HTTP/GraphQL envelopes are protocol errors,
  not empty success. Return redacted domain errors, not payloads or secrets.
- Check account identity around token preparation/network reads; scope mailbox
  pagination identity by account. Never substitute storage account, profile ID,
  or token segment for message viewer/read actor identity. Read actor evidence
  comes from MAIN-world `PolarisViewer.data.fbid`.
- Request fresh MAIN-world module-token evidence and read cookies in the content
  script. Do not scan HTML/scripts or retain diagnostic token-source metadata.
  The versioned auth bridge replaces its listener on reinjection.
- Own Ports with scoped acquisition and synchronous closed-state cleanup: remove
  listeners, fail pending/readiness operations, and disconnect owned Ports.
  Capture startup disconnect before activation; clean up failed/interrupted
  initialization. Install listeners before waking readiness. Dispose test factories.
- Anchor readiness belongs to the reverse content-script Port. Recover complete
  existing Instagram tabs by injecting compiled MAIN/ISOLATED scripts only when
  no live provider Port exists for that tab. WXT invalidates the previous content
  context before initialization; an initializer singleton cannot protect RPCs.
  Loading/new tabs use manifest injection. Keep scripting host-scoped; never
  reinject a healthy provider or reload user tabs.

Follow [application ownership](../../docs/application-architecture.md); verify
pinned Effect APIs before changing lifecycle code.
