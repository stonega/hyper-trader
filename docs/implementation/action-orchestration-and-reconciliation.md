# Action orchestration and reconciliation

## Runtime status

The action orchestration layer provides one deterministic pipeline for Trade and
Portfolio. It supports reviewed market and limit orders, position-linked
take-profit and stop-loss creation or modification, cancellation, full
reduce-only close, and leverage changes through network-scoped nonce, journal,
signer-session, and transport boundaries.

The root uses the network-generic signer and action providers in every build,
but they instantiate protected signer access and `/exchange` transport only when
the compile-owned release-runtime gate and the exact network capability are both
true. Both values derive from the single compile-owned mainnet release stage;
the current functional-testing worktree is `candidate`, so mainnet signer
access, nonce reservation, confirmation, signing, and fixed-origin exchange
transport are available for every action family implemented by this pipeline.
Mainnet actions use real funds. Public distribution requires an immutable
target-platform artifact, the automated repository aggregate, target-device
smoke testing, and the single release-owner preflight.

The one-line private-candidate transition and exact artifact/evidence preflights
are documented in
[`mainnet-release-preflight.md`](mainnet-release-preflight.md).

The secret-free journal repository and restart reconciler initialize regardless
of those gates. Disabling release signing or a network capability therefore
stops new review, reservation, key access, and transport without abandoning
same-network recovery for an already-started journal record.

The progressive Trade drafting and review handoff is documented in
[`trade-screen.md`](trade-screen.md).

## Confirmation sequence

Trade uses its side-specific **Buy / Long** or **Sell / Short** control as the
explicit order confirmation. Portfolio uses **Market**, **Close**, **Set
protection**, **Save change**, and **Cancel** as its explicit confirmations. The
pressed control first shows
`Reviewing…` without opening a sheet. That explicit confirmation starts this
sequence:

1. Verify the selected network's compile-owned signer and transport capabilities.
2. Verify context, then refresh authoritative same-network market, account,
   order, and clock
   evidence while the originating screen keeps progress on the pressed button.
3. Revalidate decimals, discriminators, precision, notional, leverage, margin,
   reduce-only, time-in-force, trigger, slippage, tradability, market metadata,
   account version, and current context.
4. Request exact target-bound device authentication only after review succeeds.
5. After authentication, open the sending/status sheet and atomically reserve
   the nonce and secret-free journal record.
6. Build the codec-owned action and sign exact typed data in memory.
7. Persist `submission_started` and obtain the one-shot permit.
8. POST once to the selected network's compiled `/exchange` origin with
   redirects rejected and no retry loop.
9. Persist accepted, rejected, expired, or unresolved. The exact documented
   minimum-notional rejection is mapped to the bounded user message
   `Order must have minimum value of $10.`; arbitrary provider error text is
   never retained or displayed. Uncertainty after the
   marker enters signer-free reconciliation and can never submit again.

Observer callbacks are isolated from correctness. If a journal update races
with reconciliation, the orchestrator rereads and reflects durable state.

## Validation and immutable review

Decimal calculations use scaled `BigInt` coefficients, never binary floating
point. The review captures canonical market identity, the full safety metadata
fingerprint, account-state version, context epoch and addresses, normalized
intent, signer binding, and displayed values.

Caller input is copied into a bounded structure and recursively frozen.
Mutation after `createActionReview` cannot alter display, refresh comparison,
reservation, codec input, or signature. Any market, metadata fingerprint,
account version, network, account, target, epoch, or normalized-intent change
stops before reservation and requires fresh review.

Available margin is a volatile validation input rather than an account-identity
field. Confirmation always uses the newly fetched value to recheck buying power,
but a harmless mark-to-market or funding fluctuation does not by itself stale an
otherwise unchanged review. Insufficient refreshed margin still stops before
reservation. Leverage, margin mode, position size, market metadata, signer, and
context remain exact review fences.

Position-linked market triggers validate exact direction against the current
reference price, require the full opposite-side position size in the reviewed
intent, bind an existing order ID for edits, and enforce a five-percent
execution limit from the trigger price. The codec owns both `positionTpsl`
creation and exact single-order `modify` wire shapes; both encode Hyperliquid's
zero-size sentinel so the trigger follows the whole position instead of freezing
the size observed during review. Bulk cancel remains outside the public reviewed
action surface. Outcome markets remain browse-only. Missing constraints are
never guessed.

## Visible phases and Back behavior

One root-owned HeroUI Native bottom sheet owns each visible action flow. An
explicit Portfolio review mounts it before authentication; progressive Trade
and Close confirmations keep it hidden through review and authentication, then
reveal it for one-shot submission and reconciliation. Its compact ticket layout
sizes the sheet to its content and retains scroll behavior when the content
reaches the available height. Explicit review retains its selected-network label, title,
and confirmation copy. After confirmation, the sheet removes the
redundant Review/Submit/Status rail and uses one compact HeroUI Native spinner
and status label while work is pending. The immutable ticket uses the readable
market pair (for example, `BTC-USDC`) and keeps only execution and risk details
that remain useful after submission; unavailable fee, negative reduce-only,
and account rows stay out of the status ticket. Terminal outcomes replace the
spinner with explicit result text. Inner content fades for at most 160 ms;
system Reduced Motion disables staged and spinner animation. Actions are at
least 48 points.

| Phase | Hardware/UI Back |
|---|---|
| Review | Dismiss without signing. |
| Unlocking | Consume Back. |
| Refreshing and revalidating | Consume Back. |
| Reserving nonce and journal | Consume Back. |
| Signing | Consume Back. |
| Persisting `submission_started` | Consume Back. |
| One-shot submission | Consume Back. |
| Reconciling | Dismiss; scoped signer-free work continues. |
| Accepted | Announce acceptance, then close the sheet automatically. |
| Rejected | Show the bounded reason when available and provide **Edit order**. Dismissing or starting a fresh review clears only the terminal presentation state; the rejected journal record remains immutable. |
| Expired or ambiguous | Keep the result in the sheet until dismissed to the underlying Trade or Portfolio context. |
| Failed before submission | Return to the order for a fresh review; a prepared nonce is abandoned and never reused. |

States use explicit text and accessibility announcements rather than color.
Native screen-reader focus and announcement timing still require VoiceOver and
TalkBack release-build evidence.

## Action-specific reconciliation

Reconciliation claims the existing 30-second lease, loads authoritative
evidence, renews before commit, and persists bounded backoff while unresolved.
A lost lease cannot update the record. The worker has no signer, signed body, or
transport permit.

| Action | Identity and evidence | Terminal behavior |
|---|---|---|
| Market or limit create | Exact 128-bit `cloid`; documented `orderStatus` lookup | Exact order proves accepted. Documented rejection proves rejected. Strict `unknownOid` after server-time expiry proves expired. |
| Full reduce-only close | Exact `cloid`, plus current position | Exact order/fill proves accepted. A position effect without causal order/fill evidence is ambiguous. |
| Position TP/SL create or edit | Exact new `cloid`; edits also require the reviewed existing `oid` before submission | Exact trigger order proves accepted. Documented rejection proves rejected. Strict authoritative absence after server-time expiry proves expired. |
| Cancel | Asset plus exact `oid` or `cloid`, and prior target observation | Canceled/filled/terminal evidence proves accepted. Still-open fresh evidence after expiry proves expired. Unattributed absence is ambiguous. |
| Leverage | Asset, margin mode, target leverage, newer account state | Exact causal state proves accepted. Indistinguishable external change is ambiguous. |

The order-status parser recognizes only documented vocabulary. Unknown or
malformed strings remain unresolved. A strict `unknownOid` response alone never
proves expiry before the action's server-time deadline; after that deadline it
is the authoritative absence result for the exact immutable `cloid`. The
documented open-order and fill shapes omit `cloid`, so they remain supplementary
and are never matched heuristically. Journal work may continue after context
switch, but active cache writes occur only for the exact active context.

## Network-generic runtime and source-development testnet policy

`TradingSignerSessionProvider` and `TradingActionRuntimeProvider` compose the
existing custody and action ports when source development is active or the
compile-owned release-runtime gate is true. The latter is currently false. The
runtime uses the same SecureStore vault created by API-wallet setup, tracks
native active/focus state, registers the exact authoritative setup binding in
the network-scoped SQLite nonce scope, and supplies the signer-session manager
to the existing five-minute lifecycle controller.

Confirmation performs a fresh fixed-origin, selected-network family-scoped
catalog lookup and account query before signer-session unlock. Perpetual reviews load only the
native perpetual catalog and spot reviews load only spot metadata, avoiding the
unrelated outcome-market payload. Response `Date` headers provide the bounded
server-time sample required by nonce allocation. The refreshed market
fingerprint, relevant account fields, context epoch, user-selected controls,
and all non-derived intent fields must still match the immutable review before
device authentication is requested. For market execution, the IOC limit is
derived again from that authoritative reference price, the immutable slippage
control, and current precision. No other refreshed price is accepted. The
post-authentication ticket receives this refreshed, deep-frozen review so its
displayed price limit is the one that is signed and submitted.
Trade keeps this phase inline on the pressed order button; only successful
authentication reveals the sending/status sheet. The exchange client then
consumes the write-once transport permit created by `submission_started`.

The authenticated SecureStore prompt may transiently move the native app to
`inactive` or Android `blur` while the signer is still unlocking. That exact
pre-session transition no longer cancels its own protected read; backgrounding
still cancels. The same bounded activity gate settles a transient focus handoff
before opening SecureStore, so a blur cannot suppress the biometric prompt, and
again when the read completes before the native active event. Each wait permits
up to 1.5 seconds for active focus before continuing. Failure, timeout,
background, or a stale context disposes the protected material.
Pre-submission presentation maps only allowlisted recovery
classes—authentication interrupted, credential invalidated, or context
changed—and never exposes native error text.

The signer provider's native-activity listener cleanup interrupts pending
waiters but does not permanently dispose its ref-backed gate. Effect
re-subscription, including Fast Refresh, resynchronizes the gate from current
native activity before a later confirmation can attempt SecureStore access.

Distributed and release builds receive neither manager nor orchestrator while
the compile-owned release-runtime gate is false, so submission remains
unavailable before source activation; secret-free restart recovery still runs.
The action runtime exposes
market orders, limit orders, full reduce-only closes, and exact `oid`
cancellation on a capability-enabled network. Cancellation refreshes the
reviewed market and its DEX-scoped open orders, then proceeds only when exactly
one current order matches the reviewed canonical asset and `oid`. An order that
filled or disappeared during confirmation stops before authentication with
refresh guidance instead of sending a stale cancel. An uncertain response
immediately enters signer-free
reconciliation through `orderStatus` using its exact `cloid`. Unresolved work,
attempt count, and bounded backoff are durable; startup recovers interrupted
submission markers and resumes eligible reconciliation without reconstructing a
signed action or transport permit.

The action sheet is mounted beside the root Expo Router stack inside the shared
action runtime. Opening a confirmed action therefore does not navigate or depend
on a second route chunk, and Trade and Portfolio use the same review,
confirmation, and result surface without duplicating the pipeline.

## Guarded example

The deterministic workflow requires an explicit offline switch and never uses a
credential or network transport:

```sh
HYPER_TRADER_TESTNET_ORDER_WORKFLOW=offline-fixture \
  bun examples/testnet-order-workflow.ts
```

`HYPER_TRADER_TESTNET_ORDER_WORKFLOW=live` is not part of the default automated
suite. Any live run must retain no-duplicate evidence without printing
credentials, signatures, action bytes, or complete bodies.

## Verification boundary

Default tests use fake fetch, signer, refresh, journal, and evidence adapters.
They cover mainnet pre-activation denial, network mismatch, one fixed-origin
write, malformed signed requests,
mutable input, stale market/account context, durable-marker ambiguity, observer
failure, concurrent terminal updates, fill-before-response, cancellation, full
close, leverage, expiry, malformed evidence, lease takeover, and cross-context
cache fencing.

Not claimed here: physical iOS/Android Back and screen-reader behavior, real
biometric signer access, live exchange compatibility, HIP-3 `cloid` support,
or disposable-agent testnet evidence.
