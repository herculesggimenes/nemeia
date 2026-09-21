# Contracts

The declarations under `contracts/protocol/` are historical prototype fixtures,
not the current authority. The selected implementation authority is
[`docs/protocol-spacetimedb.md`](../docs/protocol-spacetimedb.md); the
SpacetimeDB example under `contracts/spacetimedb/` is the World-owned contract
source while its module and generated bindings are qualified.

Nemeia is pre-production. Replace the prototype schemas, registries, signing
helpers and consumers as the new slices land. They are not a compatibility
contract. Do not add old-format adapters, dual writes or data migration.

`npm run check:protocol` from the repository root checks the historical
declarations,
negative type fixtures, example consistency and generated page. These checks
do not implement JSON validation, durable storage, physical control or hardware
qualification. Those implementation obligations are explicit in the spec.
