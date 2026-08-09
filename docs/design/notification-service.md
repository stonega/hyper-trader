# Notification service security and privacy contract

## Trust boundary

The notification service monitors public Hyperliquid data and sends push alerts
while the app is closed. It has no signer, API-wallet key, master secret,
signature, signed action, or `/exchange` capability. It imports only
`@hyper-trader/hyperliquid/public`; CI must reject any dependency path from the
service to action, signer, authenticated-account, or exchange modules.

The service may store public account identifiers, verified account links, alert
rules, hashed installation credentials, encrypted Expo push tokens, event dedupe
keys, minimal delivery metadata, and deletion tombstones. It does not retain raw
market/account snapshots or full push payloads after evaluation.

## Installation authority

The mobile app creates a random 256-bit installation bearer credential and a
random 128-bit public installation ID. The credential is stored in a dedicated
authenticated SecureStore record, separate from the API-wallet record, and sent
only over the fixed HTTPS service origin. The server stores a SHA-256 credential
hash, never the bearer value. Credential comparison is constant-time.

The credential may register the installation's first push token, create and
mutate price-only rules, request an account-scope challenge, delete existing
scoped data, and revoke the installation. It cannot prove master-account
control, create or rebind an account link, create or mutate an account-scoped
rule, rebind a push token that receives account-scoped alerts, sign an exchange
action, or access another installation. Each of those account-scoped mutations
requires a fresh proof for the exact operation. Credential loss creates a new
installation; account-scoped rules require new master proof. Credential rotation
atomically activates a new hash and rejects the old one.

## Exact account-scope proof v1

Creating or rebinding a link, creating or mutating an account-scoped rule,
rebinding a push token that receives account-scoped alerts, and revoking a lost
linked installation each require a current one-time proof from the master
wallet. The service first authenticates the requesting installation credential
and creates 32 random challenge bytes. It stores only `SHA-256(challenge)` plus
the exact bound fields and operation digest, and returns the raw challenge once.

The wallet signs the following exact UTF-8 bytes with Ethereum `personal_sign`
(EIP-191). Fields are ASCII, separated by LF (`0x0a`), with no trailing LF:

```text
Hyper Trader Notification Account Scope
Version: 1
Service-Origin: <lowercase https origin, no trailing slash>
Challenge: <64 lowercase hex characters>
Installation: <32 lowercase hex characters>
Network: <testnet|mainnet>
Master-Account: <0x + 40 lowercase hex characters>
Target-Account: <0x + 40 lowercase hex characters>
Purpose: <notification-account-link|notification-account-rule-mutation|notification-push-token-rebind|notification-installation-revoke>
Operation-Digest: <64 lowercase hex characters>
Issued-At: <base-10 Unix milliseconds, no leading zero>
Expires-At: <base-10 Unix milliseconds, no leading zero>
```

This header, version, purpose, origin, and fixed field order are the domain
separator. The verifier accepts no alternate whitespace, casing, field order,
Unicode normalization, JSON representation, signature method, or version.
`Expires-At` is exactly five minutes after `Issued-At`; both come from database
time. `Operation-Digest` is SHA-256 over the server's versioned canonical bytes
for the exact link, complete rule replacement, new token fingerprint, or sorted
set of selected linked installation IDs. The challenge is bound to the current
requesting installation credential hash, installation, network, master, target,
purpose, operation digest, and service origin.

Verification must recover exactly `Master-Account` and independently verify from
current public Hyperliquid role data that the target relationship is supported.
A wallet callback is not proof. The signature and message are never persisted.

Challenge consumption and link creation are one database transaction:

1. Parse canonical bytes, recover the signer, and begin a serializable
   transaction.
2. Conditionally change the matching row from `pending` to `consumed` only when
   its digest and all bound fields match, the installation credential is still
   active, and database time is before expiry.
3. Perform only the operation whose digest and purpose were signed in the same
   transaction. If this write fails, challenge consumption rolls back. A
   concurrent replay updates zero rows and changes nothing.
4. Commit, then discard the request signature and raw message. Retain the link's
   account/network/purpose, proof version, verification time, and relationship
   check result—not proof bytes.

For `notification-installation-revoke`, step 3 creates a durable revocation
operation and moves every selected installation/link scope to `draining`. The
request may select one linked installation or all installations linked to the
proved master/target/network. Completion follows the dispatch fence and deletion
ledger below, revokes the old bearer and token, deletes its links and rules,
cancels unsent work, and cannot affect an installation outside the signed sorted
set. This is the recovery path when the old device and bearer are unavailable.

Challenges are single-use, non-renewable, limited to five issues per installation
per hour and ten failed proof attempts per IP per hour, and deleted within 24
hours after consumption/expiry. An installation bearer alone may inspect or
delete a proven link, but cannot create, rebind, or mutate account-scoped
authority.

## API limits and upstream budgets

- Request bodies: 64 KiB maximum; strict schemas reject unknown fields.
- One installation: at most 10 linked account targets and 100 active rules.
- Mutation admission: 30 requests/minute per installation and 60/minute per IP;
  proof limits above are additional. Sustained abuse receives a bounded 429.
- Token changes: 10/hour per installation. Revocation is never rate-limited after
  successful authentication.
- Public Hyperliquid connection, subscription, and weighted-request utilization
  stays below 70% of the current documented limits. Admission stops before that
  budget; it never borrows exchange authority.
- Each network/account-or-market monitor shard has one PostgreSQL lease owner.
  Leases expire after 30 seconds and renew every 10 seconds; takeover starts from
  an authoritative snapshot before accepting deltas. Graceful shutdown releases
  the lease only after its subscriptions close. Two replicas must not maintain
  duplicate subscription sets for the same shard.

## Push-token encryption and key custody

Expo push tokens are confidential service data. Store a SHA-256 fingerprint for
uniqueness and an AES-256-GCM ciphertext with a unique random 96-bit nonce. AAD is
the canonical UTF-8 string
`push-token/v1|installationId|provider|tokenFingerprint`. Authentication failure
is a hard stop; the token is never used or logged.

Key ownership is deployment-portable and explicit:

- The notification security operator owns a 256-bit key-encryption key (KEK) in
  an external KMS/HSM or secrets manager. It is outside PostgreSQL, database
  backups, images, source, CI artifacts, and ordinary environment variables.
- A `PushTokenKeyProvider` port supplies `wrap`, `unwrap`, and active-key-version
  operations through workload identity or a read-only secret mount. Cloud vendor
  adapters may differ; the storage contract does not.
- Random 256-bit data-encryption keys (DEKs) encrypt tokens. PostgreSQL stores
  only versioned wrapped DEKs and ciphertext metadata. The runtime unwraps the
  needed DEK into bounded memory only immediately before decrypt/encrypt and
  zeroes references after use.
- Database backups contain ciphertext and wrapped DEKs only. The operator's
  separately controlled recovery procedure backs up or replicates KEK authority;
  a database backup alone cannot decrypt tokens.

Rotation creates a new DEK/KEK version, makes it encrypt-active, and re-encrypts
rows in bounded locked batches. Old versions are decrypt-only until every row is
migrated and a restore drill proves the newest backup. They are destroyed only
after the maximum encrypted-backup window plus tombstone replay window. A
cross-provider move unwraps and rewraps DEKs inside an audited migration process;
plaintext keys never enter the export bundle. Restore must first recover key
authority, then PostgreSQL, replay deletion tombstones, verify sample ciphertext,
and only then start workers. Missing keys keep delivery disabled.

## Delivery, revoke, and delete races

Event evaluation creates one alert and outbox row under a unique event key in one
transaction. Workers use expiring leases and stable alert IDs. A crash after a
provider accepts a push may duplicate delivery, so the contract is bounded
at-least-once; the mobile app deduplicates by alert ID.

Before a provider call, a worker transaction verifies the installation/link is
`active`, records its revocation generation, and acquires a 30-second dispatch
permit. It rechecks both immediately before the call. The provider request uses
an `AbortSignal` deadline of 10 seconds and no transport retry. A timeout, worker
crash, or lease expiry records `provider_outcome_unknown` with the stable alert
ID and provider attempt metadata; it is never treated as unsent. Revocation/unlink:

The worker must first commit `provider_submission_started` in a transaction that
requires the scope still `active`, the same revocation generation, an unexpired
permit, and a live request deadline. The first possible network write occurs only
after that marker. Immediately before `fetch`, the worker checks the permit and
deadline again; an expired value aborts without a provider call. A marker is
write-once: after restart the attempt may query a provider receipt or remain
unknown, but it may never call the provider again.

1. atomically changes the scope to `draining`, preventing new permits;
2. waits for every `provider_submission_started` attempt to finish or reach its
   deadline, preserving unknown outcomes as in-flight history;
3. writes the deletion intent to the independent ledger below and obtains its
   durable sequence receipt; and
4. commits `inactive`, increments the revocation generation, cancels matching
   unsent outbox rows, deletes scoped rules/link/token association, and records
   the ledger receipt plus local tombstone in one transaction.

No provider submission may start after that commit. A push accepted before the
commit cannot be recalled; it remains minimal, marked `in_flight_after_revoke`,
and visible in delivery history. Process death during a provider call is treated
as potentially accepted; drain waits for lease expiry and preserves that fact.

## Payload and retention policy

A provider payload contains only an opaque alert ID, category, network identifier,
and a non-authoritative route hint. It contains no address, symbol if it reveals
account activity, balance, position, size, side, price, order/fill detail, PnL,
margin, liquidation value, auth token, or executable deep-link parameters. The
locked-screen title/body is generic (for example, “Trading alert available”).
After entry, the app authenticates, validates the active context, and fetches full
state; notification data never selects an account or prepares an action.

Retention is:

- active installation, encrypted token, verified links, and rules: until revoke
  or unlink;
- delivery metadata and provider ticket status: 30 days;
- event dedupe keys: 7 days;
- consumed/expired proof challenges: at most 24 hours;
- raw evaluated data and full provider payload: zero durable retention;
- deletion tombstones: longer than the maximum encrypted-backup retention
  window, then removed only after every eligible backup has expired.

Tombstones identify deleted scopes by keyed one-way identifiers and deletion
generation. They are appended idempotently through a `DeletionLedgerPort` to a
separately replicated, append-only recovery log whose recovery point is
independent of every eligible PostgreSQL backup. A versioned write-once object
store or dedicated append-only log may implement the port; the primary database
and its backup bucket may not. The ledger returns a monotonic sequence receipt,
and deletion never reports completion before that receipt is durable.

Identifiers use HMAC-SHA-256 with a separate versioned tombstone-MAC key held by
the recovery security operator in external KMS/HSM or a read-only secret mount.
Each ledger item records its key version. Old versions remain verify-only through
the full database-backup plus tombstone-retention window. A
`TombstoneKeyProvider` exposes only MAC/verify operations; this key is not a push
token KEK and is absent from PostgreSQL, ledger objects, backups, images, source,
CI artifacts, and ordinary environment variables.

Every database backup records its last applied ledger sequence. Restore obtains
the independent ledger's current head, verifies an unbroken sequence and every
MAC from the restored sequence through that head, replays all deletions, and
records the new watermark before monitors, mutations, or delivery workers start.
A missing key version, sequence gap, stale or unavailable ledger head, invalid
MAC, or replay failure keeps the service disabled. This independent recovery
boundary prevents an older database snapshot from resurrecting a device, link,
token, rule, or unsent outbox item.

## Incidents and credential rotation

| Event | Immediate stop | Recovery |
|---|---|---|
| Installation credential theft | Drain/revoke that installation; reject old hash | New credential and token; repeat master proof for account rules |
| Push-provider credential theft | Disable provider workers globally | Revoke/rotate provider credential, audit tickets, staged delivery test |
| KEK/DEK suspected exposed | Disable token decrypt and provider submission | Rotate key hierarchy, re-encrypt or require token re-registration, restore drill |
| Tombstone key/ledger unavailable or suspect | Disable mutations, monitors, and provider workers | Restore continuity and key versions, replay through current head, verify watermark |
| Database/backup disclosure | Disable mutations and assess ciphertext/key separation | Rotate bearer credentials and keys as indicated; replay deletions |
| Forged/replayed account proof | Reject canonical/signature/conditional-consume check | Rate-limit, audit challenge IDs, no link mutation |
| Outbox/delete race | Enter draining and preserve active permits | Commit deletion only after drain; expose already accepted push |
| Hyperliquid upstream budget breach | Stop new rules/subscriptions | Shed work, resynchronize public state, resume below 70% |

Reown project configuration, push-provider credentials, TLS credentials, account
proof verifier versions, and push encryption keys each have a named owner,
rotation runbook, last-drill date, and revocation path in the security review.
