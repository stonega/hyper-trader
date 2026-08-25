# Action signing and persistence implementation

The action-signing layer adds an offline codec and signing boundary to
`packages/hyperliquid`, plus the Expo SQLite nonce and journal adapter in the
mobile application. It deliberately stops before exchange transport or live
submission.

The reviewed U7 orchestration and signer-free recovery layer is documented in
[`action-orchestration-and-reconciliation.md`](action-orchestration-and-reconciliation.md).

## Dependency decisions

- `@msgpack/msgpack` produces the protocol MessagePack action bytes. The test
  suite pins those bytes and resulting hashes to official Python SDK vectors.
- `viem` supplies Keccak-256, EIP-712 hashing/recovery, address normalization,
  and deterministic test-only accounts. Production signers remain injected;
  `viem` never receives a native custody secret in the shared package.
- `expo-sqlite` is the native mobile persistence engine. The adapter forwards
  its synchronous calls on one connection and uses an explicit
  `BEGIN IMMEDIATE` / `COMMIT` transaction, WAL, foreign keys, and a bounded
  busy timeout. Tests exercise the same SQL through real SQLite files and
  independent Bun SQLite process connections.

The shared package has a dependency-boundary test that rejects Expo, React
Native, or SQLite imports and manifest dependencies. The `./public` export has
a separate transitive-import test proving market-data consumers cannot reach
actions, signing, nonces, or reconciliation.

## Safety boundaries

Reservation is synchronous and must run through `ContextEpochAuthority`. The
The mobile context supervisor implements that port by comparing the captured epoch and
holding its serialization fence while the SQLite transaction commits. A stale
account, target, or network epoch therefore cannot advance a nonce or insert a
journal record.

The repository remembers newly prepared journal IDs only for the current
process lifetime. A successful prepared-to-submission-started compare-and-swap
returns a closure-backed permit that can be consumed once. A durable record,
new repository instance, restart, or reconciliation lease can never recreate
that permit. Restart recovery immediately abandons every prepared record and
changes every submission-started record to unresolved.

The signing boundary is network-generic and requires the payload network to
equal the immutable signer binding. With the current capability matrix, only
testnet reaches an injected signing function; opening mainnet requires the
one-line reviewed `candidate` stage described in the readiness plan and release
preflight. Mainnet parity fixtures remain pre-activation protocol evidence.
SQLite stores normalized secret-free intent,
digests, identifiers, nonce, expiry, binding, and reconciliation state; it has
no columns for keys, signatures, action bytes, signing preimages, or complete
exchange bodies.

Retired signer addresses remain in an installation-scoped hash chain. Startup
comparison verifies every sequence, prior link, installation epoch, and
recomputed root before matching the native custody manifest. Ordinary rotation
waits for terminal actions; emergency revocation or credential loss may retire
with public-query reconciliation remaining.

## Offline example

Run the deterministic testnet encoding example from the repository root:

```sh
bun examples/testnet-action-encoding.ts
```

It prints only network, action class, action hash, source byte, nonce, and
expiry. It does not create a key, sign, print action bytes, or submit.

## Protocol provenance

- Official SDK pin: tag `0.24.0`, commit
  `2fdb18f9517675ea03695a0962bd19eece9c83f0` —
  <https://github.com/hyperliquid-dex/hyperliquid-python-sdk/blob/2fdb18f9517675ea03695a0962bd19eece9c83f0/hyperliquid/utils/signing.py>
- Exchange action fields:
  <https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint>
- Nonce and API-wallet rules:
  <https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/nonces-and-api-wallets>
- Named-agent expiry suffix, separately pinned because Python SDK 0.24.0 does
  not generate it:
  <https://github.com/nktkas/hyperliquid/blob/db80d598f6e4672edc090fe69994ecec97ebc980/src/api/exchange/_methods/approveAgent.ts>
- Expo SQLite synchronous API and transaction behavior:
  <https://docs.expo.dev/versions/latest/sdk/sqlite/>

Fixture generation details and the exact upstream outputs reduced to digests
are in `packages/hyperliquid/src/fixtures/signing/README.md`.
