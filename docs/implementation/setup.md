# Local setup

## Install

Use Bun from the repository root so workspace links resolve consistently:

```sh
bun install
```

The workspace contains `apps/*` and `packages/*`. The mobile app references
`@hyper-trader/hyperliquid` with `workspace:*`; it never resolves a registry
package with the same name.

## Run the mobile app

```sh
bun run mobile
```

Use an iOS Simulator or Android Emulator. HeroUI Native is not used for Expo web.
If native dependency resolution changes, clear Metro once:

```sh
bun --cwd apps/mobile start --clear
```

## HeroUI Native and Uniwind

The official HeroUI Native scaffold provides the required peer versions.

- `apps/mobile/src/global.css` imports Tailwind CSS, Uniwind, and HeroUI styles.
- `apps/mobile/metro.config.js` keeps `withUniwindConfig` as the outermost Metro
  wrapper.
- `apps/mobile/src/app/_layout.tsx` keeps `GestureHandlerRootView` outermost and
  installs `HeroUINativeProvider` directly below it.
- Imports use granular paths such as `heroui-native/card` consistently to retain
  bundle-size optimization.

When adding a HeroUI component, fetch its current Native documentation before
implementation and follow its compound anatomy.

## Hyperliquid client

The shared package exposes `createHyperliquidClient`. It accepts a network and an
optional `fetch` implementation for deterministic tests.

```ts
const client = createHyperliquidClient({ network: "testnet" });
const markets = await client.getAllMids();
```

Prices remain decimal strings in the package. Presentation code may format them,
but trading math must eventually use a decimal-safe representation rather than
binary floating point.

## Verification

```sh
./scripts/check.sh
```

The script runs Biome checks, all workspace type checks, and Bun tests.

## Security-sensitive development setup

Physical-device performance evidence follows
[`warm-resume-benchmark.md`](warm-resume-benchmark.md). The contract defines
release-build markers and reporting; it does not claim benchmark results.

The security contracts are
[`../design/api-wallet-custody.md`](../design/api-wallet-custody.md),
[`../design/action-lifecycle.md`](../design/action-lifecycle.md), and
[`../design/notification-service.md`](../design/notification-service.md). The
blocking sign-off is [`security-review.md`](security-review.md). U5-U7 live
integration stays disabled until that checklist approves one evidence revision.
Offline codec, repository, and UI work may proceed without real credentials.

The implemented offline API-wallet setup, native custody adapters, explicit
wallet runtime gate, phase/Back behavior, and five-minute signer-session boundary
are documented in
[`api-wallet-setup-and-session.md`](api-wallet-setup-and-session.md).

### Local data classes

- AsyncStorage: public market cache, install sentinel, and presentation/trading
  preferences scoped as the design requires.
- SQLite: non-secret setup checkpoints, context state, nonce scopes, action
  journals, reconciliation leases, and retired signer tombstones.
- SecureStore: one authenticated API-wallet secret per immutable binding, a
  non-secret custody manifest, and a separate notification installation bearer.
- Memory only: private-key reads, signing sessions, canonical action bytes,
  signatures, complete `/exchange` envelopes, account-link proof signatures, and
  decrypted push tokens/keys.

### Mobile data lifecycle dependencies

- `expo-network` supplies the initial native connection state and change
  listener that drive TanStack Query and the foreground stream runtime.
- `@react-native-async-storage/async-storage` stores only the explicitly
  allowlisted public query cache.
- `@tanstack/react-query-persist-client` and
  `@tanstack/query-async-storage-persister` provide the restore-before-refetch
  gate and lifecycle-scoped persistence subscription. Hyper Trader sanitizes on
  both write and restore, persists no mutations, and removes corrupt records.

Never put secrets in `.env`, Expo `extra`, EAS plain-text variables, fixtures,
logs, screenshots, or support bundles. Development uses synthetic keys committed
only as explicit public test vectors; live testnet uses a disposable dedicated
agent after operator confirmation.

### SecureStore and physical-device policy

The Expo config plugin must declare the Face ID usage text and Android backup
behavior. Android backup rules must exclude SecureStore data. iOS API-wallet
records use authenticated `WHEN_PASSCODE_SET_THIS_DEVICE_ONLY`; Android records
use authenticated Keystore-backed storage. A config-plugin or generated-native
diff affecting entitlements, Keychain/Keystore, backup, URL schemes, network
security, or updates requires mobile-security review.

Simulator/emulator unlock is development convenience, not evidence. Before the
signer gate opens, release builds on physical iOS and Android devices must cover
authentication, denial, lockout, enrollment change, background lock, reinstall,
and loss/recovery scenarios listed in the security review.

### Fixed networks

Application code imports network origins from compile-owned constants only:

```text
testnet HTTPS  https://api.hyperliquid-testnet.xyz
testnet WSS    wss://api.hyperliquid-testnet.xyz/ws
mainnet HTTPS  https://api.hyperliquid.xyz       (public reads only)
mainnet WSS    wss://api.hyperliquid.xyz/ws      (public reads only)
```

Do not add endpoint environment variables, remote overrides, proxy fallbacks, or
redirect following. Test fixtures inject transport functions, not release base
URLs. TLS/redirect/origin failure is terminal. Mainnet signer and exchange
capabilities are compiled false and checked before key access and transport.

### Wallet callback setup

Reown native and universal/app-link identifiers are reviewed release
configuration. Custom schemes and callbacks are parse-only input. A development
callback may resume a matching unexpired local attempt, but only authoritative
Hyperliquid registration can activate a signer. Never place an API private key,
installation bearer, or callback secret in a link.

### OTA policy

Choose exactly one release-channel mode:

1. Configure [EAS Update code signing](https://docs.expo.dev/eas-update/code-signing/),
   embed the reviewed certificate, keep the
   private signing key outside the repository/build artifacts, and verify the
   signature on-device; or
2. Set Expo configuration `updates.enabled` to `false` for the signing-capable
   runtime. Verify the generated iOS `Expo.plist` and Android manifest metadata,
   prohibit an update URL and manual update-fetch path, assert in a release build
   that `Updates.isEnabled === false`, and record a failed remote-update probe.

Unsigned fallback is prohibited. Update certificate rotation creates a new
runtime version and store build, retains old recovery material under the release
owner, and requires a signed staging update before promotion. Dependency,
lockfile, config-plugin, Reown, and update changes receive provenance and
generated-native-diff review.

### Notification service secrets and restore

The service receives its database, TLS, push-provider, and key-provider authority
from the deployment secret manager. The push-token KEK and separate tombstone-MAC
key remain outside PostgreSQL, the independent deletion ledger, backups, images,
source, and ordinary environment variables. Deployment adapters implement the
portable `PushTokenKeyProvider`, `TombstoneKeyProvider`, and
`DeletionLedgerPort` contracts; PostgreSQL stores only wrapped DEKs, encrypted
push tokens, and applied ledger receipts.

Restore order is strict: provision every reviewed key authority, restore
PostgreSQL, run forward migrations, retrieve the independently recovered ledger
through its current head, verify sequence continuity and versioned MACs from the
backup watermark, replay deletion tombstones, validate ciphertext and retention,
then enable mutations, monitors, and workers. Missing key authority, a ledger
gap, stale head, tombstone replay failure, or missing migration evidence keeps
the service disabled. Rotation and restore drills must not use production tokens
in development.

### Credential inventory

Before a release, record an owner, storage system, rotation procedure, last drill,
and emergency disable for EAS update signing, Reown project configuration,
notification TLS, Expo push-provider access, notification KEK/DEKs, and database
backup authority. API-wallet keys are user/device credentials and have no server
inventory or recovery copy.

## U1 documentation verification

U1 is non-behavioral documentation and deliberately adds no executable tests.
Run the terminology and local-link audits recorded in
[`security-review.md`](security-review.md), then review its trace matrix. Runtime,
device, protocol-vector, database, and incident tests are owned by the later
implementation units and cannot inherit this no-test exception.
