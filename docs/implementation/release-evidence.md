# Native release evidence

This is the U13 release-review record for native iOS and Android. It separates
offline repository proof from simulator/device and external-system proof. A
passing static check is never recorded as a physical-device, wallet, push,
database-restore, or live-Hyperliquid result.

## Evidence states

- **PASS**: the named command was observed on the recorded revision.
- **PENDING EXTERNAL**: a release artifact, device, credential, or controlled
  service is required and no result is claimed.
- **BLOCKED BY SECURITY GATE**: exercising the path would violate the current
  conditional security approval.
- **NOT APPLICABLE**: requires a written reason and reviewer approval.

Record commit SHA, dirty-tree digest, Bun version, host OS, UTC start/end, exit
code, and artifact path for every automated run. Do not paste environment
variables, tokens, signatures, action bytes, signed payloads, account addresses,
or provider responses into this document.

## Automated release receipt

The canonical release operator must replace `pending` with an attached CI or
local receipt for the exact release commit. U13 development results do not
approve a later commit automatically.

| Gate | Exact command | Current release receipt |
|---|---|---|
| Frozen install | `bun install --frozen-lockfile` | pending |
| Format/lint | `bun run check` | pending |
| Strict types | `bun run typecheck` | pending |
| Offline Bun tests | `bun test` | pending |
| Native component tests | `bun run test:mobile` | pending |
| Expo dependency compatibility | `(cd apps/mobile && bunx expo install --check)` | pending |
| Expo project health | `(cd apps/mobile && bunx expo-doctor)` | pending |
| Notification integration | `bun run test:notifications` | pending; requires Docker or `NOTIFICATION_TEST_DATABASE_URL` |
| Maestro contract lint | `bun run test:e2e:mobile` | pending; static only |
| Secret boundary | `bun run check:secrets` | pending |
| Production aggregate | `./scripts/check.sh` | pending |
| iOS bundle export | `OUT=$(mktemp -d); (cd apps/mobile && bunx expo export --platform ios --output-dir "$OUT/ios")` | pending; record resolved output path |
| Android bundle export | `OUT=$(mktemp -d); (cd apps/mobile && bunx expo export --platform android --output-dir "$OUT/android")` | pending; record resolved output path |

`test:mobile` is Jest Expo plus React Native Testing Library. Its files use
`*.rn.tsx` under `src/__native_tests__/`; Bun does not discover that convention.
`test:e2e:mobile` validates fixture-flow structure only. A real device run is a
different command and receipt:

```sh
APP_ID=com.example.reviewed.fixture \
HT_E2E_DEVICE_ACK=1 \
HT_E2E_FIXTURE_BUILD=1 \
bun run test:e2e:mobile:device
```

The device command remains **PENDING EXTERNAL** until the fixture-only native
adapter/build described in `apps/mobile/e2e/README.md` is reviewed and installed.

## Offline safety probes

| Contract | Automated evidence | Acceptance |
|---|---|---|
| OTA disabled | `scripts/release-contract.test.ts` and `apps/mobile/app.json` | native-only platforms; `updates` is exactly `{ "enabled": false }`; generated native checks remain external |
| Compile-owned origins | `packages/hyperliquid/src/transport/http.test.ts` | exact HTTPS/WSS values are deeply frozen; requests use only the selected constant |
| Redirect rejection | info, exchange, notification-service, and Expo-push client tests | every fetch uses `redirect: "error"`; no alternate response location is accepted |
| Mainnet denial | signer boundary, exchange client, orchestrator, credential vault, nonce repository, and reconciler tests | rejection happens before SecureStore/key access, nonce mutation, signing, or transport |
| Target binding | signer, session, vault, setup, nonce, and action tests | network/master/target/agent/generation mismatch rejects before authority use |
| Unknown outcome | action orchestrator, journal, and reconciler tests | `submission_started` is write-once; unresolved work reconciles and cannot resubmit |
| Notification privacy | import-boundary, mobile-contract, payload, service, DB, and outbox tests | public-only dependency graph; opaque minimal payload; no provider call after committed revoke |
| Secret boundary | `bun run check:secrets` plus diagnostic/export tests | forbidden credential files and likely live material fail with paths/rule names only |

## AE1-AE21 trace

| Acceptance | Deterministic primary evidence | Additional release evidence |
|---|---|---|
| AE1 | context supervisor, draft registry, account switch fixture contract | Maestro device receipt pending |
| AE2 | catalog/discovery tests for native perp, HIP-3, spot and quarantined data | market-search Maestro receipt pending |
| AE3 | catalog state and trade-gate tests | device browse-only check pending |
| AE4 | direct read-only launch route and fixture contract | Maestro device receipt pending |
| AE5 | session manager, draft fingerprint, trade-model tests | physical auth/revalidation pending |
| AE6 | action journal, orchestrator, reconciler and recovery fixture contract | restart-on-device receipt pending |
| AE7 | portfolio model/review and close fixture contract | Maestro device receipt pending |
| AE8 | notification entry coordinator and context-entry fixture contract | release push-entry receipt pending |
| AE9 | notification store, local state and deletion transaction tests | staged service/device receipt pending |
| AE10 | setup repository/coordinator/callback and interruption fixture contract | external-wallet termination receipt pending |
| AE11 | account lifecycle, nonce tombstone, reconciliation and rotation fixture contract | staged replacement receipt pending |
| AE12 | lifecycle, metadata fingerprint and trade invalidation tests | background/resume device receipt pending |
| AE13 | notification payload/entry target rejection tests | malformed/removed-target device receipt pending |
| AE14 | action state/presentation plus native accessibility tests | VoiceOver/TalkBack receipt pending |
| AE15 | capability matrix, signer, exchange, journal and deep-link tests | release deep-link probe pending |
| AE16 | account lifecycle and notification unlink/revoke DB tests | external revocation-risk UI receipt pending |
| AE17 | callback parser, setup attempt and registration-authority tests | supported-wallet matrix pending |
| AE18 | context, signer binding, credential vault and nonce tests | target-switch device receipt pending |
| AE19 | account-proof contracts, server and PostgreSQL tests | staged stolen-bearer probe pending |
| AE20 | worker PostgreSQL, outbox and delivery-worker race tests | staging provider-drain drill pending |
| AE21 | lifecycle replacement, nonce tombstone and signer-denial tests | staged disposable-agent replacement pending |

## Physical performance and accessibility

Use the marker and sampling procedure in
[`warm-resume-benchmark.md`](warm-resume-benchmark.md). A complete platform row
requires at least ten valid warm samples and a maximum at or below 1,000 ms.

| Field | iOS | Android |
|---|---|---|
| Device / SoC / RAM / OS build | pending | pending |
| Release build / runtime / embedded or update bundle | pending | pending |
| Cache age / network / power / thermal state | pending | pending |
| Raw durations / p50 / p95 / maximum / anomalies | pending | pending |
| Trade hydration <=1 s | PENDING EXTERNAL | PENDING EXTERNAL |
| Tab and market switching trace | pending | pending |
| List/chart/keyboard/memory trace after repeated account changes | pending | pending |

Accessibility is **PENDING EXTERNAL** until the same release artifacts pass
VoiceOver/TalkBack, 200% text, reduced motion, increased contrast/high contrast,
logical focus order, 48-point targets, and non-color status checks. Record screen,
setting, assistive-technology version, expected label/order/announcement, actual
result, screenshot or redacted recording, and issue link. Streaming market data
must not create continuous announcements; review/result/reconciliation changes
must announce once and remain readable as text.

## External system gates

| Gate | Operator procedure | Required acceptance fields | State |
|---|---|---|---|
| iOS custody | release build; execute every iOS row in `security-review.md` | device/OS/build, passcode/Face ID state, reinstall result, signer/key-access result, log-redaction review | PENDING EXTERNAL |
| Android custody | release build; execute every Android row in `security-review.md` | device/OS/build, strong-biometric state, invalidation/backup/uninstall result, signer/key-access result | PENDING EXTERNAL |
| Reown return | exact reviewed project/redirect build; forged/replay/wrong-context then valid registration | wallet/version, attempt binding, callback result, authoritative registration query, no-secret log review | PENDING EXTERNAL |
| Expo Push entry | foreground/background/terminated/force-quit matrix from `mobile-notifications.md` | device/build, APNs/FCM environment, opaque payload inspection, context confirmation, authoritative refresh, receipt state | PENDING EXTERNAL |
| PostgreSQL recovery | follow restore sequence in `notification-operations.md` | backup ID, schema/checksum, ledger head/watermark, tombstone replay, KEK versions, worker-gate query, rollback result | PENDING EXTERNAL |
| Provider uncertainty/revoke race | staged synthetic token and injected timeout | permit/marker timestamps, provider calls before/after commit, outbox/receipt terminal state, no-token logs | PENDING EXTERNAL |
| Credential rotations | use inventory in `security-review.md` | owner, old/new version, disable time, staged probe, rollback, retirement evidence | PENDING EXTERNAL |
| Live testnet actions | requires explicit operator approval and unconditional security review | disposable agent, testnet account/target, market+limit+cancel+fill+position+close IDs in restricted evidence, zero-sensitive-log review | BLOCKED BY SECURITY GATE |

The guarded command below must continue to stop while the security gate is
conditional. Its nonzero exit is a safety result, not live evidence:

```sh
HYPER_TRADER_TESTNET_ORDER_WORKFLOW=live \
bun examples/testnet-order-workflow.ts
```

No mainnet action command exists. Mainnet submission is out of scope and must
remain impossible.

## U13 working-tree observations

These 2026-08-11 results are implementation evidence only, not a release-commit
attestation. Dependency installation and frozen-lock verification used the
repository-pinned Bun 1.3.14. The aggregate script also ran with Bun 1.3.14.
The release operator must still rerun every gate on the immutable release
commit.

| Command | Observed result |
|---|---|
| `bun install --frozen-lockfile` | PASS with Bun 1.3.14; 1,554 installs checked, no changes |
| `bun run check` | PASS; 317 files |
| `bun run typecheck` | PASS; all four workspaces and examples |
| `bun test` | PASS; 423 passed, 37 PostgreSQL tests skipped by the default offline suite, 0 failed |
| `bun run test:mobile` | PASS; 2 Jest Expo/RNTL suites, 3 tests |
| `(cd apps/mobile && bunx expo install --check)` | PASS; existing Expo production dependencies compatible |
| `(cd apps/mobile && bunx expo-doctor)` | PASS; 20/20 checks |
| `bun run test:notifications` | PASS; 3 migration + 18 foundation + 10 worker PostgreSQL tests |
| `bun run test:e2e:mobile` | PASS static contract; 9 flows; no device contacted |
| `bun run check:secrets` | PASS; 374 tracked/unignored files |
| `./scripts/check.sh` | PASS; formatting, types, 423 Bun tests, 3 native tests, 31 PostgreSQL tests, 9 fixture contracts, and secret scan |
| iOS Expo export | PASS to `/tmp/hyper-trader-final-ios.iKnz45` |
| Android Expo export | PASS to `/tmp/hyper-trader-final-android.MNiESu` |

Both exports emitted a Metro fallback warning because a dependency imports
`@noble/hashes/crypto.js` outside that package's declared exports. Bundles were
created, but dependency provenance/release review must resolve or explicitly
accept this warning; it is not silently promoted to a clean release receipt.

## Review decision

Release reviewers fill this only for one immutable release revision:

| Field | Value |
|---|---|
| Commit / tree digest | pending |
| iOS / Android build IDs | pending |
| Evidence bundle location and digest | pending |
| Automated gate reviewer / date | pending |
| Protocol/signing reviewer / date | pending |
| Mobile custody/release reviewer / date | pending |
| Notification privacy/operations reviewer / date | pending |
| Recovery/incident reviewer / date | pending |
| Residual risks and approved exceptions | pending |
| Decision (`approved` or `stop`) | stop until every required row is complete |
