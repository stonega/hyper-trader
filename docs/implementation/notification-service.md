# Notification service foundation

U11 adds a public-data-only Bun service in `apps/notifications` and reusable
contracts and cryptography in `packages/notifications`. It has no signer,
exchange action, private account transport, or Hyperliquid authenticated API.
The only permitted Hyperliquid dependency is
`@hyper-trader/hyperliquid/public`, and the boundary test rejects any other
entry point.

U14 adds the public-data monitors and Expo delivery workers behind the existing
closed gates. `NOTIFICATION_ENABLE_PROVIDER_WORKERS=true` requests activation,
but workers remain disabled until migration, restore, key, authorization, and
dependency readiness all pass. The operational contract is documented in
[`notification-operations.md`](notification-operations.md).

## Public API

All mutation bodies use strict, exact schemas, are limited to 64 KiB, reject
unknown keys, and reject signing-capable fields after normalizing key case,
underscores, and hyphens. Except for first registration, requests authenticate
with `Authorization: Bearer <64 lowercase hex characters>`.

Every success response passes an exact route-specific runtime allowlist before
serialization. Installation, challenge, link, rule, credential-rotation,
token, drain, and lost-revoke responses reject unknown fields and malformed
states or identifiers. If an adapter returns ciphertext, credentials, proof
material, or any other extra field, the server emits only a generic HTTP 500.

| Method and path | Authority and behavior |
|---|---|
| `POST /v1/installations` | Registers a random public installation ID, hashes its credential, and encrypts its first Expo token. |
| `PUT /v1/installations/:id/credential` | Atomically replaces the credential hash, increments its generation, and makes the old bearer fail immediately. |
| `POST /v1/challenges` | Creates a five-minute, one-time, credential-bound account proof challenge. |
| `POST /v1/account-links/verify` | Consumes an exact master proof and creates one verified link in the same transaction. |
| `PUT /v1/rules/:ruleId` | Replaces a price rule with bearer authority or an account rule with a fresh exact proof. Path and body IDs must match. |
| `DELETE /v1/rules/:ruleId` | Deletes only an installation-owned price rule with bearer authority. Account-rule deletion is unavailable without exact current proof. |
| `GET /v1/installations/:id/snapshot` | Returns only the authenticated installation's bounded links, rules, token state, and aggregate delivery health. |
| `GET /v1/alerts/:alertId` | Returns one authenticated opaque alert target and delivery state; removed/revoked targets are marked unavailable. |
| `PUT /v1/installations/:id/push-token` | Re-encrypts a replacement token with fresh account proof when account authority exists; bearer-only rebind is allowed only when no active/draining account link or active account rule exists. |
| `POST /v1/account-links/unlink` | Drains and deletes only the selected link scope. |
| `POST /v1/installations/revoke` | Authenticated self-revoke; never rate-limited after authentication. |
| `POST /v1/installations/revoke-lost` | Master-proof recovery revoke over an exact sorted, unique installation set. |

Account proofs use the exact EIP-191 message in the design contract. The server
recomputes operation digests rather than trusting their challenge-time value:

- `account-link/v1`: installation, network, master, target, and new link ID;
- `account-rule/v1`: the complete replacement rule, including link and rule ID;
- `push-token-rebind/v1`: installation, link, provider, and SHA-256 token
  fingerprint;
- `lost-installation-revoke/v1`: requester, operation, account scope, and the
  exact sorted installation set.

Challenge rows contain only the challenge hash, current credential hash, exact
bindings, database-issued timestamps, and state. Message and signature bytes
are never persisted. Consumption and its mutation share one transaction, so a
write conflict or injected failure restores the challenge to pending. A
credential rotation makes every challenge issued to the old hash unusable.
Challenges and internal row IDs always use platform CSPRNG entropy; production
dependencies cannot inject deterministic ID or challenge sources.

Account-relationship checks are public-only and receive an `AbortSignal` plus
an absolute deadline. The fixed service bound is one second. Proof bytes,
credential binding, digest, and expiry are prevalidated without row locks; the
bounded public lookup then runs outside a PostgreSQL transaction. The mutation
transaction subsequently re-locks and revalidates credential, challenge,
purpose, digest, expiry, link scope, and signature before consuming and writing.
A timeout or upstream failure returns 503, leaves the challenge pending, and
does not count as a failed proof.

## Durable admission and quotas

`notification_admission_events` is shared PostgreSQL state; no correctness
limit depends on a process-local reset. Advisory transaction locks serialize
each actor before counting and recording. For an existing installation, the
credential is first checked under the installation row lock; admission and the
mutation then commit in that same transaction. A failed bearer can charge only
the IP or failed-proof bucket and cannot consume another installation's quota.
Registration records IP admission only, never the caller-selected installation
ID:

- 30 mutations/minute per installation;
- 60 mutations/minute per IP;
- 10 token changes/hour per installation;
- 5 challenge issues/hour per installation; and
- 10 failed proofs/hour per IP, counting pending attempts fail-closed.

Installation row locks serialize the 10-link and 100-active-rule limits. The
service authenticates before charging an existing installation quota. Deploying
without the shared PostgreSQL admission table is unsupported and must keep
mutations disabled. Account unlink and lost-installation revoke follow the
general policy; authenticated self-revoke is deliberately exempt so emergency
shutdown cannot be rate-limited. Only cryptographic or authority failures enter
the failed-proof bucket; dependency timeouts and write conflicts do not.

## Push-token key hierarchy

Each token gets a fresh random 256-bit DEK and 96-bit AES-GCM nonce. AAD is
`push-token/v1|installationId|provider|tokenFingerprint`. The external key
provider wraps that exact DEK with the active versioned KEK; the row stores the
wrapped DEK, KEK version, ciphertext, nonce, and SHA-256 fingerprint. Plain DEK
buffers are zeroed after use. A database backup alone is insufficient to
decrypt a token.

Registration and both token-rebind paths take the same transaction-scoped
advisory lock derived from the fingerprint before checking ownership or writing.
The database unique fingerprint constraint remains the final authority. This
removes the ownership-check/update race and returns a bounded conflict instead
of leaving a failed uniqueness transaction open.

Key rotation retains old versions as decrypt-only, decrypts each bounded batch,
and writes a fresh DEK/nonce wrapped by the active version without changing the
fingerprint. Delivery readiness remains false during rotation. Missing old key
versions, wrong wrapped keys, wrong row AAD, or authentication failures stop
restore and therefore stop readiness.

Production key adapters must keep KEKs outside PostgreSQL and its backup bucket,
identify an encrypt-active version, retain old decrypt-only versions throughout
the rotation overlap, and expose no raw KEK through service configuration.

## PostgreSQL model and migrations

The schema models installations, encrypted push tokens, challenges, account
links, rules, dedupe keys, alerts, outbox rows, dispatch permits, provider
tickets, receipts, monitor leases, revocation operations, and database-side
deletion receipts. Composite foreign keys prevent rules, alerts, outbox rows,
and permits from crossing installation or network scope. Checks couple active
credentials, revocation completion, permit state/timestamps, bounded wrapped
DEKs, and recovery MAC/key-version pairs. Expiry checks compare against stored
creation timestamps; no time-volatile check can make an old backup unrestorable.

Migrations use the following expand–migrate–contract sequence:

1. `0001_expand` creates additive tables and closed service gates.
2. `0002_migrate` marks the mixed-version phase and adds recovery-pair checks as
   `NOT VALID`, allowing an explicit backfill window.
3. `0003_contract` validates those checks, makes required recovery and wrapped
   key fields non-null, and marks the schema contracted.
4. `0004_workers` adds bounded delivery attempts, invalid-token state,
   generation-fenced monitor leases, and receipt scheduling/lease state without
   storing provider payloads.

Migration history stores each exact version and name plus SHA-256 checksums for
both up and down sources. Status, migration, rollback, restore preparation, and
activation require a contiguous known history matching current sources. Gaps,
unknown rows, edited names, checksum drift, or a changed rollback source stop
before schema work or readiness can proceed.

No mutation starts until the schema is contracted and tombstone restore reaches
`ready`. Rolling back from contract to migrate first disables mutations,
monitors, and delivery, then relaxes only the new non-null contract. Older and
newer processes may coexist only while all gates remain closed. Re-activation
requires the forward migration followed by the full restore procedure; schema
version alone never opens traffic.

## Draining, deletion, and independent recovery

Self-revoke, proof-bound lost-device revoke, and unlink first lock the scope,
move it to `draining`, increment or capture its generation, cancel unsent work,
and reject new dispatch permits. Completion waits for every durable
`provider_submission_started` permit until its bounded deadline. The deletion
is sealed with the scope row's persisted recovery key version, appended to the
independent ledger, and only then committed in PostgreSQL with its monotonic
receipt. Other installations and links remain active.

Permits and outbox history retain immutable account-link scope, link generation,
installation generation, and deletion ID after foreign keys are cleared. Drain
expires every unstarted scoped permit and cancels its leased outbox. Immediately
before provider submission, the service re-locks and checks the installation,
exact account link and generation, outbox, and permit, requiring each state
update to affect one row. A late start after unlink or revoke is rejected.
Started work past its provider deadline is finished as non-retryable
`provider_outcome_unknown`; accepted and unknown histories retain their
tombstone association through deletion and the normal retention window. Restore
applies the same fence before deleting a replayed link or installation.

The `DeletionLedgerPort` must be backed by append-only storage outside both
PostgreSQL and the database backup bucket. Its adapter must provide atomic
idempotency by deletion ID, monotonic sequences, a durable head, and exact range
reads. Each item and scope identifier is MACed with a separately versioned key
held outside both storage systems. During rotation, the new version signs new
scopes while every historical version remains verify-only until all backups
that reference it have expired. Missing historical keys are a hard stop.

Restore order is mandatory:

1. Keep mutation, monitor, and delivery gates closed and restore the encrypted
   PostgreSQL backup with its ledger watermark.
2. Obtain the independent ledger's durable current head and all required
   tombstone-MAC key versions from their separate custodian.
3. Call `prepareRestore(backupWatermark)`, verify an unbroken sequence and every
   MAC through the current head, and replay each deletion by recovery MAC.
4. Validate every remaining token by unwrapping its row-specific DEK and
   authenticating its ciphertext/AAD in bounded batches.
5. Atomically record the new watermark/head and open mutations. Monitor and
   delivery gates remain closed until the separate U14 activation audit passes.

A stale head, sequence gap, invalid MAC, unavailable ledger, missing MAC/KEK
version, token authentication failure, or replay error leaves all gates closed.
Local tombstones are idempotent only when scope, MAC, generation, sequence, and
key version match the independent receipt exactly; conflicting local rows also
hard-stop restore.

## Retention and verification

Cleanup accepts a bounded batch size from 1 through 1000 and uses ordered,
retryable `SKIP LOCKED` deletion batches. Consumed or expired challenges are
eligible after 24 hours, dedupe rows after their bounded expiry, and delivery
metadata after 30 days. Independent tombstones are not deleted by this job.

Run the deterministic, offline suite:

```sh
bun test packages/notifications/src/*.test.ts apps/notifications/src/*.test.ts
```

Run migrations, rollback, restore, quota races, and independent-connection
proofs against a disposable PostgreSQL 17 container:

```sh
bun run test:notifications
```

The runner uses an exact process-scoped container name, a loopback-only random
port, a 20-second readiness bound, and always stops that exact container. To use
an already isolated database, set `NOTIFICATION_TEST_DATABASE_URL`; the default
repository test suite never contacts Hyperliquid or any push provider.

`viem` is the only reusable runtime dependency added for this foundation and is
used for EIP-191 address recovery. PostgreSQL access and AES/HMAC primitives use
Bun and Web Crypto built-ins; no service framework was introduced.
