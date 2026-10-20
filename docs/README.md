# Documentation

- [Architecture](application-architecture.md): current ownership and data flow.
- [Development](development.md): setup, debugging, and performance targets.
- [Roadmap](roadmap.md): delivery order, future scope, and open decisions.
- [Solid 2](solid-2-guide.md): runtime-specific authoring rules.
- [Instagram operations](instagram-methods.md): protocol evidence and request shapes.
- [Live transport](instagram-live-communication.md): evidence needed beyond polling.
- [Motion](motion.md): accessibility and animation constraints.

Coding rules live in the root and scoped `AGENTS.md` files.
Beans own task acceptance and dependencies; the roadmap does not duplicate their checklists.

## Protocol captures

`examples/*.har` supports protocol research. These files have redacted credentials,
but are not fully anonymized. They may contain identities, messages, and media URLs.
Do not publish them as sanitized fixtures or reuse captured session values.
Use fresh authenticated evidence before adding private API capabilities.

Ignored `docs/*.har` files are local research inputs, not required project files.
Keep tokens, browser profiles, and private account content out of documentation.
