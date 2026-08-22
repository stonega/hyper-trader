# Action orchestration and reconciliation

## Runtime status

The action orchestration layer provides one deterministic pipeline for Trade and Portfolio. It
supports reviewed testnet market and limit orders, cancellation, full
reduce-only close, and leverage changes through the nonce journal and signer
session boundaries.

The root action runtime is intentionally created without a production
orchestrator while `security-review.md` remains conditional. Distributed and
release builds do not instantiate live `/exchange` transport or real signer
access. Immutable review remains available because it performs neither
operation; the confirmation control is omitted and the review says submission
is unavailable. The source-development testnet exception is documented below;
enabling confirmation in a release build requires unconditional evidence for
the same security revision.
The progressive Trade drafting and review handoff is documented in
[`trade-screen.md`](trade-screen.md).

## Confirmation sequence

Opening a Portfolio review validates and owns a deep-frozen snapshot. It does
not read the vault, unlock, reserve, sign, or call transport. Trade uses its
side-specific **Buy / Long** or **Sell / Short** control as the explicit order
confirmation: the control first shows `Reviewing…` without opening a sheet.
That explicit confirmation starts this sequence:

1. Deny mainnet locally.
2. Verify context, then refresh authoritative market, account, order, and clock
   evidence while Trade keeps progress on the pressed order button.
3. Revalidate decimals, discriminators, precision, notional, leverage, margin,
   reduce-only, time-in-force, trigger, slippage, tradability, market metadata,
   account version, and current context.
4. Request exact target-bound device authentication only after review succeeds.
5. After authentication, open the sending/status sheet and atomically reserve
   the nonce and secret-free journal record.
6. Build the codec-owned action and sign exact typed data in memory.
7. Persist `submission_started` and obtain the one-shot permit.
8. POST once to the compiled testnet `/exchange` origin with redirects rejected
   and no retry loop.
9. Persist accepted, rejected, expired, or unresolved. Uncertainty after the
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

Trigger input is validated but fails closed because the reviewed action codec does not own a trigger
codec. Bulk cancel remains outside the public reviewed action surface. Outcome
markets remain browse-only. Missing constraints are never guessed.

## Visible phases and Back behavior

One root-owned HeroUI Native bottom sheet remains mounted from immutable review
through authentication, one-shot submission, and reconciliation. Its compact
ticket layout sizes the sheet to its content and retains scroll behavior when
the content reaches the available height. The title, description, and
Review/Submit/Status progress rail reflect the current phase. Inner content
fades for at most 160 ms; system Reduced Motion disables staged animation.
Actions are at least 48 points.

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
| Rejected, expired, or ambiguous | Keep the result in the sheet until dismissed to the underlying Trade or Portfolio context. |
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
| Market or limit create | Exact 128-bit `cloid`; order status, open orders, fills | Exact order/fill proves accepted. Documented rejection proves rejected. Complete fresh absence after expiry proves expired. |
| Full reduce-only close | Exact `cloid`, plus current position | Exact order/fill proves accepted. A position effect without causal order/fill evidence is ambiguous. |
| Cancel | Asset plus exact `oid` or `cloid`, and prior target observation | Canceled/filled/terminal evidence proves accepted. Still-open fresh evidence after expiry proves expired. Unattributed absence is ambiguous. |
| Leverage | Asset, margin mode, target leverage, newer account state | Exact causal state proves accepted. Indistinguishable external change is ambiguous. |

The order-status parser recognizes only documented vocabulary. Unknown or
malformed strings remain unresolved. `unknownOid` alone never proves expiry;
post-expiry server time plus complete open-order/fill evidence is required.
Journal work may continue after context switch, but active cache writes occur
only for the exact active context.

## Source-development testnet runtime

`DevelopmentSignerSessionProvider` and `DevelopmentActionRuntimeProvider`
compose the existing custody and action ports only when `__DEV__` is true. The
runtime uses the same SecureStore vault created by API-wallet setup, tracks
native active/focus state, registers the exact authoritative setup binding in
the SQLite nonce scope, and supplies the signer-session manager to the existing
five-minute lifecycle controller.

Confirmation performs a fresh fixed-origin testnet catalog lookup and account
query before signer-session unlock. Response `Date` headers provide the bounded
server-time sample required by nonce allocation. The refreshed market
fingerprint, price, relevant account fields, context epoch, and exact intent
must still match the immutable review before device authentication is requested.
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

The development provider's native-activity listener cleanup interrupts pending
waiters but does not permanently dispose its ref-backed gate. Effect
re-subscription, including Fast Refresh, resynchronizes the gate from current
native activity before a later confirmation can attempt SecureStore access.

Distributed and release builds receive neither manager nor orchestrator, so
submission remains unavailable while the release gate is conditional. The
development runtime currently exposes market and limit orders only. An
uncertain response remains durably unresolved and cannot be submitted again;
the authoritative restart reconciler is tracked as P6 in the closure plan and
must be completed before response-loss drills are routine.

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

`HYPER_TRADER_TESTNET_ORDER_WORKFLOW=live` fails closed while the security gate
is conditional. A future disposable-agent run requires separate approval and
must retain no-duplicate evidence without printing credentials, signatures,
action bytes, or complete bodies.

## Verification boundary

Default tests use fake fetch, signer, refresh, journal, and evidence adapters.
They cover mainnet denial, one fixed-origin write, malformed signed requests,
mutable input, stale market/account context, durable-marker ambiguity, observer
failure, concurrent terminal updates, fill-before-response, cancellation, full
close, leverage, expiry, malformed evidence, lease takeover, and cross-context
cache fencing.

Not claimed here: physical iOS/Android Back and screen-reader behavior, real
biometric signer access, live exchange compatibility, HIP-3 `cloid` support,
or disposable-agent testnet evidence.
