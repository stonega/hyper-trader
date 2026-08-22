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
read both that venue's clearinghouse state and the market-specific
`activeAssetData`. Order Entry displays the applicable long or short
`availableToTrade` value as available margin; it never substitutes the
withdrawal-only `withdrawable` value. Spot reads the quote-token balance and
subtracts held funds. The adapter also carries the selected market's current
leverage and margin mode plus the selected position size, account version, and
observation time. It does not infer an unknown target kind, duplicate balance,
malformed value, response-account mismatch, response-market mismatch, or
missing leverage. The focused query establishes an authoritative REST baseline,
then account WebSocket events invalidate it for a coalesced reload. It also
refreshes on focus and participates in pull-to-refresh; continuous 20-second
polling is removed. The review boundary independently rejects an account
observation older than 30 seconds. Deterministic fixtures cover perpetual margin with and without an
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
| 1 minute | 90 minutes |
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

Historical candles use a separate `(network, canonical market, interval)`
infinite-query cache. The live REST/WebSocket head never shares its writable
array with historical pages, so reconnect baselines cannot erase history the
person has loaded. Dragging against the oldest loaded boundary or pressing
`Older` requests the preceding exclusive time window. Pages merge by exact open
time, the live head wins any overlap, and the resident series is bounded to six
history pages plus the live window. Once those six contiguous pages are loaded,
older loading stops instead of evicting the page adjacent to the live head and
creating a chart gap. The viewport stores timestamp bounds rather than
array-relative percentages, preventing prepended candles from moving the visible
time range. `Live` resumes following the newest head; `Reset` also restores the
automatic price range.

The stream runtime stops in the background or offline, sends a bounded heartbeat,
and uses jittered bounded reconnect backoff. A failed heartbeat, socket close, or
malformed selected-series message fences that connection. Every new connection
loads a fresh REST baseline while buffering incoming deltas, then applies those
deltas only if the connection generation is still current. Pull-to-refresh and
normal stale-query focus behavior remain available as independent reconciliation
paths; continuous 30-second candle polling is no longer required.

The same baseline-and-stream rule applies to the selected order book, recent
trades, and market context. REST seeds `l2Book` and `trades`; `activeAssetCtx`
starts from the validated catalog context. Their respective WebSocket channels
then update the exact canonical-market cache entry without interval polling.
Live market context is merged onto the selected catalog market, so price,
funding, volume, and open interest update without changing the immutable market
identity or safety metadata.

Candle and market-activity query observers are owned by memoized leaf
components. Candle changes redraw only the chart; book and trade changes redraw
only the activity card. The screen-level order authority observes market
context, but price-only context changes do not rerun draft reconciliation.

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
Within the plot, a vertical drag shifts the price window and a two-finger pinch
changes the visible time span and candle density. These interactions update the
authoritative chart domains, keeping the price axis and visible endpoint times
synchronized with the candle geometry. Gesture Handler callbacks remain on the
UI thread. They publish viewport work to React at a bounded 32-millisecond
interval and always publish the final gesture value, preventing raw device
gesture frequency from flooding the JavaScript thread.

A directional one-finger drag pans the loaded timestamp range horizontally. A
long press enters candle inspection and snaps to the nearest validated open
time. The visible inspection rail and screen-reader alternative expose exact
timestamp, open, high, low, close, volume, and trade count; previous and next
actions provide canvas-independent navigation. A compact volume plot uses its
own y-domain while sharing the price plot's x viewport and selection cursor.
Malformed volume suppresses only the volume plot and never invalidates otherwise
valid price geometry.

The chart accepts typed, presentation-only price overlays. The last price comes
from the newest validated live candle close; perpetual mark price comes from the
selected live market context. Perpetual entry and
liquidation prices come from the authoritative selected-position snapshot;
open-order prices come from an independently owned private query; a limit draft
appears only while its context binding matches the selected market. Every
overlay keeps the exact source decimal for visible and accessible text and uses
numeric conversion only for disposable Skia coordinates. Account, target,
network, or market changes replace the owning query key and remove obsolete
overlays. Overlay interaction is read-only: the chart adds no cancel, edit,
signing, or submission path and cannot bypass order review or confirmation.
The private order read uses Hyperliquid `frontendOpenOrders`, validates its
trigger fields, and plots TP/SL at the authoritative trigger price rather than
the accompanying execution limit.

## Layout composition

Trade follows a compact exchange-workspace order without copying another
product's visual styling: the title and concise pair switch share the header,
followed by a top-right account avatar, market identity and price, the
candlestick chart, the order-entry and activity workspace, then account and
session actions. The pair control uses a down chevron and opens the complete
market selector. Selector results use compact left-aligned rows with the pair,
maximum leverage, and HIP-3 provider when present; normal trading availability
is implicit, while exceptional availability remains visible and the active
market uses a quiet checkmark. The Trade summary follows the same rule by
omitting the normal `Trading` chip while retaining `Browse only`. Markets
discovery cards reuse the same token icon and hyphenated pair label, such as
`BTC-USDC`, so selection and discovery share one visible identity. Native
discovery and Trade summary cards omit the redundant `Native` venue line, while
spot, outcome, and HIP-3 provider labels remain visible. The Markets
search field uses `Search markets` as its placeholder and accessible label
without a duplicate label above it. A title-level mode button mirrors Trade's
compact market-selector styling and uses a trailing swap icon. `Strict` is the
default and shows active order-enabled markets; `All` adds active browse-only
markets without exposing delisted records. Token icons load from one fixed
public icon host for presentation only and fall back to deterministic initials;
icon success is never market identity or selection evidence. Pressing the avatar
opens the shared account dialog used by Markets; its concise rows show the
account name, short address, network, and generated avatar. The rounded-square
trigger reuses the persisted or sole directory row's generated artwork when no
context is active, but its accessible read-only label remains authoritative and the artwork
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
status is shown only for stale, offline, unavailable, or partial-source states.
It renders as a compact status row inside the market summary card so a healthy
feed does not displace the trading workspace and an exceptional feed does not
add another full card.

The backend catalog worker always requests native perpetual, spot, and testnet
outcome metadata first, then loads returned HIP-3 DEXes in rate-bounded pages
with a concurrency of eight. Mobile reads only a validated, generation-pinned
backend response and never opens catalog-enumeration requests itself. Its cached
catalog becomes stale after two minutes and reconciles every five minutes while
active. The Markets tab paints before catalog ranking, performs ranking and
search from deferred values, caches normalized search and sort projections per
immutable market record, and mounts rows in small `FlatList` batches. Live
query updates never schedule a catalog device-cache write. Stale presentation
is reserved for a missed refresh rather than the ordinary polling gap. Partial
failures render one counted, user-facing summary and one refresh action. Raw
source identifiers stay in the typed catalog result for diagnostics and never
expand into an unbounded screen list.

Compact chart, preset, and advanced-order selectors render as 40-point pills
with four points of vertical hit slop on each edge. The order card omits a
redundant title and keeps one 40-point settings icon at the right edge of the
order-type tabs with the same effective 48-point target. The trigger shows the
current leverage/TIF/slippage summary and opens a dialog containing
authoritative current leverage and applicable time-in-force, reduce-only, or
slippage controls. Settings apply immediately, so the dialog needs only its
standard close control. Leverage remains display-only because changing it
requires a separate reviewed action. Order type and market activity
use quiet underline tabs. Their visual weight stays subordinate to order review
and other primary actions.

## Draft and review ownership

A Trade draft binds to `(network, master account, target account)`, canonical
market ID, and the market-safety metadata fingerprint. Account, network, market,
or safety-metadata changes reset it with an explicit reason. Side, order type,
keyboard state, tab changes, and signer-session changes do not replace the
draft. A locked session may reach review because confirmation owns device
authentication. An expired credential keeps review disabled.

The form has no separate side selector. Its final execution rail stacks the
full-width Buy/Long and Sell/Short actions vertically and acts as the explicit
confirmation with that side already bound into the fenced draft. Spot uses Buy
and Sell labels without position terminology. The action starts the guarded
review pipeline, but cannot reserve, sign, or submit before authoritative review
and device authentication succeed.

Every visible order-book price is an accessible 48-point selection target.
Selecting one invalidates any pending review preparation, switches the current
draft to `limit`, and fills the exact decimal price. Review remains an explicit
separate action.

Applicable controls are intentionally narrow:

| Market/order | Visible controls |
|---|---|
| Native perpetual market | side, type, size, current leverage, size presets, slippage |
| Native perpetual limit | side, type, price, size, current leverage, presets, TIF, reduce-only |
| Spot market | side, type, size, presets, slippage |
| Spot limit | side, type, price, size, presets, TIF |
| HIP-3 | same family controls, evidence-specific review gate |
| Outcome/delisted/browse-only | no editable order controls |

Leverage is display-only. When the authoritative account snapshot first loads
or later changes, Order Entry synchronizes the draft's current leverage while
preserving side, type, size, price, TIF, reduce-only, and slippage input. The
final review boundary still rejects a leverage change that races review
preparation. Intentionally changing leverage or margin mode requires its
separately reviewed action. Hidden limit-order slippage is ignored. Decimal
size presets use `BigInt` arithmetic and fail visibly when the result falls
below size precision.

Perpetual trading capacity remains directional. `availableToTrade[0]` is bound
to Buy/Long and `availableToTrade[1]` to Sell/Short. Presets use the currently
bound draft side, review uses the side chosen by the final action, and the
pre-submission authoritative refresh fetches the same market-specific value
again. A withdrawal limit of zero therefore cannot be presented as zero trading
margin or block an otherwise valid testnet order.

Order preparation captures the current context epoch and creates a
cryptographic 16-byte `cloid` with `expo-crypto`. Its interruption token is bound
to canonical market, safety metadata, exact reference price, context/signer,
connectivity, confirmation-runtime capability, and every account snapshot field. A
price-only, metadata-only, account-only, market, account, or network change while
randomness is pending rejects the late completion. The pressed side-specific
order button becomes `Reviewing…` while the deep-frozen snapshot receives its
authoritative market/account refresh. No sheet opens during that review. A
successful review requests device authentication; only after authentication
does the root action sheet appear for reservation, signing, submission, and
authoritative status. Acceptance closes it automatically after a brief
accessible confirmation; all non-success outcomes remain visible until the user
dismisses them.

The side-specific order button is the explicit confirmation boundary and keeps
the visible order fields on screen while review runs. After device
authentication, the compact content-sized sheet shows the immutable ticket and
submission status without asking for a redundant second confirmation. Nonce
reservation, signing, and the write-once transport remain behind successful
authoritative review and authentication.

## Visible phases and Back behavior

| Visible state | Back behavior |
|---|---|
| Trade with keyboard | Dismiss the keyboard first and retain the draft. |
| Market switcher search keyboard | Dismiss the keyboard before closing the switcher. |
| Market switcher | Close to the unchanged Trade context. |
| Drafting | Normal tab/root navigation; the mounted draft is retained. |
| Review/submission/status sheet | The action runtime owns Back consumption, dismissal, automatic success close, and result behavior. |

Trade has one vertical `ScrollView`. The market switcher owns a separate modal
`FlatList`, preventing nested vertical scroll traps. All actions use at least
48-point targets, wrap under large text, expose selected/status text independent
of color, and disable staged motion under system Reduced Motion.

## Fail-closed review gates

Review reports a specific reason for invalid clock, mainnet, non-orderable
metadata, pending HIP-3 evidence, stale/offline/reconnecting metadata,
read-only/missing binding, expired agent, and stale account state. An unavailable
confirmation runtime stops the inline review with a submission-unavailable
message and does not open a sheet. Presentation-only candle, book, or
recent-trade errors preserve cached rows and do not independently decide action
authority.

Accepted, rejected, expired, ambiguous, and reconciling presentation remains in
the root action sheet. Accepted closes automatically; other results remain
available for acknowledgement. No screen-local duplicate pipeline exists.
