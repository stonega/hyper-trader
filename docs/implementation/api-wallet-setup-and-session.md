# API-wallet setup and signer session

## Runtime status

Hyper Trader now has deterministic API-wallet setup, custody, and signer-session
contracts for native iOS and Android. The external Reown wallet runtime remains
compile-disabled. The security checklist still has conditional runtime evidence,
and this repository has no reviewed Reown project identifier or redirect
allowlist. The app therefore renders a clear unavailable state and continues to
support read-only browsing; it does not create a connector session or send a
live `approveAgent` request.

No mainnet key generation, secret read, signing, or exchange action is enabled.
Mainnet is denied before authoritative setup queries, randomness, device
authentication, or SecureStore access.

## Setup ownership

The setup coordinator in `apps/mobile/src/features/accounts` owns this sequence:

1. Require testnet and normalize the connected master and selected target.
2. Query an injected authoritative adapter for current server time, target-role
   proof, named agents, and named-slot capacity.
3. Compute the stable 16-character logical registration name.
4. Retire an expired local attempt for the same target by deleting its staged
   secret before cancelling its durable checkpoint. An unexpired attempt must
   be resumed or explicitly cancelled; a second key is not created.
5. Generate a valid secp256k1 scalar from `expo-crypto.getRandomBytesAsync(32)`
   behind an injectable random-source boundary and derive the public agent
   address locally.
6. Stage the immutable target-bound secret in authenticated SecureStore.
7. Insert the non-secret, random 256-bit setup checkpoint into SQLite. If this
   insert fails, delete the staged record.
8. Build the exact codec-owned `approveAgent` typed data for a fixed 30-day
   requested expiry and send it only through the injected wallet adapter.
9. Treat every callback as parse-only input. Match the live connector session
   and ten-minute attempt before making an authoritative registration query.
10. Require the exact target relationship, logical name, agent address, and an
   expiry no later than requested. A shorter expiry requires explicit user
   confirmation and a fresh verification.
11. Consume the attempt and activate the public binding in one SQLite
    transaction. A replay loses the conditional update and is inert.

The SQLite adapter isolates registration generations by network, master, and
target. Replacing an active generation marks the prior binding retiring in the
same activation transaction. Rotation still uses the nonce-journal retirement
tombstone and pending-action rules before deleting an old secret.

## Visible phases and Back behavior

Navigation readiness and visible phase are separate state. Every asynchronous
completion includes the captured generation, so a completion after interruption
cannot reopen a later phase.

| Phase | Back behavior |
|---|---|
| Connect | Exit setup; read-only state remains usable. |
| Target | Return to Connect without changing the selected master. |
| Slot | Return to Target without dropping prior authoritative input. |
| Review | Return to Slot; a staged attempt remains scoped and resumable. |
| External handoff | Consume Back after handoff begins. Safe cancellation happens before handoff or through the external-wallet result. |
| Verifying | Consume Back while authoritative proof is checked. |
| Atomic activation | Consume Back until the local transaction finishes. |
| Recoverable failure | Keep one opaque mounted shell with Retry and Continue read-only. |
| Ready | Replace the route with Trade. |

The screen is text-only. It keeps an opaque `bg-background` root and one mounted
HeroUI Native card shell. Only its inner phase content fades. Motion is restrained
to 160 ms, and system Reduced Motion removes the staged transition.

## Credential records

The API-wallet secret uses the dedicated service
`hypertrader.api-wallet.v1` with `requireAuthentication: true` and
`WHEN_PASSCODE_SET_THIS_DEVICE_ONLY`. The non-secret manifest uses the separate
service `hypertrader.custody-manifest.v1`. Its records contain only the
installation epoch, one-way binding ID, public agent address, generation, and
record version.

Staging writes this non-secret manifest checkpoint before the authenticated
secret. A process interruption can therefore leave a visible record with a
missing protected item, which the recovery path quarantines; it cannot leave an
undiscoverable secret. A reported protected-write failure restores the prior
manifest. Cleanup deletes the protected item before cancelling its SQLite
checkpoint so a deletion failure remains retryable and never hides a key.

The Expo config plugins enable Android SecureStore backup exclusion and supply
Face ID usage text. `updates.enabled` is false because signed EAS Update
configuration has not been reviewed. No secret, raw signature, signing preimage,
or complete signed payload enters SQLite, AsyncStorage, logs, fixtures, links, or
analytics.

If the app-data install sentinel is absent while the non-migrating manifest has
records, every surviving record is quarantined. A missing item, authentication
denial, biometric enrollment invalidation, or malformed binding never falls back
to an unauthenticated read.

## Five-minute signer session

The signer-session manager is single-flight and owns only one exact normalized
binding. Unlock captures its session epoch, context epoch, and binding before
checking strong device-auth availability and reading SecureStore. It publishes
only when all three still match and the app is active and focused. Every late
secret is overwritten before disposal.

The session expires exactly five minutes after unlock. Signing does not extend
it. It is stopped on manual lock, app inactive/background, Android blur, context
or signer-generation change, timeout, memory warning, termination,
authentication or credential invalidation, and compromised-device policy. Every
sign call repeats testnet, binding, context, active/focused, and expiry checks
before and after the asynchronous signer result.

## Wallet dependency provenance and deferred wiring

- Expo SDK 57 resolved versions: `expo-secure-store 57.0.1`,
  `expo-local-authentication 57.0.2`, and `expo-crypto 57.0.1`.
- Reown resolved versions: `@reown/appkit-react-native 2.0.6` and
  `@reown/appkit-wagmi-react-native 2.0.6`.
- WalletConnect compatibility: `@walletconnect/react-native-compat 2.23.10`
  and `@walletconnect/utils 2.23.10`.
- Wagmi/Viem resolved versions: `wagmi 2.19.5`, `@wagmi/core 2.22.1`,
  and `viem 2.55.11`.

`+native-intent.tsx` accepts only the exact `hypertrader://wallet-return` shape
and redirects into a parse-only return screen. The release-gated wallet adapter
loads the React Native compatibility package before any wallet runtime import.
AppKit provider/modal creation, project metadata,
wallet discovery, and the Expo SDK 53+ Babel import-meta transform are
intentionally not wired while the runtime gate is false. Enabling them requires
one reviewed project ID, exact redirect allowlist, generated iOS/Android native
diff, dependency review, physical-device custody evidence, and an unconditional
revision of `security-review.md`.

## Verification boundary

Automated tests use fake wallet, authority, vault, authentication, clock, and
signer adapters plus a real local SQLite database. They cover mainnet denial,
wrong targets, forged and duplicate callbacks, expiry, shorter expiry review,
process restart, exact-binding mismatch, late unlock completion, non-sliding
timeout, target isolation, expired-attempt recovery, manifest-first staging and
rollback, manifest separation, and reinstall quarantine.

Simulator and static build checks are development evidence only. This document
does not claim Face ID, Android strong-biometric, reinstall, notification-drawer,
task-switching, or other physical-device release validation.
