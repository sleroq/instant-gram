# Documentation

## Current contracts

- [Application architecture](application-architecture.md): stable ownership,
  identity, reads, commands, persistence, and bounded rendering.
- [Frontend architecture](frontend-architecture.md): implemented read-only UI.
- [Engine contract](engine-inbox-contract.md): implemented storage and read path.
- [Solid 2 guide](solid-2-guide.md): pinned runtime and authoring conventions.
- [Roadmap](solid-restoration-checklist.md): accepted R0/R1 and future R2–R6 scope.
- [Acceptance evidence](r1-verification.md): accepted stage and evidence limits,
  not a guarantee about later builds.

## Future implementation references

- [Captured operations](instagram-methods.md), [request examples](instagram-har-useful-requests.md),
  and [communication protocol](instagram-live-communication.md) describe private
  Instagram protocol evidence, not shipped UI features. Persisted-query IDs can
  drift; verify fresh evidence before extending the production capability surface.
- [Motion requirements](telegram-animation-research.md) retain clean-room R5
  requirements without the retired runtime's implementation plan.

## Captures and privacy

Tracked `examples/` captures retain protocol evidence; credential fields have
been redacted. They are **not fully anonymized**: response content, identities,
media links, and other private data may remain. Do not reuse captured session
values or publish these files as sanitized fixtures without further review.
Ignored root-level HARs are local research inputs, may contain session data,
and are not required documentation or portable test fixtures. They are left
untouched; useful operation evidence belongs in the Markdown references.

Superseded architecture reviews and audit transcripts are available through Git
history, not part of the current contract.
