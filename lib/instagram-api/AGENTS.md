# Instagram API

Follow [provider boundary rules](../provider/AGENTS.md) for authentication,
identity, transport, and external validation.

- Keep shipped descriptors in `catalog.ts` and request/receipt logic here.
- Return normalized domain values, not raw payloads, to the engine.
- Add capabilities only with fresh evidence and strict target/receipt validation.
- [Protocol references](../../docs/instagram-methods.md) record future evidence,
  not permission to expose unsupported operations.
