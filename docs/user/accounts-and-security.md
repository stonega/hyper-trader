# Accounts, API wallets, and security

Hyper Trader treats every Hyperliquid master account, target, and network as a
separate trading identity. A target is explicitly one of:

- the master account itself;
- a subaccount owned by that master; or
- a vault associated with that master.

Settings shows the automatically selected API wallet as a read-only avatar.
Markets places the same read-only identity on the right side of its header.
Trade and Portfolio retain the account selector without repeating the same
account badge in the adjacent header.

## API-wallet access

Hyper Trader uses a dedicated named Hyperliquid API wallet for each enabled
network and target. The master wallet stays external and is used only for the
authorization handoff. The app must never ask for a seed phrase or master
private key. A testnet API wallet is never valid mainnet authority, or vice
versa.

The avatar is derived from the API wallet already bound to the active account.
It changes automatically with account context and is not a control for choosing
another API wallet. The gradient helps distinguish wallets without storing
another identifier, and secret key material is never shown.

These saved authorization fields are display-only, untrusted local metadata.
Restoring or selecting a saved entry always enters a read-only context and can
never restore signing authority, even when the record says `active` and
`protected`. Only the non-persisted secure setup and session runtime may inject
an exact signer after fresh authoritative verification and device
authentication.

Adding an account opens the authorization flow only when the selected network's
compile-owned signer capability is enabled. The current private `candidate`
build enables exact testnet and mainnet authorization; mainnet authorization
and actions use real funds.
Rotation,
repair, and unlink remain unavailable until an authoritative action journal and
all cleanup adapters are connected. External revoke or replacement guidance is
available through the official
[Hyperliquid API-wallet guidance](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/nonces-and-api-wallets).
The current native wallet handoff remains unavailable until the reviewed Reown
configuration and physical-device custody evidence are approved. The app stays
read-only instead of simulating authorization.

## Switching accounts safely

Select **Switch account** from Trade or Portfolio. Every choice identifies the
network, master, and exact target kind. The matching API wallet follows that
account automatically. Switching:

1. refuses to start while the shared action runtime is in a critical signing or
   submission phase;
2. cancels obsolete private reads and streams;
3. locks the previous in-memory signing session;
4. invalidates incompatible drafts and private caches; and
5. keeps durable pending actions attached to their original identity.

Switching does not treat the saved reconciliation summary as journal evidence.
Destructive lifecycle operations fail closed until an authoritative journal
adapter can supply current durable and terminal status.

No saved directory entry can supply a signer by itself. A missing, expired,
inactive, unprotected, or mismatched credential remains visibly recorded but
read-only. Use the external guidance while native repair and re-verification
remain unavailable.

## Rotation, revocation, repair, and unlink

All destructive account changes first lock the signing session. Ordinary
rotation and verified unlink also wait for pending actions to reach terminal
reconciliation.

Rotation, external revocation, and repair are not complete merely because a
wallet returns to the app. Hyper Trader requires authoritative account state to
prove that the old agent is inactive. Rotation and repair additionally require
proof that the exact replacement agent is active.

Cleanup follows this order:

1. tombstone the old authorization generation's nonce scope;
2. delete its device-protected credential; and
3. delete account-scoped notification or alert data.

If any step cannot be proved, the account remains visibly restricted. A local
unlink without verified external revocation requires an explicit risk
acknowledgement. It removes local access only; it does not claim the API wallet
was revoked on Hyperliquid, and the entry remains restricted until that status
is verified.

The account lifecycle reducer is a deterministic contract for those future
adapters; it is not wired to Settings and its tests are not integration evidence
for exchange mutation. Settings never starts or claims rotation, repair, or
unlink. Persisted reconciliation counts remain display-only and cannot authorize
any mutation. Completion stays unavailable until the authoritative journal,
nonce tombstone, protected-key deletion, and scoped alert-deletion adapters can
run together.

## Session and device security

The compact Settings card does not mix runtime session or authorization status
into the wallet identity. When a confirmed action needs a signature, the app
requests device authentication and unlocks the signer in memory for one exact
account binding. The session uses the fixed, non-sliding timeout defined by the
reviewed session manager. Backgrounding, context changes, and expiry lock it
again.

Device authentication never submits an action. Every order and account action still goes
through current-state refresh, boundary validation, and explicit review.

## Network safety

Fresh sessions default to Hyperliquid mainnet. The private functional-testing
candidate enables mainnet setup, signing, and submission with real funds; it is
not approved for public distribution. Every action still requires the exact
network-scoped account authorization, device authentication, and explicit review.
Selecting a network keeps its exact active account or restores its sole saved
account. If multiple accounts exist on that network, choose one explicitly from
the account switcher. Setup, Portfolio data, and action records remain isolated
by network, master account, and target.

## Scoped trading preferences

Default order type, market-order slippage, and the last Portfolio chart range are stored
in a versioned record scoped to the exact network, master, and target. A damaged,
unknown-version, or out-of-range record resets to safe defaults instead of being
used. Preferences never contain account credentials.

A preferred order type is used only when the current market supports it. If it
does not, Trade retains its safe built-in default. Preferences never suppress
review or market, precision, balance, leverage, margin, reduce-only, price, size,
fee, or slippage validation.

Appearance is device-global and does not alter trading identity or authority.
Portfolio remembers its range from the Portfolio screen. Notification controls
remain hidden until their service and device-delivery path are released.

## Redacted diagnostics

**Share redacted diagnostics** creates a bounded report using a structural
allowlist. It may include the app/build version, network, public address
suffixes, authorization generation and state, session state, secret-free
correlation IDs, intent digests, timestamps, and a shortened notification-token
suffix.

The report structurally excludes private keys, signatures, complete signed
actions, signed payloads, and full push tokens. Review the system share-sheet
destination before sending the report.

## If access looks wrong

1. Lock the trading session.
2. Confirm the active network, master, and exact target kind.
3. Confirm the API-wallet address and network in an independently trusted
   Hyperliquid interface.
4. Inspect the named API wallet through an independently trusted Hyperliquid or
   wallet interface.
5. Use repair or external replacement. Do not enter secret material into a
   support message or diagnostic report.
