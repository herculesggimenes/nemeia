# Contracts

[`protocol/protocol.ts`](./protocol/protocol.ts) is the canonical implementation
target. Its rules live in [`docs/protocol.md`](../docs/protocol.md); the website
renders those declarations and the checked end-to-end fixture directly.

Nemeia is pre-production. Replace the prototype schemas, registries, signing
helpers and consumers as the new slices land. They are not a compatibility
contract. Do not add old-format adapters, dual writes or data migration.

`npm run check:protocol` from the repository root checks the declarations,
negative type fixtures, example consistency and generated page. These checks
do not implement JSON validation, durable storage, physical control or hardware
qualification. Those implementation obligations are explicit in the spec.
