# Action orchestration and reconciliation

## Runtime status

U7 provides one deterministic action pipeline for Trade and Portfolio. It
supports reviewed testnet market and limit orders, cancellation, full
reduce-only close, and leverage changes through the U6 nonce journal and signer
session boundaries.

The root `ActionRuntimeProvider` is intentionally created without a production
orchestrator while `security-review.md` remains conditional. The fixed-origin
exchange client and complete injected pipeline are tested offline, but the app
does not instantiate live `/exchange` transport or real signer access. Enabling
that wiring requires unconditional evidence for the same security revision.

## Confirmation sequence

Opening review validates and owns a deep-frozen snapshot. It does not read the
vault, unlock, reserve, sign, or call transport. Only **Confirm testnet action**
starts this sequence:

1. Deny mainnet locally.
2. Verify context and unlock the exact target-bound signer if needed.
3. Refresh authoritative market, account, order, and clock evidence.
4. Revalidate decimals, discriminators, precision, notional, leverage, margin,
   reduce-only, time-in-force, trigger, slippage, tradability, market metadata,
   account version, and current context.
5. Atomically reserve the U6 nonce and secret-free journal record.
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

Trigger input is validated but fails closed because U7 does not own a trigger
codec. Bulk cancel remains outside the public reviewed action surface. Outcome
markets remain browse-only. Missing constraints are never guessed.

## Visible phases and Back behavior

The text-only modal/result surfaces use an opaque `bg-background` root and one
mounted HeroUI Native card shell. Inner content fades for at most 160 ms;
system Reduced Motion disables staged animation. Actions are at least 48 points.

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
| Accepted, rejected, expired, or ambiguous | Dismiss to the underlying Trade or Portfolio context. |
| Failed before submission | Return to review; a prepared nonce is abandoned and never reused. |

States use explicit text and accessibility announcements rather than color.
Native screen-reader focus and announcement timing still require VoiceOver and
TalkBack release-build evidence.

## Action-specific reconciliation

Reconciliation claims the existing 30-second U6 lease, loads authoritative
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
