# Security review and live-integration gate

## Gate state

This is the blocking sign-off record for U1. U5-U7 may implement deterministic,
offline components, but no live external-wallet registration, signer access, or
`/exchange` transport may be enabled until all four review owners approve the
same evidence revision. Missing, expired, or conditional approval means **stop**.

| Review | Required owner | Evidence revision | Decision/date |
|---|---|---|---|
| Protocol and signing | Hyperliquid protocol reviewer | `u1-doc-v1` | Document contract PASS; runtime evidence pending — 2026-08-09 |
| Mobile custody and release | Mobile security reviewer | `u1-doc-v1` | Document contract PASS; runtime evidence pending — 2026-08-09 |
| Notification privacy and operations | Privacy/service-security reviewer | `u1-doc-v1` | Document contract PASS; runtime evidence pending — 2026-08-09 |
| Recovery and incident response | Operations/recovery reviewer | `u1-doc-v1` | Document contract PASS; runtime evidence pending — 2026-08-09 |

Approval expires after any custody, codec, nonce schema, account-proof, key
provider, origin, native config-plugin, OTA, or credential-authority change.
These decisions approve the version-one document contracts only. They are
conditional for live integration: every applicable unchecked runtime or drill
row below still means stop, and later evidence must update all four decisions to
unconditional approval for the same revision before live U5-U7 paths activate.

U13 automated, device, external-system, and reviewer receipts are recorded in
[`release-evidence.md`](release-evidence.md). That record deliberately leaves
physical-device, Reown, push-provider, database-restore, credential-rotation,
and live-testnet rows pending; this document's conditional gate therefore
remains closed.

## Required checklist

### Protocol and action integrity

- [ ] API-agent address derivation, stable name, expiry representation,
  named-slot behavior, authoritative registration query, and replacement match a
  pinned official Python SDK/protocol revision.
- [ ] `approveAgent`, market, limit, cancel, reduce-only close, leverage,
  optional vault, and `expiresAfter` fixtures match exact bytes, hashes, domains,
  recovered addresses, and signatures.
- [ ] Each enabled HIP-3 order family passes a disposable-agent live-testnet
  create-with-`cloid`, query-by-`cloid`, timeout-reconciliation, and no-duplicate
  probe. A family without this evidence remains read-only regardless of offline
  vector parity.
- [ ] Mainnet and testnet hashes differ as expected while compiled mainnet
  signer/transport capabilities remain false.
- [ ] Independent SQLite connections prove nonce+journal atomicity, uniqueness,
  clock rollback stop, lease recovery, and no second write after
  `submission_started`.
- [ ] Every action-specific reconciliation route reaches an authoritative
  terminal or user-visible ambiguous state without duplicate submission.
- [ ] Retired agent addresses remain tombstoned and replacement proves the old
  address inactive before success is shown.

### Mobile custody and release integrity

- [ ] iOS release builds prove passcode/device-only SecureStore access, Face ID
  denial/lockout/enrollment change, background lock, surviving-Keychain reinstall
  quarantine, and deletion.
- [ ] Android release builds prove strong-biometric access, invalidation,
  Keystore failure, backup exclusion, uninstall loss, and deletion.
- [ ] The five-minute non-sliding session clears on every documented lifecycle,
  context, error, and manual-lock event; reauthentication refreshes/revalidates a
  draft.
- [ ] Single-flight unlock tests prove epoch and binding fences discard late
  SecureStore/authentication results after background, inactive, Android blur,
  manual lock, and context change. Physical tests cover task switching and
  notification/control-center focus loss while authentication is open.
- [ ] Forged, replayed, expired, wrong-account, wrong-target, wrong-network, and
  wrong-session wallet callbacks remain inert; authoritative registration is the
  only activation proof.
- [ ] Lost/compromised-device and rotation-during-unresolved-action exercises
  preserve reconciliation, stop signing, and never reuse the old address.
- [ ] Signing builds accept signed EAS Updates or set `updates.enabled: false`,
  verify both generated native configurations, report `Updates.isEnabled ===
  false`, and fail a remote-update probe. Fixed origins reject runtime overrides,
  redirects, non-TLS connections, and TLS failure.
- [ ] Lockfile, dependency provenance, Reown changes, native config plugins, and
  update configuration have controlled review and credential owners.

### Notification privacy and service security

- [ ] The service dependency graph reaches only the public Hyperliquid entry
  point and contains no signer, signed action, private account, or `/exchange`
  capability.
- [ ] Account-scope proof v1 exact-byte fixtures cover link, account-rule
  mutation, push-token rebind, and lost-installation revoke purposes plus forged,
  replayed, expired, noncanonical, wrong-origin, wrong-installation,
  wrong-account, wrong-target, wrong-network, wrong-operation-digest, over-broad
  installation selection, and transaction-race cases.
- [ ] Challenge consumption and link creation are atomic; no failed transaction
  consumes a challenge and no successful path retains proof/signature bytes.
- [ ] Installation credential authority and quotas are enforced; a bearer alone
  can create or mutate only price rules and delete/revoke existing scoped data.
  Every account-rule mutation and account-alert token rebind requires a fresh
  operation-bound master proof.
- [ ] Push-token ciphertext/AAD/key-version tests, KEK separation, rotation,
  cross-provider rewrap, backup restore, and missing-key worker stop pass.
- [ ] Revocation/outbox races prove the ten-second provider deadline,
  thirty-second permit expiry, durable `provider_submission_started` fence,
  drain-before-commit, and no provider call after commit; accepted or unknown
  in-flight delivery remains observable.
- [ ] Every deletion obtains an independent append-only ledger receipt before
  completion. Restore proves backup watermark-to-current-head continuity,
  versioned tombstone MAC verification, replay, and a hard worker stop for any
  missing key, stale head, or sequence gap.
- [ ] Locked payload inspection proves no account/trading detail or executable
  action input; retention cleanup and tombstone replay pass.

### Recovery and incident operations

- [ ] API-wallet loss, expiry, biometric invalidation, external revocation,
  unconfirmed revocation, and account unlink each have an exercised stop and
  recovery path.
- [ ] Push provider, installation bearer, notification encryption key, update
  signing key, Reown credential, TLS credential, and database disclosure drills
  name an owner, disable boundary, rotation order, and verification query.
- [ ] PostgreSQL forward/rollback migration and encrypted-backup restore replay
  independently recovered tombstones before workers start; unavailable key
  authority or ledger continuity keeps mutations, monitors, and workers off.
- [ ] Diagnostics/support bundles contain no real secret, signature, complete
  signed payload, push token, proof, or unrestricted account data.
- [ ] A staged testnet agent replacement and disposable-agent live test run only
  after explicit operator confirmation.

## Credential and incident inventory

Every row is part of evidence revision `u1-doc-v1`. “Not exercised” keeps the
corresponding runtime gate closed; it is an explicit drill state, not approval.

| Authority | Accountable role | Runbook location and status | Emergency disable and rotation order | Verification probe | Last drill / evidence |
|---|---|---|---|---|---|
| EAS update signing | Release security | [`setup.md` OTA policy](setup.md#ota-policy), documented | Disable update channel; revoke key; issue certificate under a new runtime/store build; stage signed update | Valid signed staging update succeeds; unsigned and invalid updates fail; disabled mode reports `Updates.isEnabled === false` | Not exercised; `u1-doc-v1` |
| Reown project and redirect configuration | Mobile release owner | [`api-wallet-custody.md` external approval](../design/api-wallet-custody.md#external-approval-and-registration-proof), documented | Disable connector setup; revoke project credential/sessions; rotate allowlist and project configuration; release reviewed build | Wrong-origin/session callbacks stay inert; exact attempt plus authoritative registration succeeds | Not exercised; `u1-doc-v1` |
| Notification TLS | Service operator | [`architecture.md` fixed origins](../design/architecture.md#fixed-origins-and-release-integrity), documented | Remove service from routing; revoke certificate/key; rotate; restart reviewed endpoint | Exact-origin health succeeds; bad certificate, redirect, alternate host, and non-TLS fail | Not exercised; `u1-doc-v1` |
| Expo push-provider credential | Notification operator | [`notification-service.md` incidents](../design/notification-service.md#incidents-and-credential-rotation), documented | Stop provider workers; revoke provider credential; audit tickets; rotate; stage one synthetic delivery | Provider authentication and receipt query succeed only with new credential | Not exercised; `u1-doc-v1` |
| Installation bearer | Notification security operator | [`notification-service.md` installation authority](../design/notification-service.md#installation-authority), documented | Drain/revoke selected installation; reject old hash; issue new installation; re-prove account authority | Old bearer fails; new price rule works; account rule fails without fresh proof | Not exercised; `u1-doc-v1` |
| Push-token KEK/DEKs | Notification security operator | [`notification-service.md` key custody](../design/notification-service.md#push-token-encryption-and-key-custody), documented | Stop decrypt/provider workers; rotate KEK/DEK versions; rewrap/re-encrypt; restore drill; retire old versions after window | Sample current/backup ciphertext authenticates with expected version; missing key keeps workers off | Not exercised; `u1-doc-v1` |
| Tombstone-MAC key and deletion ledger | Recovery security operator | [`notification-service.md` retention](../design/notification-service.md#payload-and-retention-policy), documented | Stop mutations/monitors/workers; restore independent ledger and key versions; rotate with overlap; replay through head | Sequence is continuous from backup watermark; every MAC verifies; applied watermark equals head | Not exercised; `u1-doc-v1` |
| PostgreSQL and backup authority | Database operator | [`setup.md` service restore](setup.md#notification-service-secrets-and-restore), documented | Stop mutations/workers; revoke sessions/credentials; rotate; restore; migrate; replay independent ledger | Schema version, ciphertext sample, retention, tombstone watermark, and worker-disabled-until-ready assertions pass | Not exercised; `u1-doc-v1` |
| Account-proof verifier version | Service security operator | [`notification-service.md` exact proof](../design/notification-service.md#exact-account-scope-proof-v1), documented | Disable link/rule/token-rebind/recovery mutations; deploy reviewed verifier; invalidate outstanding challenges | Canonical fixtures pass; forged/replayed/wrong-operation proofs fail; no proof bytes persist | Not exercised; `u1-doc-v1` |

## Threat-scenario decisions

| Scenario | Required behavior and stop condition |
|---|---|
| Lost device | External revoke/replace; recovered installations stay read-only until old agent is authoritatively inactive; drain notification installation. |
| Compromised device | Clear memory, block nonce/signing, preserve secret-free reconciliation, start external emergency revocation; do not claim remote wipe. |
| Biometric enrollment change | SecureStore invalidation makes the credential unusable; fresh key authorization is required. |
| iOS Keychain survives reinstall | Missing install sentinel plus custody manifest quarantines records; reauthenticate, reselect, and reverify or delete. |
| Forged wallet callback | Parse only; a live exact setup attempt and authoritative registration are both required. |
| Rotation with unresolved action | Stop old signing; ordinary rotation waits. Emergency revocation leaves public-query-only reconciliation. |
| Clock rollback | Block reservation until a fresh server sample satisfies the skew gate; reconciliation continues. |
| Notification credential theft | Disable/drain affected authority, rotate the credential, and re-prove account links when installation authority is lost. |
| Outbox/delete race | Reject new permits, drain active calls/leases, commit inactive+cancellation+tombstone; disclose pre-commit accepted pushes. |
| Unsigned update | Signing-capable runtime rejects it; if code signing is absent, OTA is disabled. |
| Endpoint override/redirect | Compile-owned allowlist rejects before request; no debug or remote escape in release. |
| Accidental mainnet context | Compile matrix denies before secret access and before `/exchange`; context is restricted/read-only. |

## Trace matrix

This matrix is the replacement verification for U1. “Delete” means an explicit
path, not merely expiry.

| Asset/record/authority | Class and owner | Storage/use boundary | Delete/retire path | Stop condition |
|---|---|---|---|---|
| Master seed/private key | External secret; master wallet | Never enters Hyper Trader | Wallet owner only | Any request, persistence, or log blocks release |
| OS passcode/biometric and Keychain/Keystore | External authority; device OS/user | OS-owned; app receives only success/failure and protected reads | User/OS enrollment change or device erase | Invalidation, lockout, or integrity error blocks signing |
| Hyperliquid registration/time/account state | External public authority; protocol | Fixed-origin authenticated TLS queries | Protocol-owned; local cache expires | Mismatch, stale time, or unavailable proof keeps restricted/read-only |
| API-wallet private key | Device secret; mobile custody | Authenticated device-only SecureStore; five-minute signer memory | Rotation/unlink/emergency deletion; no backup | Binding/auth/integrity failure or mainnet blocks access |
| In-memory signing session | Ephemeral secret; signer adapter | Exact binding only | Timeout, background, context, lock, invalidation, termination | Missing review or epoch mismatch |
| External-wallet setup attempt | Durable non-secret; mobile | SQLite exact binding, ten minutes | Consume or expiry cleanup | Callback alone never advances |
| Custody manifest/install sentinel | Durable non-secret; mobile | SecureStore public manifest/app-data sentinel | Unlink cleanup or app removal | Missing sentinel + manifest quarantines |
| Binding/registration record | Durable non-secret; mobile | Local target-scoped repository | Unlink after tombstone | Authoritative mismatch/read-only |
| Public cache/preferences/recents | Durable non-secret; mobile | AsyncStorage, context-scoped where private preference leaks matter | Unlink/context cleanup or retention | Context mismatch discards rather than merges |
| Nonce scope/action journal | Durable non-secret; mobile | SQLite; no signature/payload | Retention after terminal; preserve unresolved | Atomicity failure or marker uncertainty blocks transport |
| Retired signer tombstone | Durable non-secret; mobile | SQLite hash chain bound to non-migrating SecureStore epoch/root | Installation lifetime only | Matching address or epoch/root rollback can never issue |
| Installation bearer | Device secret; mobile/service authority | Separate SecureStore; server hash only | Atomic rotation or revoke | Bearer cannot establish account ownership |
| Account-link challenge/signature | Ephemeral authority proof; master wallet | Challenge digest temporary; signature request-memory only | Atomic consume/expiry, <=24h row cleanup | Noncanonical/replay/wrong binding rejects |
| Verified account link/rules | Durable non-secret; service | PostgreSQL installation/network/account scope | Unlink/revoke plus tombstone | Missing current proof prevents creation/rebind |
| Expo push token | Service secret; notification operator | AES-GCM ciphertext; decrypt only before provider call | Token rotate/revoke/unlink plus tombstone | Auth/key/tag failure disables delivery |
| Push DEK/KEK | Service secret; security operator | Wrapped DEK in DB; KEK external KMS/HSM/secrets manager | Versioned rotation after restore window | Missing/suspect key disables workers |
| Dedupe/outbox/delivery | Durable non-secret; service | PostgreSQL, minimal metadata | 7/30-day cleanup or revoke cancellation | Draining forbids new dispatch permits |
| Deletion tombstone | Durable non-secret; recovery operator | Independently replicated append-only ledger with sequence receipt | After all eligible backups expire | Current-head continuity and replay required before mutations/workers |
| Tombstone-MAC key | Service secret; recovery security operator | Versioned external KMS/HSM or read-only secret mount | Rotate with verify-only overlap through backup+tombstone window | Missing version or invalid MAC disables service activity |
| Push-provider credential | External secret/authority; service operator | Managed secret injection, provider submission only | Provider revoke/rotate | Theft disables provider workers globally |
| Service TLS/database/backup credentials | External secrets; service operator | Deployment secret manager and least-privilege workload identity | Revoke/rotate and terminate affected sessions | Disclosure disables writes/workers until rotated |
| Update signing key | External secret/authority; release security | Offline/managed release signer, never app/repo | Certificate/runtime-version rotation | Invalid/unsigned update rejected or OTA disabled |
| Reown project config/session | External authority/ephemeral session; mobile release owner | Compiled reviewed configuration; session only in connector storage/memory | Disconnect, attempt expiry, provider rotation/new build | Unexpected redirect/origin/callback stops setup |
| Fixed Hyperliquid origins | External authority; protocol/release owners | Compile-owned HTTPS/WSS constants | Source-reviewed release change only | Override, redirect, or TLS error rejects |

## Non-behavioral evidence exception

U1 changes design and operational documentation only; it adds no runtime behavior
or executable test surface. Deliberate exception: no unit, integration, or device
tests are added or changed in U1. Existing repository test commands are inspected
only for applicability. Replacement verification is:

```sh
# terminology and required-stop audit across the six U1 documents
rg -n "mainnet|submission_started|reconcile|tombstone|account-link|SecureStore|signed EAS|OTA|fixed origin" \
  docs/design/{api-wallet-custody,action-lifecycle,notification-service,architecture}.md \
  docs/implementation/{security-review,setup}.md

# local Markdown links in the six documents must resolve
# (run the repository's bounded link-audit command recorded with the U1 result)
```

Reviewers compare every row above with the three design contracts and
[`setup.md`](setup.md). Application tests become mandatory in the implementing
units named by the plan; this exception cannot be carried into U5-U7 or the
notification service units.
