# Security verification and live-integration gate

## Gate model

Hyper Trader uses automated verification and one accountable release owner. A
solo maintainer does not need separate protocol, mobile, privacy, or operations
reviewers. Public distribution is permitted when the exact release candidate:

1. is a one-line activation child of a clean `preactivation` commit;
2. passes `./scripts/check.sh`;
3. has a target-platform artifact whose SHA-256 digest matches the release
   manifest; and
4. is explicitly approved by the release owner after artifact smoke testing.

The executable contract is
[`mainnet-release-preflight.md`](mainnet-release-preflight.md). The strict
version-two manifest accepts one or more platform artifacts and contains no
independent-reviewer or real-funds-canary fields.

This governance simplification does not change trading behavior. Network,
market, price, size, leverage, margin, slippage, signer binding, nonce, journal,
and fixed-origin validation remain enforced at runtime. Every exchange action
still requires explicit user confirmation and device authentication.

## Non-custodial key boundary

The master-wallet seed phrase and private key never enter Hyper Trader. The
locally generated API-wallet private key stays on the user's device in
authenticated, device-only SecureStore storage. The app owns only the software
responsibility for protecting and using that local credential; it does not hold
user funds or operate a server-side wallet.

The device-side key lifecycle remains testable code:

- exact account, target, network, agent address, and generation binding;
- biometric/passcode-gated reads;
- five-minute non-sliding in-memory sessions;
- clearing on background, context change, manual lock, invalidation, or error;
- zeroing protected bytes after use;
- local deletion, rotation, and externally verifiable API-wallet revocation;
- no private key, signature, or complete signed action in logs or journals.

## Mainnet source boundary

`MAINNET_TRADING_RELEASE_STAGE` is the only compile-owned release switch:

- `preactivation` denies Mainnet signer access and `/exchange` transport; and
- `candidate` enables the reviewed action runtime for Mainnet and Testnet.

No environment variable, backend response, remote configuration, OTA update,
deep link, notification, persisted state, or UI control can change this value.
The source consistency check verifies that the runtime, signer, and transport
capabilities cannot disagree.

## Automated verification coverage

`./scripts/check.sh` is the mandatory release gate. It runs:

- formatting and lint checks;
- strict TypeScript checks;
- deterministic unit and integration tests;
- React Native component tests;
- notification PostgreSQL tests;
- mobile end-to-end fixture contracts;
- Mainnet source-capability consistency; and
- tracked-file secret scanning.

The release preflight reruns this command instead of trusting an unverified
human checklist. A failing or skipped required command stops the release.

## Action integrity

- Action codecs use deterministic fixtures for agent authorization, market and
  limit orders, cancellation, reduce-only close, leverage, optional vault, and
  `expiresAfter`.
- Mainnet and Testnet use distinct typed-data domains and fixed origins.
- Nonce and secret-free journal reservation is atomic.
- `submission_started` grants one transport attempt; an uncertain response is
  never resubmitted automatically.
- Reconciliation classifies accepted, rejected, expired, or ambiguous outcomes
  from same-network authoritative evidence.
- Retired agent addresses remain tombstoned and cannot be reused locally.

## Device-side protection

- SecureStore access requires the configured local authentication policy.
- Signer sessions are exact-binding and expire without sliding renewal.
- Late authentication or SecureStore results are discarded after lifecycle or
  context changes.
- Android backup exclusion and iOS reinstall quarantine prevent silent key
  restoration into a new installation context.
- Fixed origins reject overrides, redirects, alternate ports, non-TLS schemes,
  and TLS failures.
- Signing-capable builds use the documented EAS Updates policy; an unsigned or
  incompatible update cannot enable Mainnet authority.

## Notification-service isolation

The notification service uses public Hyperliquid data only. It has no signer,
API-wallet key, signed action, private account endpoint, or `/exchange`
capability. Account-scoped mutations require exact operation-bound proof;
installation bearers alone cannot establish account ownership. Push tokens are
encrypted at rest, revocation prevents new dispatch permits, and deletion
tombstones survive restore.

Notification-service availability is not a prerequisite for trading. A service
outage or disabled credential must not grant or expand mobile signing authority.

## Failure and recovery behavior

Recovery is product behavior, not a separate approval role:

| Condition | Required behavior |
|---|---|
| Lost or compromised device | Revoke or replace the API wallet externally; a new installation must reauthorize. |
| Biometric enrollment change | SecureStore invalidation blocks signing until a new credential is authorized. |
| Rotation with unresolved action | Stop old signing while signer-free reconciliation continues. |
| Clock rollback | Block nonce reservation until a fresh bounded server-time sample is available. |
| Uncertain exchange response | Preserve the journal entry, reconcile authoritatively, and never issue an automatic duplicate. |
| Endpoint override or redirect | Reject before sending the request. |
| Source capability disabled | Block new signing and transport while allowing read-only reconciliation. |
| Notification credential failure | Disable the affected notification worker without affecting trading authority. |

An exchange order cannot be undone by an application rollback. “Recovery” here
means disabling new signing, deleting or revoking the API wallet, preserving
secret-free records, and reconciling any action that may already have reached
the exchange.

## Release record

For each submitted artifact, retain outside the repository:

- candidate commit and tree IDs;
- target platform and EAS build ID;
- artifact SHA-256 digest;
- `./scripts/check.sh` result and timestamp;
- device smoke-test result; and
- release-owner decision and store submission receipt.

These records may all belong to the same solo maintainer. They are evidence of
what code and artifact were released, not signatures from a required committee.
