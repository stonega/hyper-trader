# State-changing action lifecycle

## Status and invariants

This contract owns the path from a reviewed, typed intent to authoritative
reconciliation. It applies to order creation, cancellation, reduce-only close,
and leverage updates. No other screen, notification handler, background task, or
transport may construct or submit a state-changing request.

The non-negotiable invariants are:

1. The selected network's signer capability is checked before protected-key
   access and its transport capability is checked again before `/exchange`.
2. One SQLite transaction reserves the nonce and immutable journal record before
   signing.
3. `submission_started` is durable before the first transport write. Once set,
   that journal record may reconcile but may never write to transport again.
4. A signer, target, network, and captured context epoch must all match.
5. Secrets, signatures, canonical preimages, and complete signed payloads are
   memory-only and never enter diagnostics.

Custody and replacement are defined in
[`api-wallet-custody.md`](api-wallet-custody.md). Release gating is defined in
[`../implementation/security-review.md`](../implementation/security-review.md).

## Ownership of bytes

| Stage | Owner | Output | May persist? |
|---|---|---|---|
| Draft | `apps/mobile` feature UI | User-editable values and selected context | Draft only, scoped by context fingerprint; no signing bytes |
| Validation | `packages/hyperliquid` domain layer | Normalized typed intent with decimal strings and canonical asset IDs | Secret-free intent fields and digest |
| Review snapshot | `apps/mobile` action orchestrator | Immutable typed intent plus binding, metadata versions, account snapshot, and context epoch | Secret-free snapshot fields |
| Action codec | `packages/hyperliquid` | Exact protocol action object, MessagePack bytes, action hash, and typed signing payload | Memory only; journal stores only digest and reconciliation fields |
| Signature | narrow mobile signer adapter | Signature over the codec-owned payload | Memory only; never returned to UI or generic state |
| Envelope | `packages/hyperliquid` transport adapter | Exact `/exchange` body | Memory only |
| Transport | fixed-origin mobile exchange client | One HTTPS request and classified response | Only redacted result class and provider correlation |

The codec owns field ordering, optional-field omission, decimal representation,
domain selection, hashing, and signature recovery. UI and transport code may not
rewrite its bytes. Every supported action must match committed vectors generated
from a pinned official Hyperliquid Python SDK revision before the transport is
enabled.

HIP-3 order transport has an additional behavioral gate. Current official SDK
tracking in [issue 251](https://github.com/hyperliquid-dex/hyperliquid-python-sdk/issues/251)
and [pull request 306](https://github.com/hyperliquid-dex/hyperliquid-python-sdk/pull/306)
reports environments where a HIP-3 order carrying `cloid` is rejected, while
this contract requires `cloid` for safe unknown-outcome reconciliation.
Every HIP-3 market therefore remains read-only until a disposable-agent live
testnet probe for its supported order family proves create-with-`cloid`,
query-by-`cloid`, timeout reconciliation, and no duplicate transport. Offline
byte/signature parity is insufficient. If the protocol still rejects `cloid`,
Hyper Trader requires a documented protocol-supported correlation mechanism and
a new security review before enabling HIP-3 writes; it must not silently omit
`cloid`.

Forbidden everywhere outside the signer/transport stack: API private keys, raw
signatures, signing preimages, MessagePack action bytes, full action JSON, and
complete signed `/exchange` bodies. Logging accepts an explicit redacted event
type, never an arbitrary intent, error response, signature, or request object.

## Context fence and review

The context identity is `(network, masterAccount, targetAccount)`. The context
supervisor increments a durable process epoch before any member changes. A
review snapshot captures that epoch, signer binding/generation, market identity,
precision/leverage metadata version, relevant account state version, normalized
intent, and an expiry.

Every asynchronous validation, authentication, signing, and pre-submit effect
checks the captured epoch before starting and before committing its result. A
change expires the draft and clears the signing session. Device authentication
after session expiry returns only to a fully refreshed and unchanged draft.

Once the atomic reservation below commits, its scoped reconciler may continue
after a context switch without signer access. It writes only to that journal
scope and may publish a passive status event; it cannot mutate another active
context or transport the action again.

## Clock and expiry gate

Hyperliquid requires millisecond nonces within its accepted time window and
supports `expiresAfter` on the L1 actions in this delivery. Hyper Trader applies
a tighter policy:

- Maintain `last_observed_wall_ms` durably per installation and a fresh
  Hyperliquid server-time sample with a monotonic sample age.
- A wall-clock rollback greater than 1,000 ms, a missing/stale server sample
  (older than 30 seconds), or absolute wall/server skew greater than 5 seconds
  blocks preparation. Refresh authoritative time; never silently add an offset.
- Let `currentMilliseconds` be the validated device wall time. Reserve
  `nonce = max(currentMilliseconds, last_issued_nonce + 1)`.
- Set `expiresAfter = currentMilliseconds + 15_000`. Reject if it is not later
  than the nonce or if review cannot finish before it. Never extend a signed
  action; expiry requires a fresh review and reservation.

Clock failure is a signing stop but not a reconciliation stop. The protocol
window and signer-scoped nonce behavior are documented in Hyperliquid's
[nonce guidance](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/nonces-and-api-wallets).

## Atomic nonce and journal reservation

`apps/mobile` owns one process-wide coordinator and the SQLite implementation;
`packages/hyperliquid` owns pure rules and repository ports. Every independent
database connection uses the same transaction contract.

Under `BEGIN IMMEDIATE`, a single transaction:

1. verifies the selected network's compile-owned action capability, active binding, non-retired
   signer scope, review fingerprint, epoch, and clock gate;
2. reads and advances `last_issued_nonce` using the formula above and updates
   `last_observed_wall_ms`;
3. inserts the immutable `prepared` journal row; and
4. commits both changes or neither.

Required journal fields are:

```text
journal_id, correlation_id, network, master_account, target_account,
agent_address, signer_generation, captured_context_epoch, action_type,
intent_version, normalized_secret_free_intent, intent_digest,
equivalence_fingerprint, nonce, expires_after_ms, cloid, asset_id,
target_oid, reconciliation_key, prepared_at, state,
submission_started_at, last_result_class, lease_owner, lease_expires_at,
created_at, updated_at
```

Nullable fields apply only to relevant action types. Storage never includes the
private key, signature, signing payload, action bytes, or complete transport
body. Constraints are:

- unique `(network, agent_address, nonce)`;
- unique `correlation_id`;
- unique non-null `(network, target_account, cloid)`;
- a partial unique index on `(context identity, action_type,
  equivalence_fingerprint)` for all nonterminal records.

New orders and order-based closes receive a cryptographically random 128-bit
`cloid` before reservation. Cancels reconcile by canonical asset plus target
`oid` or `cloid`. Leverage changes reconcile by asset, margin mode, and target
value. Equivalent intents remain blocked until the prior record reaches an
authoritatively reconciled terminal state.

## Sign and write-once transport

After reservation, the orchestrator reconstructs the codec input from the
immutable intent, repeats binding/epoch/capability checks, unlocks the exact
signer, and signs in memory. Immediately before calling `fetch`, it commits
`submission_started_at` and state `submission_started`.

The first possible socket write occurs only after that commit. All code paths
query the durable marker before transport. A marker means **never submit this
record again**, including after timeout, retryable HTTP errors, process restart,
or a report that no order was found. Network libraries have automatic retries
disabled for `/exchange`.

Classify a complete authoritative response as accepted, rejected, or expired.
The exact documented minimum-notional rejection is the only provider error
allowlisted for presentation and maps to
`Order must have minimum value of $10.`. Other provider error strings are
discarded after classification and remain a generic rejection to the user.
Timeout, connection loss, malformed response, app termination, or any uncertainty
after `submission_started` yields `unresolved`; it is never converted to
rejected merely because the client did not receive a response.

## Crash boundaries

| Crash point | Recovery rule |
|---|---|
| Before reservation commit | No journal/nonce exists; the draft must be reviewed again. |
| After commit, before signature | Keep the nonce consumed locally. Do not auto-sign after restart; expire as `abandoned_before_submission` and require a new review. |
| After signature, before `submission_started` commit | The signature dies with memory. No write was allowed; abandon after expiry and never reuse the nonce. |
| After `submission_started` commit, before/during response | Treat as unresolved even if no socket write actually occurred. Reconcile only. |
| After provider acceptance, before response persistence | Reconcile from authoritative account/order state; never repeat transport. |
| During reconciliation | Lease expiry permits another reconciler; transport remains forbidden. |

## Reconciliation state machine

States are `prepared`, `submission_started`, `unresolved`, and the terminal states
`accepted`, `rejected`, `expired`, `abandoned_before_submission`, and
`reconciled_ambiguous`. Only authoritative response data or the action-specific
queries below may choose a post-submission terminal state.

A reconciler acquires a 30-second lease with a compare-and-swap on an unowned or
expired lease and renews it every 10 seconds. The lease owns queries and journal
updates only. Process death lets the lease expire; it never grants transport
authority. Backoff is bounded and persisted so foreground resume does not create
a query storm.

### New market/limit order

Query the documented `orderStatus` endpoint by exact `cloid`. An observed
live/final order is accepted and a definitive protocol rejection is rejected.
The documented open-order and fill response shapes do not expose `cloid`, so
they are supplementary evidence only and must never be heuristically matched to
a create action. A strict `unknownOid` response may become expired only from a
fresh server-time sample later than `expiresAfter`. Contradictory exact evidence
becomes `reconciled_ambiguous` and requires user-visible manual review, never an
automatic duplicate.

### Reduce-only close

Use the same `cloid` order path and additionally query the position. Acceptance
requires an observed close order/fill or the intended reduce-only position
effect. A position changed by unrelated activity is recorded as ambiguous unless
the order/fill correlation proves this action. No retry may turn a close into an
opposite position.

### Cancel

Query the target order by canonical asset and `oid`/`cloid`, then open orders.
Canceled/absent-after-observed status, filled, or otherwise terminal order state
resolves the outcome. If the exact order remains open after action expiry and a
fresh snapshot, this cancel is expired/rejected; a new cancel is a new reviewed
intent with a new nonce, never a replay of the journal record.

### Leverage update

Query authoritative asset/account state for target leverage and margin mode. An
exact match resolves accepted; a definitive rejection resolves rejected. A
different value after expiry resolves expired only when the state version is
newer than the action. A matching value that cannot be causally distinguished
from external activity is `reconciled_ambiguous`, which is terminal and shown to
the user without resubmission.

## Rotation and retired signer scopes

Rotation first marks the signer `retiring`, which blocks nonce allocation and
signing. Ordinary rotation waits for every record to become terminal. Emergency
external revocation may proceed while records remain unresolved, but those
records retain public-query reconciliation only.

Before deleting the old secret, append a retired signer tombstone containing the
non-migrating SecureStore installation epoch, sequence, prior chain root,
`network`, a one-way agent-address fingerprint, last issued nonce, generation,
retired time, and reason to the SQLite retirement hash chain. Then advance the
SecureStore custody manifest's retirement watermark/root. If either write fails,
do not delete the old secret or report retirement complete. The nonce allocator
rejects any matching active or tombstoned address.

On startup, SQLite must reproduce the SecureStore epoch, sequence, and root. An
older restored SQLite database, missing non-migrating manifest on another device,
or any mismatch quarantines all signing state and requires authoritative
registration verification plus fresh authorization; restored state never issues
a nonce. An SQLite chain ahead of the manifest is an interrupted retirement and
is reconciled under device authentication before use. Tombstones survive local
account cleanup for the installation lifetime and rollback is detected rather
than trusted; they contain no master/target label after unlink. Fresh generation
uses a fresh random address regardless of tombstone presence.
