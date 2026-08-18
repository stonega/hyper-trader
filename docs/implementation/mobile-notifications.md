# Mobile notifications

The native iOS and Android notification flow is implemented in
`apps/mobile/src/features/notifications` and
`apps/mobile/src/platform/notifications`. It is text-only and does not target
Expo web. The mobile app uses the public notification service for durable rules
and delivery state; it never evaluates durable alert rules locally.

## Build configuration

Install dependencies through the SDK-compatible resolver:

```sh
cd apps/mobile
npx expo install expo-notifications expo-task-manager
```

Set `EXPO_PUBLIC_NOTIFICATION_SERVICE_ORIGIN` to the reviewed exact HTTPS
notification-service origin at build time. The client rejects HTTP, paths,
credentials, query strings, fragments, redirects, and runtime origin changes.
Do not put an installation bearer or provider credential in an Expo variable.

The EAS project must be linked so `Constants.easConfig.projectId` is present.
No project ID is fabricated or committed. APNs and FCM credentials belong in
the EAS credential service under the release owner. Missing service origin,
project ID, APNs, or FCM configuration keeps push registration unavailable and
is reported as unavailable in the UI.

`app.json` installs the `expo-notifications` plugin with the stable
`trading-alerts` Android channel and background remote-notification mode.
`apps/mobile/index.ts` loads the task definition before `expo-router/entry`, as
required by Expo TaskManager.

Relevant current Expo references:

- [Notifications SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/notifications/)
- [TaskManager SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/task-manager/)
- [Router native intent rewriting](https://docs.expo.dev/router/advanced/native-intent/)

## Permission and token lifecycle

The app does not prompt at launch or when Settings is merely opened. The first
price-alert submission creates the Android channel, reads current permission,
and requests permission only when the system still permits a prompt. Android
channel creation always precedes permission and Expo token acquisition. iOS
`authorized`, `provisional`, and `ephemeral` statuses are distinct usable states;
denial is never displayed as granted.

After usable permission, the client obtains an Expo token with the linked EAS
project ID, registers a random 128-bit installation ID and random 256-bit bearer,
and stores only the bearer in a dedicated device-only SecureStore service. The
non-secret installation ID is stored separately in AsyncStorage. Full push
tokens, credentials, proofs, signed payloads, and account details are not stored
in local notification state, logs, diagnostics, or links.

The non-secret installation checkpoint and device-only bearer are made durable
before the first registration request. If the process stops before the service
answers, the checkpoint is retained; the next explicit alert attempt reads the
authenticated snapshot and retries the same installation identity only when the
service reports it absent. An uncertain response never causes the app to discard
the only authority capable of inspecting or revoking a possibly-created remote
installation.

Expo token acquisition can fail while offline. The UI reports failure and does
not claim registration. A native token-roll event reacquires the Expo token. A
price-only installation can rebind with its bearer; any active or draining
account link/account rule requires fresh exact master-wallet proof, so the app
reports that account alerts need attention instead of weakening authority.

## Alert rules and deletion

All supported families are represented:

- price above and price below use installation-bearer authority;
- fill, cancellation, rejection, margin risk, liquidation risk, funding above,
  and funding below require an exact verified account link plus fresh
  master-wallet proof for every mutation.

The current Reown connector release gate remains closed. Account-alert controls
are therefore visible but disabled and explicitly say proof is required. They do
not claim an account link or account rule changed. Price rules remain functional
without wallet authority and accept any exact canonical market ID supported by
the validated Hyperliquid catalog.

Deleting an individual price rule is bearer-authenticated and succeeds only when
the service proves the rule is price-scoped and belongs to that installation.
Account-rule deletion is not exposed without fresh proof. Device revoke preserves
local authority while the service reports `draining`; SecureStore and local
installation metadata are cleared only after the service verifies `inactive`.

## Notification entry and background limits

Visible push is alert-only. The provider payload is exactly `alertId`, category,
network, and route hint. It contains no address, position, balance, order detail,
signature, token, or signed exchange payload. A response or deep link persists
only the stable opaque 128-bit alert ID and routes to `/notification`.

The entry screen treats every payload and URL as untrusted. It authenticates an
opaque alert lookup, rejects a removed/revoked target, asks before changing the
network/account context, activates only an exact saved target, and then performs
an authoritative Hyperliquid market-catalog refresh. Account alerts additionally
refresh the current public global account snapshot. Only after that refresh does
the app mark the alert handled and offer the safe Trade or Portfolio route.
Duplicate IDs, declined context changes, delisted markets, and unavailable
accounts never mutate context or show cached alert state as current.
Concurrent opens of the same alert share a process-local claim, so only one can
fetch, confirm, refresh, and commit the durable handled marker. Failed or
declined work releases the claim for a later retry. Successful handled IDs remain
bounded in AsyncStorage across restarts.

The global background task only parses the minimal payload and stores one opaque
ID. It does not import signing, API-wallet custody, action orchestration, or
exchange submission code. Background and terminated delivery are OS-scheduled,
best-effort behavior: force-quit, Doze, notification throttling, connectivity,
and vendor policy can prevent execution. No background path signs, trades,
unlocks, changes account context, or claims that an alert was delivered.

## Phase, Back, motion, and accessibility

Notification settings use one phase model:

```text
overview -> request permission -> register token -> sync rule -> overview
overview -> revoke -> draining|inactive
```

Back is available from the overview/editor and consumed while the OS prompt,
token registration, rule commit, or revoke commit is in flight. Notification
entry uses `resolving -> confirm context -> refreshing -> ready|unavailable`;
Back is consumed during resolution and authoritative refresh. The confirmation
screen always offers an explicit Decline action.

Device revocation writes its opaque operation ID before the service request and
reuses that exact ID after interruption or a `draining` response. New alert
mutations remain blocked while revocation is unresolved. Local installation and
SecureStore authority are removed only after the same operation returns
authoritative `inactive`.

The routes use one card shell, text status, 48-point minimum actions, semantic
colors, live-region status messages, a 160 ms fade, and zero effective duration
under Reduce Motion. There is no progress-loop animation or image asset.

## Verification and remaining release evidence

The default test suite is deterministic and does not contact Hyperliquid, Expo,
APNs, FCM, or the notification service. It covers permission ordering and denial,
strict response allowlists, bearer storage separation, opaque payload parsing,
duplicate handling, target removal, context decline, authoritative refresh,
bounded local state, service authorization, and database transaction/race fences.
The mobile client also cancels oversized streaming responses once the 64 KiB
budget is crossed, and a transitive import test proves the global background task
cannot reach custody, signing, private refresh, or exchange-submission modules.

Before release, run the physical-device matrix on release builds for iOS and
Android: first prompt, denial, settings recovery, provisional/ephemeral iOS
status, token roll, offline acquisition/retry, foreground, background, terminated,
force-quit, duplicate tap, malformed link, removed target, context decline,
draining revoke, and APNs/FCM receipt behavior. Simulator, emulator, Expo Go, and
successful static export are not device-delivery evidence.
