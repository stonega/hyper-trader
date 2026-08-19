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

### App typography

The native app loads the regular, medium, semibold, and bold static weights of
Barlow Semi Condensed through `expo-font` and
`@expo-google-fonts/barlow-semi-condensed`. The root layout holds the native
splash screen until loading finishes, and `global.css` maps those four assets to
HeroUI and Uniwind font tokens. App-owned React Native text goes through
`AppText`, which supplies the regular token when a component does not request an
explicit weight; HeroUI controls consume the same tokens directly.

Static weights are intentional: React Native needs a separate font asset for
each supported weight, and the named assets keep the family mapping identical
on iOS and Android.

## Floating bottom navigation

The four Expo Router destinations use an app-owned custom tab renderer with a
58-point floating capsule and a safe-area-aware progressive blur. The layered
mask algorithm is adapted from
[beautiful-expo's progressive blur](https://github.com/davidmokos/beautiful-expo/tree/main/registry/default/progressive-blur)
under its MIT license; the retained notice is in
[`third-party-notices.md`](third-party-notices.md).

`expo-blur`, `expo-linear-gradient`, and
`@react-native-masked-view/masked-view` implement the effect with public Expo
APIs. iOS renders the layered native blur; Android uses the same masks plus the
theme-aware gradient and translucent capsule because React Navigation does not
expose its scene container as the sibling `BlurTargetView` required for reliable
Android backdrop sampling. Navigation still emits the standard `tabPress` and
`tabLongPress` events, preserves the existing route names and test identifiers,
hides with the keyboard, and exposes selected state to assistive technology.

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
bun install --frozen-lockfile
bun run check
bun run typecheck
bun test
bun run test:mobile
(cd apps/mobile && bunx expo install --check)
(cd apps/mobile && bunx expo-doctor)
bun run test:notifications
bun run test:e2e:mobile
bun run check:secrets
./scripts/check.sh
```

Native Jest files use `*.rn.tsx` under `apps/mobile/src/__native_tests__/`, a
convention Bun does not discover. `test:e2e:mobile` validates Maestro fixture
contracts without claiming device execution. The separate acknowledged device
command and all release evidence fields are documented in
[`release-evidence.md`](release-evidence.md).

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

- AsyncStorage: public market cache, install sentinel, public resumable setup
  presentation checkpoint, and presentation/trading preferences scoped as the
  design requires.
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
- `expo-clipboard` copies only the generated public agent address into
  Hyperliquid's manual setup flow. Private-key bytes are never exposed to its
  API.

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

The current native configuration chooses option 2. `app.json` is native-only
and contains exactly `updates: { enabled: false }`; it has no update URL.
Repository tests verify that source contract. Generated `Expo.plist`, Android
manifest metadata, `Updates.isEnabled`, and the failed remote-update probe still
require the exact release build and remain pending in the release evidence.

### Notification service secrets and restore

The service receives its database, TLS, push-provider, and key-provider authority
from the deployment secret manager. The push-token KEK and separate tombstone-MAC
key remain outside PostgreSQL, the independent deletion ledger, backups, images,
source, and ordinary environment variables. Deployment adapters implement the
portable `PushTokenKeyProvider`, `TombstoneKeyProvider`, and
`DeletionLedgerPort` contracts; PostgreSQL stores only wrapped DEKs, encrypted
push tokens, and applied ledger receipts.

The notification process terminates TLS directly. Its deployment adapter must
load the certificate and private-key material from the reviewed secret mount or
secret-manager integration and inject a `direct-tls` server boundary into
`composeNotificationServiceRuntime`. The runtime passes that material to
`Bun.serve({ tls: { cert, key } })`; it does not put TLS material in
`NotificationServiceConfig`, source, an image, or ordinary environment
variables. Startup fails before binding when the boundary, certificate, or key
is missing or when a different listener topology is supplied. The request
handler continues to compare the request URL with the configured exact HTTPS
origin and does not derive that URL from `Forwarded` or `X-Forwarded-*` headers.

Restore order is strict: provision every reviewed key authority, restore
PostgreSQL, run forward migrations, retrieve the independently recovered ledger
through its current head, verify sequence continuity and versioned MACs from the
backup watermark, replay deletion tombstones, validate ciphertext and retention,
then enable mutations, monitors, and workers. Missing key authority, a ledger
gap, stale head, tombstone replay failure, or missing migration evidence keeps
the service disabled. Rotation and restore drills must not use production tokens
in development.

Notification monitor, outbox, Expo delivery, receipt, capacity, and incident
procedures are defined in
[`notification-operations.md`](notification-operations.md). Setting
`NOTIFICATION_ENABLE_PROVIDER_WORKERS=true` never bypasses its database and
dependency activation gates.

Native permission, Expo project configuration, device-token lifecycle,
background-task limits, safe alert entry, and the release-device matrix are
defined in [`mobile-notifications.md`](mobile-notifications.md). A release build
must provide `EXPO_PUBLIC_NOTIFICATION_SERVICE_ORIGIN` as one exact reviewed
HTTPS origin and be linked to its EAS project. Missing APNs/FCM credentials or an
EAS project ID keeps push registration unavailable.

Market discovery uses the same public backend origin. Prefer
`EXPO_PUBLIC_BACKEND_ORIGIN`; the notification-service variable remains a
transition alias. A missing or invalid origin makes catalog refresh unavailable
instead of falling back to per-device Hyperliquid enumeration. See
[`market-catalog-backend.md`](market-catalog-backend.md) for the Podman database,
migration, publication, and API contract.

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
