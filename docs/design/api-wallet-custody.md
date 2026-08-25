# API-wallet custody contract

## Status and gate

This document is normative for any Hyper Trader build that can prepare a
state-changing Hyperliquid action. It resolves the custody portion of the U1
security gate. No code may unlock an API-wallet secret, sign an action, or call
`/exchange` until the checklist in
[`../implementation/security-review.md`](../implementation/security-review.md)
has the required sign-offs.

Hyperliquid calls these credentials API wallets or agent wallets. This document
uses **API wallet** for the credential and **agent address** for its public
address. A master seed phrase or master private key is never an input to Hyper
Trader.

## Immutable local target binding

One credential record belongs to exactly one binding:

```text
BindingV1 = (
  network,
  masterAccount,
  targetAccount,
  agentAddress,
  registrationName,
  registrationGeneration
)
```

- `network` is `testnet` for signing-capable builds covered by the current plan.
- `masterAccount`, `targetAccount`, and `agentAddress` are normalized,
  checksummed Ethereum addresses. The target is the master account itself or an
  authoritatively verified sub-account or vault relationship.
- `registrationName` is the locally persisted, app-supplied `Hyper Trader`
  label. It is not authorization evidence; the generated agent address is.
- `registrationGeneration` is a monotonically increasing local integer. A new
  private key always creates a new generation and address.

The binding is immutable after the secret is stored. Selecting a different
network, master, or target requires a different authorization and credential,
even when Hyperliquid would allow the same agent to act more broadly. The signer
repository, nonce coordinator, review snapshot, and transport each compare the
entire binding before use. A mismatch fails before secret access.

Private and durable state keys include the normalized binding identity. The
process-wide nonce scope is additionally keyed by `(network, agentAddress)`
because Hyperliquid tracks nonces per signer. An agent address is never reused
for another target or after retirement.

## Generation, name, expiry, and registration

### Generate and stage a fresh agent

1. On the device, use `expo-crypto` to generate 32 cryptographically random
   bytes. Reject zero and any value outside the secp256k1 private-scalar range;
   repeat until valid.
2. Derive the agent address locally. The private scalar never crosses the signer
   adapter boundary and is never rendered, copied, exported, or included in a
   wallet-connection request.
3. Write the secret to its final authenticated SecureStore record before opening
   the external wallet. Write only a non-secret, resumable setup attempt to
   SQLite. If either write fails, delete the partial record and stop.
   Credential creation presents exactly one system-authentication prompt. On
   Android, the authenticated SecureStore write owns that prompt; a separate
   LocalAuthentication prompt must not run first. On iOS, authenticate once
   before the initial Keychain insert because adding a new protected item does
   not itself prompt.
4. Confirm that the locally derived address and the action-codec fixture match
   the pinned official Hyperliquid Python SDK behavior. A mismatch is a protocol
   stop, not a recoverable UI error.

The setup attempt is a random 256-bit, single-use identifier bound to the
connector session, network, master, target, generated agent address, registration
name, requested expiry, creation time, and a 24-hour expiry. It contains no
private key, signature, signed payload, or wallet session secret. App termination
may leave this checkpoint and the authenticated SecureStore record so setup can
resume.

### Registration name and external slot policy

Hyper Trader uses a named API-wallet slot and never the unnamed slot. The
app supplies the stable `Hyper Trader` name so setup asks for only the public
master-wallet address. The name is stored as display metadata, but verification
never uses it as proof of authorization. The approval codec owns the official
protocol representation that attaches an expiry to the base name; that byte
representation remains frozen in compatibility vectors.

At the time of this contract, Hyperliquid documents one unnamed wallet and up to
three named wallets for an account, with two additional named agents for a
sub-account. The app does not preflight or enforce that external capacity. It
generates and stages the local credential first, then the official Hyperliquid
page owns any removal or replacement required before the user can add the new
address. Hyper Trader activates nothing until authoritative verification finds
that exact generated address with an acceptable finite expiry. These constraints
follow the
official [exchange endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint)
and [nonce and API-wallet guidance](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/nonces-and-api-wallets);
the pinned protocol fixtures remain the implementation authority.

### Expiry policy

Setup guidance recommends `30` in Hyperliquid's **Days valid** field. The web
flow computes the expiry when authorization is submitted, so the authoritative
expiry may differ from the timestamp recorded when the local setup attempt was
created. Renewal is not an extension of the old credential: it creates a new
private key and increments the generation. The review screen shows the absolute
expiry and remaining duration. Local state becomes
`expired` when either local time or authoritative registration state says the
credential is expired; signing stops immediately.

An absent, `null`, malformed, or expired authoritative expiry is a registration
failure. Verification accepts any safe finite future expiry reported for the
exact generated address and persists that authoritative value without comparing
it with the locally requested 30-day value. Clock rollback handling is defined in
[`action-lifecycle.md`](action-lifecycle.md); setup and renewal require a fresh
authoritative time sample.

### External approval and registration proof

Wallet callbacks, universal links, custom schemes, browser return parameters,
and connector events are untrusted parse-only input. They cannot create a
binding, switch context, or mark an agent registered.

Setup advances only when all of the following are true:

1. A live, unexpired, unconsumed local setup attempt matches the connector
   session, network, master, target, generated agent address, and local expiry
   bounds.
2. The connected wallet account is the intended master account and the current
   public Hyperliquid role data proves the intended target relationship.
3. The external wallet presents the exact `approveAgent` intent for human
   approval; cancellation or a wrong network/account leaves setup pending or
   failed without changing authority.
4. After return, an authoritative Hyperliquid query—not the callback—shows the
   exact generated agent address under the intended master and an acceptable
   finite expiry. The returned wallet name is not compared.
5. A local transaction consumes the attempt and activates the already-stored
   binding. A competing replay loses the single-use update and is inert.

If the app terminates during approval, it resumes from the non-secret checkpoint,
re-authenticates before reading the staged secret, and repeats authoritative
verification. An expired attempt cannot be revived; its staged secret is deleted
after recording a non-secret failed setup result.

## Device vault and signing session

### Record separation

The API-wallet secret and the notification installation credential are separate
SecureStore records with different service names and access policies. A fixed
non-secret custody manifest in non-migrating SecureStore contains only a random
installation epoch, binding IDs, public agent addresses, generations,
record-version identifiers, and the retirement-ledger watermark/root; it exists
so iOS surviving-Keychain reinstall and rolled-back SQLite state can be detected.
It contains no secret or account label.

General application storage may contain the install sentinel, the public binding
record, registration state, and setup checkpoint. It must not contain the API
private key, derived scalar, master secret, biometric material, signature,
canonical action bytes, or complete signed payload.

### iOS policy

- Store the API-wallet secret with `requireAuthentication: true` and
  `WHEN_PASSCODE_SET_THIS_DEVICE_ONLY` accessibility. The item must not migrate
  to another device or an ordinary backup restore.
- Use a dedicated Keychain service name. Reads are asynchronous and happen only
  after an explicit signing-session unlock request.
- A biometric enrollment change, passcode removal, authentication lockout, or
  inaccessible item invalidates the credential locally. Never fall back to an
  unauthenticated Keychain read.
- iOS Keychain items may survive uninstall/reinstall for the same bundle ID. If
  the application-data install sentinel is missing but the custody manifest or
  secret record survives, quarantine every record. Require device
  authentication, explicit account selection, and authoritative registration
  verification before rebuilding non-secret local state. Delete records the user
  does not re-adopt. Never restore the previous session or account selection.

### Android policy

- Store the secret with `requireAuthentication: true` in the Keystore-backed
  SecureStore implementation.
- Exclude SecureStore encrypted shared preferences from Android Auto Backup. The
  config plugin and any custom backup rules must agree; a configuration conflict
  fails release review.
- Uninstall is treated as credential loss. Restored encrypted values without the
  original Keystore key are not recovery material and must be discarded.
- A biometric enrollment change, authentication lockout, invalidated Keystore
  key, or key-access error marks the credential unusable and requires a fresh
  agent.

Expo documents the relevant platform differences in
[SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/). Both
platforms require release-build tests on physical devices; simulator behavior is
not custody evidence.

### Device authentication and memory

`expo-local-authentication` first checks that device authentication is available
and sufficiently strong. It does not itself release a secret. A successful
SecureStore read unlocks one five-minute in-memory signing session for one exact
binding. The session holds the secret in the narrow signer adapter and exposes
only a sign operation, never raw key bytes.

Unlock is single-flight and fenced by a monotonic session epoch. Before starting
an authenticated SecureStore read, capture the current epoch and exact binding.
Every stop below increments the epoch before clearing memory. When the native
read or authentication resolves, publish the session only if the epoch and
binding are unchanged and the app is both active and focused; otherwise discard
the returned secret immediately. A late result can never recreate a stopped
session.

The app-initiated SecureStore authentication sheet is the narrow lifecycle
exception needed for that authenticated read to complete. While the session is
still `unlocking`, a transient `inactive` event or Android `blur` from the native
sheet does not itself advance the session epoch. If the authenticated read
resolves just before React Native reports active focus, the manager permits a
bounded 1.5-second focus-settling window before constructing the signer. During
that window the protected material remains local to the unlock frame. A real
`background` event, context/epoch change, missing focus event, or timeout
immediately fails the wait and disposes the material. After the session reaches
`unlocked`, every `inactive`, `background`, or Android `blur` event locks it
immediately. This exception never applies to an existing in-memory signer.

Clear the session on the earliest of:

- five minutes after unlock, without sliding renewal;
- manual lock;
- app `background`, or an `inactive` transition outside the exact pending native
  authentication sheet described above;
- Android `blur`, including notification-drawer or system-overlay focus loss,
  outside that same pending authentication sheet;
- network, master, target, signer-generation, or context-epoch change;
- biometric/passcode enrollment invalidation or authentication error;
- app termination, memory warning, or compromised-device stop.

Each action still requires a review confirmation. If a session expires while a
draft or review is open, fresh market/account data and full draft revalidation
must succeed before device authentication is requested. Only an unchanged,
still-valid draft may proceed to signing.

## Loss, compromise, rotation, and unlink

### Lost key or lost device

There is no key export, escrow, mnemonic, backup, or secret-recovery UI. A lost,
expired, or invalidated credential requires a fresh key and external
reauthorization. For a lost device, the user must revoke or replace its stable
named agent through an independently trusted Hyperliquid or wallet path. Hyper
Trader cannot claim remote erasure of an offline device.

Until authoritative state proves the old agent inactive, the account is
restricted and read-only on every recovered installation. Notification
installations for the lost device are separately revoked and drained under
[`notification-service.md`](notification-service.md).

### Compromised device

Rooted or jailbroken operating systems are outside the custody guarantee. The
app must fail closed on an explicit platform-integrity failure, debugger/tamper
policy violation in a release build, or OS key-access failure. It must not claim
that heuristic compromise detection proves a device safe.

On suspected compromise, immediately clear memory, disable signing for the
binding, preserve only the secret-free action journal needed for reconciliation,
and direct the user to external emergency revocation. Do not delay emergency
revocation merely to preserve use of the old signer.

### Staged replacement

1. Lock the old binding and mark it `retiring`; no new nonce or signature may be
   issued.
2. Persist and reconcile all existing action records. Ordinary rotation waits
   while an outcome is unresolved. Emergency revocation may continue, but those
   records remain reconcile-only and never regain transport authority.
3. Generate a fresh key/address and request approval with the same stable base
   name. Never reuse the old private key or address.
4. Query authoritative registration state until it proves the new address active
   and the old address inactive. A callback or successful HTTP response is not
   sufficient.
5. In one local transaction, activate the new generation and retire the old
   signer scope. Write the retired tombstone before deleting the old SecureStore
   record and clearing all in-memory copies.

If step 4 is unavailable or contradictory, replacement is incomplete and the
account remains restricted/read-only. The UI must show the external registration
risk; it must not report success based on local deletion.

### Account unlink

Unlink first locks signing and starts notification drain. The normal path waits
for secret-free pending-action reconciliation, obtains acknowledged external
revocation or replacement, writes the retired signer tombstone, and deletes the
API secret, setup checkpoints, target-scoped preferences, caches, and local
notification credential/link state.

If external revocation cannot be confirmed, the user may choose emergency local
deletion after a final warning. The secret is then deleted, the non-secret
journal remains until reconciliation/retention completes, and the app records an
`external_revocation_unconfirmed` stop. Other account bindings remain untouched.

## Prohibited exposure

The following are forbidden in logs, analytics, crash reports, support bundles,
clipboard, screenshots, notifications, fixtures, source control, and backend
requests:

- master seed phrases and master private keys;
- API-wallet private keys or scalar-derived material;
- biometric/passcode data or SecureStore authentication results beyond a coarse
  success/failure code;
- raw signatures, canonical signing preimages, serialized signed actions, and
  complete `/exchange` request bodies;
- wallet session secrets and notification bearer credentials.

Redacted diagnostics may include a correlation ID, action type, network, public
address suffixes, registration generation, intent digest, state transition,
protocol error class, and timestamps. Redaction happens before values enter a
logging API. Production logs never accept an arbitrary action or transport
object.
