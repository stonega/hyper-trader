# Release evidence

This document records reproducible release evidence for the native app. The
current process is automation-first and supports a single accountable
maintainer. Historical multi-reviewer and real-funds-canary requirements were
removed when the executable manifest moved to schema version two.

## Decision model

Evidence has three states:

- **PASS**: the exact command or target-platform check completed successfully;
- **PENDING**: the release artifact has not yet completed that step; and
- **NOT APPLICABLE**: the feature or platform is not part of the submitted
  artifact.

The release owner may record every state. No separate human reviewer is
required. A public release still requires an immutable artifact, successful
automated checks, a target-device smoke test, and an explicit final decision.

## Automated aggregate

The release gate is:

```sh
./scripts/check.sh
```

It covers formatting/linting, strict types, deterministic Bun tests, React
Native tests, PostgreSQL integration, mobile fixture contracts, Mainnet source
consistency, and tracked-file secret scanning. The Mainnet preflight executes
the aggregate again for the exact candidate revision.

Skipped required tests or a non-zero command exit are failures. Tests that are
explicitly unavailable in the default offline suite must be exercised by the
aggregate's dedicated integration runner before release.

## Target-platform evidence

Only the platform being submitted is mandatory for that submission.

| Platform | Required artifact | Smoke-test scope |
|---|---|---|
| Android | Signed release AAB for Play submission; installable build from the same candidate when needed | Cold start, resume, navigation, Testnet selection, Mainnet selection, local API-wallet setup boundary, order confirmation boundary, no native fatal errors |
| iOS | Signed release IPA/App Store build | Cold start, resume, navigation, Testnet selection, Mainnet selection, local API-wallet setup boundary, order confirmation boundary, no native fatal errors |

An Android release does not wait for an iOS artifact, and an iOS release does
not wait for an Android artifact. If both platforms ship, each artifact is
listed separately in the manifest.

## Existing Android lifecycle evidence

The Android chart lifecycle fix was exercised on a physical Pixel 9 using the
EAS-signed candidate. Notification-shade transitions, background/resume,
Trade-to-Settings navigation, task removal, and cold restart produced no
`SurfaceTexture is not attached`, `createEvilTwin`, `FATAL EXCEPTION`, or
`AndroidRuntime` match. Mainnet selection and the local API-wallet setup screen
were also reached without generating or exposing a private key.

This evidence remains useful for regression history. A newly built public AAB
still receives the short target-artifact smoke test before submission.

## Non-custodial credential evidence

The master wallet remains external. Hyper Trader stores only the user's local
API-wallet credential in device-protected storage. Automated and device tests
cover:

- exact network/account/target/signer binding;
- biometric/passcode-gated access;
- lifecycle and timeout invalidation;
- no secret in journal rows, diagnostics, or logs;
- deletion and replacement behavior; and
- signer-free reconciliation after an uncertain submission.

These are product verification items, not evidence that Hyper Trader operates a
server-side wallet.

## Store-release record

Complete this table for each immutable submitted artifact:

| Field | Value |
|---|---|
| Evidence revision | pending |
| Candidate commit / tree | pending |
| Platform | pending |
| EAS build ID | pending |
| Artifact path / SHA-256 | pending |
| Automated aggregate receipt / UTC time | pending |
| Device smoke-test receipt / UTC time | pending |
| Release owner / decision / UTC time | pending |
| Store submission ID / track | pending |

Private keys, signatures, complete signed actions, account addresses, provider
responses, and unrestricted logs must not be stored in this document.
