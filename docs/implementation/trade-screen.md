# Trade screen implementation

## Runtime status

The native Trade screen provides one surface for every canonical catalog market. It
combines global account/network context, exact market identity and statistics,
a native candlestick chart with a visible exact OHLC alternative, order book or
recent trades, and progressive order drafting. Public market reads use canonical
query keys and abortable `/info` requests; default tests inject no network calls.

The root `ActionRuntimeProvider` still has no production orchestrator while the
security review is conditional. Trade permits immutable review in that state but
keeps confirmation and submission unavailable. Trade now loads a narrow, authoritative account
snapshot for the selected market and exact resolved account target. Perpetuals
read that venue's clearinghouse state and display its `withdrawable` value as
available margin; spot reads the quote-token balance and subtracts held funds.
The adapter also carries the selected position's current leverage, margin mode,
size, account version, and observation time when present. It does not infer an
unknown target kind, duplicate balance, malformed value, or missing leverage.
The focused query refreshes every 20 seconds, participates in pull-to-refresh,
and the review boundary independently rejects an account observation older than
30 seconds. Deterministic fixtures cover perpetual margin with and without an
open position, spot held funds, and ambiguous input. This screen does not add a
signer or submission path.

HIP-3 markets expose their applicable draft controls but remain review-gated
until each enabled order family passes the live testnet create-with-`cloid`,
query-by-`cloid`, timeout-reconciliation, and no-duplicate evidence required by
the action-lifecycle contract. Outcome, delisted, quarantined, and other
browse-only markets show public data and a compact reason card without editable
order controls.

## Candlestick chart and data boundary

Trade renders Hyperliquid `candleSnapshot` rows with Victory Native 41 and the
Expo SDK-compatible React Native Skia build. Victory Native was selected over a
WebView chart because it renders on the native Skia canvas, has a dedicated
candlestick primitive, and composes with the Gesture Handler and Reanimated
versions already required by the application. A general ECharts adapter remains
more appropriate for a web-option compatibility requirement, while the narrower
Wagmi chart package offers less value than Victory Native's current Cartesian
chart framework for future overlays and indicators.

The selected candle interval is presentation state and does not affect order
authority. The available views deliberately stay near 96 visible candles:

| Candle interval | Requested window |
|---|---|
| 15 minutes | 24 hours |
| 1 hour | 4 days |
| 4 hours | 16 days |
| 1 day | 3 months |

Each `(network, canonical market, interval)` has an independent TanStack Query
cache entry. REST `candleSnapshot` seeds that cache before any stream delta is
accepted. While Trade is focused and the app is foregrounded and online, the
shared stream runtime subscribes with `{ "type": "candle", "coin": "BTC",
"interval": "15m" }`. A matching update replaces its exact open-time row; a
new interval appends one row and evicts only the oldest row beyond the configured
window. Exact duplicate payloads are ignored.

The stream runtime stops in the background or offline, sends a bounded heartbeat,
and uses jittered bounded reconnect backoff. A failed heartbeat, socket close, or
malformed selected-series message fences that connection. Every new connection
loads a fresh REST baseline while buffering incoming deltas, then applies those
deltas only if the connection generation is still current. Pull-to-refresh and
normal stale-query focus behavior remain available as independent reconciliation
paths; continuous 30-second candle polling is no longer required.

The public package validates every REST and WebSocket candle interval, symbol,
timestamp, and decimal field against the requested series before mobile code
receives it. Hyperliquid candle messages do not expose a sequence number, so the
runtime uses the complete candle payload as its stable duplicate identity and
relies on heartbeat/reconnect baselines for discontinuity recovery.

Decimal strings remain exact through the public boundary and visible OHLC text.
Only the disposable Skia geometry converts validated prices to finite JavaScript
numbers. Invalid ordering, impossible OHLC geometry, non-finite conversion, or
missing rows produces the explicit unavailable alternative instead of an
invented path. Up/down labels supplement color, and assistive technology receives
the selected window, candle count, and exact open, high, low, and close values.
Victory's single price axis owns all four OHLC keys; this is required for it to
materialize the four point arrays consumed by the candlestick primitive. The
shared key tuple prevents the axis and renderer contracts from drifting apart.

## Layout composition

Trade follows a compact exchange-workspace order without copying another
product's visual styling: the title and concise pair switch share the header,
followed by a top-right account avatar, market identity and price, the
candlestick chart, the order-entry and activity workspace, then account and
session actions. The pair control uses a down chevron and opens the complete
market selector. Selector results use compact left-aligned rows with the pair,
maximum leverage, and HIP-3 provider when present; normal trading availability
is implicit, while exceptional availability remains visible and the active
market uses a quiet checkmark. Markets discovery cards reuse the same token icon
and hyphenated pair label, such as `BTC-USDC`, so selection and discovery share
one visible identity. Native discovery cards omit the redundant `Native` venue
line, while spot, outcome, and HIP-3 provider labels remain visible. The Markets
search field uses `Search markets` as its placeholder and accessible label
without a duplicate label above it. Token icons load from one fixed public icon
host for presentation only and fall back to deterministic initials; icon success
is never market identity or selection evidence. Pressing the avatar opens the
shared account dialog used by Markets; its concise rows show the account name,
short address, network, and generated avatar. The rounded-square trigger reuses
the persisted or sole directory row's generated artwork when no context is
active, but its accessible read-only label remains authoritative and the artwork
alone never implies trading authority. Standard phone widths place order entry
on the left and the order book/recent-trades card on the right. Screens
below 360 points or with a font scale above 1.25 stack those cards to retain
readable values and 48-point actions. The cutoff is isolated in a deterministic
layout helper.

The chart uses a shallow header, 210-point plotting area, and one exact OHLC rail
on Trade. Order-entry and activity cards reduce explanatory copy and row density
only in the split workspace; all review gates, required fields, accessibility
labels, and explicit confirmation behavior are unchanged. The two cards are
direct siblings in a stretched row, so Book/Trades always matches the current
Order Entry height; stacked layouts retain intrinsic card heights. Catalog
status is shown only for stale, offline, unavailable, or partial-source states
so a healthy feed does not displace the trading workspace.

The backend catalog worker always requests native perpetual, spot, and testnet
outcome metadata first, then loads returned HIP-3 DEXes in rate-bounded pages
with a concurrency of eight. Mobile reads only a validated, generation-pinned
backend response and never opens catalog-enumeration requests itself. Its cached
catalog remains fresh across the normal one-minute refresh interval; stale
presentation is reserved for a missed refresh rather than the ordinary polling
gap. Partial failures render one counted, user-facing summary and one refresh
action. Raw source identifiers stay in the typed catalog result for diagnostics
and never expand into an unbounded screen list.

Compact chart, preset, and advanced-order selectors render as 40-point pills
with four points of vertical hit slop on each edge. The order card omits a
redundant title and keeps one 40-point settings icon at the right edge of the
order-type tabs with the same effective 48-point target. It opens a dialog
containing authoritative current leverage and applicable time-in-force,
reduce-only, or slippage controls; leverage remains display-only because
changing it requires a separate reviewed action. Order type and market activity
use quiet underline tabs. Their visual weight stays subordinate to order review
and other primary actions.

## Draft and review ownership

A Trade draft binds to `(network, master account, target account)`, canonical
market ID, and the market-safety metadata fingerprint. Account, network, market,
or safety-metadata changes reset it with an explicit reason. Side, order type,
keyboard state, tab changes, and signer-session changes do not replace the
draft. A locked session may reach review because confirmation owns device
authentication. An expired credential keeps review disabled.

The form has no separate side selector. Its final stacked actions choose
Buy/Long or Sell/Short and open the explicit review with that side already bound
into the fenced draft. Spot uses Buy and Sell labels without position
terminology. Neither action signs or submits directly.

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
connectivity, confirmation-runtime capability, and every account snapshot field. A
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
read-only/missing binding, expired agent, and stale account state. An unavailable
confirmation runtime does not block immutable review; the review overlay omits
confirmation and explains that submission is unavailable. Presentation-only candle, book, or recent-trade
errors preserve cached rows and do not independently decide action authority.

Accepted, rejected, expired, ambiguous, and reconciling presentation remains in
the root result overlay. No screen-local duplicate pipeline exists.
