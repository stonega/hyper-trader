# Testnet runtime and security-approval closure plan

## Objective and current state

Enable real order testing only in source development builds while closing the
security gate with auditable evidence. Mainnet signing and transport remain
compile-time denied. Distribution and release builds remain unable to submit
orders until all four review owners approve the same immutable evidence
revision.

As of 2026-08-19, **0 of 28 required runtime or drill checks have final
approval**:

- Protocol and action integrity: 0/7
- Mobile custody and release integrity: 0/8
- Notification privacy and service security: 0/8
- Recovery and incident operations: 0/5

The existing document-contract decisions are conditional. They are not counted
as completed runtime approvals. Local development testnet execution is also not
approval evidence unless it follows an approved disposable-agent procedure and
is attached to the frozen evidence revision.

## Guardrails during closure

- Real submission is limited to `__DEV__` builds and the fixed Hyperliquid
  testnet origin. There is no environment, remote-config, OTA, or UI override.
- Release builds receive no signer manager or action orchestrator and therefore
  cannot show a confirmation control that writes to `/exchange`.
- Every submission still requires immutable review, explicit confirmation,
  strong local authentication, exact signer/context binding, authoritative
  market and account refresh, a current server-time sample, atomic nonce and
  journal reservation, and the write-once `submission_started` marker.
- Test operators use a disposable API wallet with the minimum practical
  testnet balance and revoke it after the run. Never use a mainnet credential.
- No test artifact may contain a private key, signature, signed payload, full
  action body, account address, push token, bearer, or provider response.
- Unresolved journal entries are never resubmitted. Reconciliation evidence is
  completed before uncertain-transport drills become routine.

## Delivery sequence

### Phase 0 — freeze the evidence contract

1. Assign the four accountable reviewers and one release-evidence custodian.
2. Name the next evidence revision, freeze the checklist wording, and record the
   exact commit, dirty-tree digest, Bun version, host, and UTC run window.
3. Classify every row as required or `NOT APPLICABLE` with a written reason.
   Only a row's accountable reviewer may approve `NOT APPLICABLE`.
4. Create a restricted evidence bundle and a redacted index. The repository
   stores only the redacted index and digests.

Exit: all 28 rows have an owner, procedure, artifact destination, and reviewer.

### Phase 1 — deterministic repository evidence

Run on a clean immutable commit:

```sh
bun install --frozen-lockfile
bun run check
bun run typecheck
bun test
bun run test:mobile
bun run test:e2e:mobile
bun run check:secrets
./scripts/check.sh
```

Also run Expo compatibility/health, iOS and Android exports, notification
PostgreSQL integration, protocol parity, nonce multi-connection race,
reconciliation, callback-fuzz, diagnostics-redaction, dependency-boundary, and
release-capability suites. Record commands, exit codes, timestamps, artifact
digests, and skipped-test counts. A skipped required test is not a pass.

Exit: every automatable row below has a deterministic receipt; no external row
is inferred from an offline test.

### Phase 2 — physical-device and external-system matrices

Execute the iOS and Android custody matrices, external-wallet callback matrix,
signed-update/disabled-OTA probes, push-provider race, PostgreSQL restore,
credential rotation, and incident exercises. Use release artifacts built from
the Phase 1 commit. Record device/OS/build or service revision, preconditions,
expected/actual result, timestamps, redacted logs, and artifact digest.

Exit: all physical and external rows have independently reviewable evidence.

### Phase 3 — controlled disposable-agent testnet run

This is last. The protocol, mobile custody, nonce/journal, and reconciliation
owners must first approve their prerequisite evidence. The operator then:

1. Creates a fresh disposable testnet API wallet and records only redacted
   fingerprints in the evidence index.
2. Verifies the app is a reviewed development build, the network is testnet,
   and mainnet capabilities are absent.
3. Runs market, limit, cancel, fill observation, position refresh, and
   reduce-only close; runs only separately enabled HIP-3 families.
4. Injects one bounded response-loss scenario and proves authoritative
   reconciliation without a second transport write.
5. Reviews device, Metro, service, and support logs for sensitive material.
6. Revokes the disposable agent, verifies it is inactive, and proves the local
   retired-address tombstone prevents reuse.

Exit: the restricted live receipt and redacted digest are approved by the
protocol and mobile reviewers.

### Phase 4 — four unconditional approvals

All four reviewers sign the same commit, build IDs, evidence-bundle digest, and
checklist revision. Any custody, codec, nonce schema, proof, key provider,
origin, native plugin, OTA, or credential-authority change invalidates the
approval and reopens affected rows.

Exit: 28/28 rows are complete or reviewer-approved `NOT APPLICABLE`, all four
decisions are unconditional, and the release decision changes from `stop` to
`approved`.

## The 28 closure work items

### Protocol and action integrity — Hyperliquid protocol reviewer

| ID | Closure work | Required evidence and acceptance |
|---|---|---|
| P1 | Pin official protocol parity | Record the exact official Python SDK commit/version. Add parity fixtures for agent address derivation, name normalization, expiry, named slots, authoritative registration, and replacement. Every byte-level result matches or the path stays disabled. |
| P2 | Complete action codec vectors | Cover `approveAgent`, market, limit, cancel, reduce-only close, leverage, optional vault, and `expiresAfter`; compare exact bytes, hashes, EIP-712 domains, recovered address, and signature. Run both implementation and pinned-reference vectors in CI. |
| P3 | Decide every HIP-3 family | Keep the current HIP-3 gate closed and obtain reviewer-approved `NOT APPLICABLE`, or run create-by-`cloid`, query-by-`cloid`, timeout reconciliation, and no-duplicate probes for each family before enabling it. Evidence is per family, never global. |
| P4 | Prove mainnet denial and domain separation | Automated tests show different mainnet/testnet hashes and show mainnet denial before SecureStore read, nonce mutation, signing, and fetch. Inspect both exported bundles for absent mainnet action capability. |
| P5 | Prove nonce/journal atomicity | Multi-process or independent-connection SQLite tests cover uniqueness, rollback, stale server time, wall-clock rollback, lease expiry/recovery, restart recovery, and exactly one transport permit after `submission_started`. |
| P6 | Finish authoritative reconciliation adapters | Implement and test market, limit, cancel, close, and leverage evidence loading. Each route ends accepted, rejected, expired, or user-visible ambiguous; incomplete/malformed evidence remains unresolved and never resubmits. Include app-restart and response-loss tests. |
| P7 | Complete signer retirement | Exercise rotation and external revocation with pending/unresolved actions. Prove the tombstone chain persists, the old address cannot register or issue a nonce, authoritative registration shows it inactive, and the replacement uses a new generation/address. |

### Mobile custody and release integrity — mobile security reviewer

| ID | Closure work | Required evidence and acceptance |
|---|---|---|
| M1 | iOS release custody matrix | Physical release build: passcode/device-only access, Face ID allow/deny/lockout, enrollment change, background lock, Keychain-surviving reinstall quarantine, explicit deletion, and zero-sensitive-log inspection. |
| M2 | Android release custody matrix | Physical release build: strong biometric, denial/lockout, enrollment invalidation, Keystore failure, backup exclusion, uninstall loss, deletion, notification-shade blur, and zero-sensitive-log inspection. |
| M3 | Five-minute session lifecycle | Automated fake-clock tests plus both-device runs cover background, inactive, Android blur, context switch, manual lock, timeout, memory warning, auth error, credential invalidation, compromise, and termination. Reauthentication authoritatively refreshes before signing. |
| M4 | Late-result and single-flight races | Deterministic deferred-auth/SecureStore tests prove epoch and binding fences discard every late result. Physical task-switch, notification/control-center, and authentication-dialog races produce a locked session and no signature. |
| M5 | External-wallet callback hostility | Fuzz and device tests cover forged, replayed, expired, wrong account/target/network/session/origin, duplicated, and reordered callbacks. Only an exact pending attempt plus authoritative registration activates the wallet. |
| M6 | Lost device and unresolved rotation | Drill device loss, biometric invalidation, emergency external revoke, ordinary rotation, and rotation during an unresolved action. Signing stops immediately; public reconciliation continues; the old key is never reused. |
| M7 | OTA and fixed-origin release proof | Either verify signed EAS Updates end to end or keep updates disabled. Inspect generated iOS/Android config and runtime `Updates.isEnabled`; remote update, redirect, alternate host, non-TLS, and TLS-failure probes all fail closed. |
| M8 | Dependency and native-change control | Attach lockfile/provenance report, vulnerability disposition, Reown diff, native config-plugin diff, origin diff, update policy, and named credential owners. Resolve or explicitly approve every export warning. |

### Notification privacy and service security — privacy/service-security reviewer

| ID | Closure work | Required evidence and acceptance |
|---|---|---|
| N1 | Enforce public-only dependency boundary | Static import graph and runtime egress test show the notification service reaches only the public Hyperliquid entry point and has no signer, private account, signed action, or `/exchange` capability. |
| N2 | Complete account-scope proof vectors | Exact-byte fixtures cover all four purposes and forged, replayed, expired, noncanonical, wrong-origin/installation/account/target/network/digest, over-broad selection, and transaction-race cases. |
| N3 | Prove atomic challenge consumption | PostgreSQL fault-injection tests show rollback does not consume a challenge, success consumes exactly once with link creation, and proof/signature bytes do not remain in rows, logs, metrics, or traces. |
| N4 | Prove credential authority and quotas | Stolen-bearer staging probe shows bearer-only access is limited to permitted price-rule and deletion/revoke operations. Account-rule mutation and account-alert token rebind require fresh operation-bound master proof; quotas fail closed. |
| N5 | Complete push-token cryptography | Exact ciphertext/AAD/key-version vectors, KEK separation, rotation, cross-provider rewrap, encrypted-backup restore, tag failure, and missing-key startup tests pass. Missing/suspect keys keep decrypt and provider workers off. |
| N6 | Complete revoke/outbox race drills | Inject provider timeout and revoke at every fence. Prove the ten-second deadline, thirty-second permit, durable provider-start marker, drain-before-commit, no post-commit call, and observable accepted/unknown in-flight delivery. |
| N7 | Complete deletion-ledger recovery | Every deletion has an independent append-only receipt. Restore from backup watermark through current head verifies sequence, MAC versions, replay, and hard worker/mutation stop on missing key, stale head, invalid MAC, or gap. |
| N8 | Inspect locked payload and retention | Physical locked-device payload capture contains no account/trading detail or executable input. Automated retention cleanup and tombstone replay remove eligible data without reviving revoked scope. |

### Recovery and incident operations — operations/recovery reviewer

| ID | Closure work | Required evidence and acceptance |
|---|---|---|
| R1 | Exercise API-wallet/account recovery | Run loss, expiry, biometric invalidation, external revoke, unconfirmed revoke, unlink, reinstall quarantine, and replacement. Each has a named stop state, safe read-only behavior, recovery procedure, and verification query. |
| R2 | Drill every external credential | For push provider, installation bearer, notification KEK/DEK, update signing, Reown, TLS, and database disclosure, record owner, disable boundary, rotation order, staged verification, rollback, and retirement. |
| R3 | Prove PostgreSQL restore and rollback | Independently run forward migration, rollback, encrypted backup restore, ledger/tombstone replay, key-version loading, and worker-gate checks. No mutation, monitor, or worker starts before continuity passes. |
| R4 | Prove diagnostics redaction | Generate support bundles and induced-error logs across mobile and service. Automated scanners and manual review find no real secret, signature, full signed payload, push token, proof, bearer, or unrestricted account data. |
| R5 | Stage replacement and final live run | After explicit operator confirmation and prerequisite approvals, replace a testnet agent and run the disposable-agent workflow. Verify revocation, tombstone, no duplicate, restricted evidence custody, and final zero-sensitive-log review. |

## Evidence record for each row

Each work item uses the same record shape:

```text
Check ID / evidence revision / commit / dirty-tree digest
Reviewer and operator
Build IDs, device or service revision, and environment
UTC start/end and exact command or procedure version
Preconditions and injected faults
Expected result / actual result / exit code
Redacted artifact paths and SHA-256 digests
Skipped cases and linked defects
Decision: PASS, PENDING EXTERNAL, BLOCKED, or NOT APPLICABLE
Reviewer signature and date
```

## Tracking and reporting cadence

- Update `docs/implementation/release-evidence.md` after each immutable evidence
  run; do not replace historical receipts.
- Update `docs/implementation/security-review.md` only when the accountable
  reviewer accepts the evidence. Implementers do not self-check approval rows.
- Report weekly counts as `P x/7, M x/8, N x/8, R x/5` plus blockers and the
  oldest unreviewed artifact.
- Stop and reopen affected rows after any approval-invalidating change.
