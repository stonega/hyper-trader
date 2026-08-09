# Trade screen implementation

## Runtime status

The native Trade screen provides one surface for every canonical catalog market. It
combines global account/network context, exact market identity and statistics,
a text chart with a visible OHLC alternative, order book or recent trades, and
progressive order drafting. Public market reads use canonical query keys and
abortable `/info` requests; default tests inject no network calls.

The root `ActionRuntimeProvider` still has no production orchestrator while the
security review is conditional. The current app runtime also has no
authoritative, target-kind-aware Trade account-snapshot adapter. Trade therefore
never invents available funds, leverage, margin mode, account version, or target
kind: those values remain unavailable and review fails closed. Deterministic
fixtures prove exact reviewed-action construction for native perpetual and spot
orders. This screen does not add a signer or submission path.

HIP-3 markets expose their applicable draft controls but remain review-gated
until each enabled order family passes the live testnet create-with-`cloid`,
query-by-`cloid`, timeout-reconciliation, and no-duplicate evidence required by
the action-lifecycle contract. Outcome, delisted, quarantined, and other
browse-only markets show public data and a compact reason card without editable
order controls.

## Draft and review ownership

A Trade draft binds to `(network, master account, target account)`, canonical
market ID, and the market-safety metadata fingerprint. Account, network, market,
or safety-metadata changes reset it with an explicit reason. Side, order type,
keyboard state, tab changes, and signer-session changes do not replace the
draft. Locked and expired sessions keep fields visible but review disabled.

Applicable controls are intentionally narrow:

| Market/order | Visible controls |
|---|---|
| Native perpetual market | side, type, size, current leverage, size presets, slippage |
| Native perpetual limit | side, type, price, size, current leverage, presets, TIF, reduce-only |
| Spot market | side, type, size, presets, slippage |
| Spot limit | side, type, price, size, presets, TIF |
| HIP-3 | same family controls, evidence-specific review gate |
| Outcome/delisted/browse-only | no editable order controls |

Leverage is display-only. An order review must exactly match authoritative
account leverage and margin mode; changing either requires its separately
reviewed action. Hidden limit-order slippage is ignored. Decimal size presets
use `BigInt` arithmetic and fail visibly when the result falls below size
precision.

Review preparation captures the current context epoch and creates a
cryptographic 16-byte `cloid` with `expo-crypto`. Its interruption token is bound
to canonical market, safety metadata, exact reference price, context/signer,
connectivity, action-runtime capability, and every account snapshot field. A
price-only, metadata-only, account-only, market, account, or network change while
randomness is pending rejects the late completion. Successful preparation hands
the deep-frozen snapshot to the root review overlay; opening review itself does
not unlock, sign, reserve, or submit.

## Visible phases and Back behavior

| Visible state | Back behavior |
|---|---|
| Trade with keyboard | Dismiss the keyboard first and retain the draft. |
| Market switcher search keyboard | Dismiss the keyboard before closing the switcher. |
| Market switcher | Close to the unchanged Trade context. |
| Drafting | Normal tab/root navigation; the mounted draft is retained. |
| Review/result overlay | The action runtime owns Back consumption, dismissal, and result behavior. |

Trade has one vertical `ScrollView`. The market switcher owns a separate modal
`FlatList`, preventing nested vertical scroll traps. All actions use at least
48-point targets, wrap under large text, expose selected/status text independent
of color, and disable staged motion under system Reduced Motion.

## Fail-closed review gates

Review reports a specific reason for invalid clock, mainnet, non-orderable
metadata, pending HIP-3 evidence, stale/offline/reconnecting metadata,
read-only/missing binding, locked or expired agent, stale account state, and an
unavailable action runtime. Presentation-only candle, book, or recent-trade
errors preserve cached rows and do not independently decide action authority.

Accepted, rejected, expired, ambiguous, and reconciling presentation remains in
the root result overlay. No screen-local duplicate pipeline exists.
