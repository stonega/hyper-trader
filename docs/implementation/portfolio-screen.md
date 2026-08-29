# Portfolio screen implementation

## Runtime status

Portfolio is a text-only native account surface for iOS and Android. It leads
with account value and range performance, then presents positions, open orders,
spot balances, fills, funding, and combined activity as filters over one exact
account owner. Native perpetual and builder-deployed perpetual rows preserve
their source DEX and canonical market identity. Spot order and balance identity
is not merged into a same-symbol perpetual.

The root action runtime is available in the current `candidate` functional-test
stage. Portfolio renders current or safely cached private state when an exact
account adapter is available, and exposes cancel and full reduce-only close only
when the injected exact signer/runtime authority is current. It never invents
authority, and no screen-local signer, nonce, journal, exchange client, or
reconciliation state machine exists. Mainnet confirmation explicitly identifies
real-funds use before submission.

## Account ownership and data lifecycle

Every private query key includes network, master account, target kind, target
address, and the target's declared master address when applicable. A master,
subaccount, and vault therefore remain separate even if they share the same
address. The complete normalized account snapshot stays in TanStack Query
memory and is excluded from persisted public-cache dehydration. Changing a
query owner never uses the previous owner's data as placeholder content;
same-key refreshes retain their own safe cache naturally. A context switch
cancels old reads before selective private-cache eviction through the existing
context supervisor.

The Portfolio cache key includes exact owner and market safety metadata, but
excludes volatile mid and mark prices. Shared catalog price refreshes therefore
reuse the exact owner's cached Portfolio snapshot instead of replacing it with
a loading skeleton. Returning to the mounted tab shows cached rows immediately;
when the snapshot is stale, the focused query refreshes it in the background.
Lifecycle, order availability, precision, leverage, or isolation changes still
select a new cache entry and preserve the existing fail-closed action boundary.

App launch primes these same query keys after persisted active-account
restoration. The root loader first loads or joins the full network catalog, then
loads live Portfolio data followed by history. Opening Portfolio reuses a fresh
startup snapshot without another mount fetch; a snapshot that has crossed its
stale threshold still reconciles in the background. The one-shot loader owns no
WebSocket subscription or interval, stops before starting private work if the
active owner changes, and relies on query-key deduplication if Portfolio opens
while startup loading is still in flight.

The current context contract exposes addresses but not the semantic type of a
different target. Portfolio can resolve a target as `master` only when master
and target addresses match. A different target remains unavailable until an
account adapter supplies the exact `subaccount` or `vault` discriminator;
Portfolio does not guess. The query function itself accepts any explicit
`AccountTarget`, so the account-management integration can provide those target
types without changing normalization.

For an exact target, mobile requests one backend live aggregate containing
clearinghouse state and frontend open orders, including documented trigger
metadata, for the bounded set of validated perpetual
DEXes associated with the account's recent orders, fills, or funding, plus the
native DEX and spot balances. A separate backend history aggregate contains
fills, recent funding, and portfolio periods and loads only after live account
data is available. Slow history therefore cannot delay current
positions, orders, balances, or action evidence. Partial endpoint failures
produce source-gap records. Aborted context work rejects rather than returning
an empty snapshot. Live account normalization and history normalization run as
independent memoized stages at the query composition boundary. A live account
event therefore does not re-sort fills, funding, activity, or performance
history. Malformed source values still fail before rendering. An uncached
catalog failure is also visible and retryable. Cached data remains on screen
during a same-owner refresh, offline, stale, or error state. Review stays
available through a background refresh only while that displayed snapshot is
still current; stale and offline evidence remains browse-only.

Mainnet `spotClearinghouseState` can retain retired or outcome rows whose token
identity is omitted after every economic amount becomes exactly zero. The
backend omits only a missing-token row whose `total`, `hold`, and `entryNtl` are
all exact decimal zero. A missing token on any nonzero row remains malformed and
fails validation, so the adapter never invents an asset identity or hides a
balance.
Background-sync, stale, and offline status uses the same compact dot-and-label
treatment as Trade and is anchored in the Total account value card's top-right
corner without affecting card height. The row remains visible as `Up to date`,
`Updating`, or `Refresh needed`; assistive technology receives the complete
status and refresh guidance while the visible label remains concise.

The backend intersects the published DEX list with bounded global order, fill,
and funding activity before issuing DEX-scoped account reads. Reaching an
upstream history window or the 128-DEX response ceiling produces an explicit
source gap rather than an unbounded fan-out or silent claim of completeness.
The portable Bun runtime batches up to eight DEXes; the Cloudflare adapter uses
three DEXes so its two requests per DEX remain within the six-connection
platform limit, and caps one live request at 16 active DEXes with a source gap
when more are present. Both apply short bounded memory caches: five seconds for
live state and sixty seconds for history. Versioned envelopes are validated against
the requested network and lowercase public address. The mobile POST client
requires an exact HTTPS origin, `application/json`, `Cache-Control: no-store`,
a bounded body, no redirects, and a twelve-second deadline. The address never
appears in the route URL. Configured and release builds fail closed; only an
unconfigured development build may use the direct loader.

A normal pull
refresh reuses a healthy catalog and waits only for the live account query;
fills, funding, and performance refresh immediately afterward in the
background. An existing account or catalog fetch is reused instead of canceled
and restarted. Catalog recovery joins the gesture only when metadata is
missing, stale, or failed and no catalog refresh is already running. The pull
indicator represents that bounded manual work alone. Continuous Portfolio
polling is limited to a focused 15-second safety reconciliation, with a
30-second stale threshold so a healthy refresh completes before the UI warns.
Unfocused screens do not retain an active query observer or polling timer.
While focused, account WebSocket events invalidate the live aggregate sooner;
fill and funding events also invalidate history. Event bursts use a fixed
250-millisecond coalescing window and never cancel an equivalent refresh already
in flight. Event payloads are never copied into private query data. A healthy
account or catalog background refresh is presented as syncing; stale or offline
evidence retains the warning state.

## Performance and source gaps

Official `day`, `week`, `month`, and `allTime` periods map to 24h, 7d, 30d, and
All without synthesizing a missing period. Account-value and PnL decimals remain
strings. Chart ranking and headline percentage calculations use scaled
`BigInt`, so binary floating point does not decide financial values.

Each range carries its already validated performance summary and provides an
accessible text alternative with exact start, end, high, low, and gap count.
The chart does not reparse raw history during rendering. The visual chart is a
text sparkline and never hides the corresponding values from assistive
technology. Missing periods,
unmatched markets, unavailable endpoints, and cadence gaps are disclosed; the
screen does not interpolate account history.

Portfolio has no page-level loading skeleton. The account summary, performance,
and account-detail regions keep their final positions. Static titles, range and
filter controls, summary labels, and performance labels render immediately;
unresolved values use `-`, and the selected account-detail body remains empty
until rows arrive. Once the live account snapshot arrives, positions, orders,
and spot balances render immediately while summary and performance wait only for
history. Selecting fills, funding, or activity keeps only the row body empty
until that history arrives. Background refreshes retain all safe cached section
content.

Every Portfolio filter renders at most 24 rows initially. A deliberate
`Show more` action exposes one additional bounded batch, so a large fill or
activity response cannot synchronously mount an unbounded native card tree.
Changing account or filter restores the first bounded window.

Position, open-order, fill, funding, and combined-activity cards share one
record hierarchy: the validated market pair leads (for example `BTC-USDC`),
venue or local event time follows, and compact text chips identify record type
and direction. Exchange side codes are presentation details only; `B` and `A`
render as `Buy` and `Sell`. Numeric fields use explicit labels such as position
size, limit price, fee, payment, funding rate, and closed PnL instead of being
combined into an encoded summary line. Spot and HIP-3 pair labels resolve from
the validated market catalog, preserving their canonical market identity; spot
pairs use slash notation, such as `SWAP/USDC`, while perpetuals remain hyphenated.
Spot balances omit assets whose exact total amount is zero, including decimal-padded
zero values.

## Quick actions and review ownership

Portfolio constructs only typed inputs already owned by the shared reviewed
action boundary:

- Cancel binds the current canonical asset and exact open `oid`, includes the
  current open-order evidence, and starts progressive confirmation. The pressed
  Cancel control shows `Reviewing…` while authoritative review reloads the
  market's DEX-scoped open orders. Authentication and submission proceed only
  when exactly one current order still matches that asset and `oid`. An order
  that filled or disappeared during the handoff stops with refresh guidance.
  The sending/status sheet appears only after target-bound device
  authentication.
- Close starts as a full-size reduce-only market draft with editable 50 basis
  point maximum slippage. Its aggressive limit bound is computed from the
  current reference price with exact decimal arithmetic and current market
  precision, then rebased to the authoritative pre-authentication price with
  the same immutable slippage. A normal price tick therefore does not invalidate
  the close, while changed position size, side, market rules, or slippage still
  stops submission. Full market close size is fixed to the current absolute
  position.
  A user may switch to a reduce-only GTC limit order and edit a partial size or
  limit price before review. The price field's Mid action restores the current
  validated midpoint rounded to the market's price precision. Pressing Market
  or Close is the explicit confirmation boundary. It shows `Reviewing…` while
  authoritative review runs and requests exact target-bound device authentication
  only after review succeeds. The sending/status sheet appears only after
  authentication; no redundant review sheet opens first.
- Every open position shows its current take-profit and stop-loss trigger price.
  Each value has its own compact ghost pencil control with a 40-point visual
  target and additional hit slop; it is intentionally not presented as a
  primary action. The editor changes one protection order at a time. A missing
  trigger creates one full-size reduce-only market trigger with
  `positionTpsl` grouping, while an existing trigger modifies the exact
  reviewed `oid`. Long take profit must remain above the current reference and
  long stop loss below it; short positions reverse those directions. The
  execution limit is codec-owned and bounded to five percent from the trigger.
  **Set protection** or **Save change** is the explicit confirmation boundary.
- Position cards expose only Market and Limit close actions. Market retains the
  primary action treatment and starts a full-position close. Limit expands an
  inline reduce-only price and size form. Routine account snapshots and market
  price updates keep that form expanded and preserve the user's entered price
  and size. The form is cleared only when the user dismisses it, leaves the
  Positions filter, selects another account, submits the close for review, or
  the edited position is no longer open. Margin changes are not exposed from
  Portfolio.

Every review builder receives the current normalized Portfolio and explicit
`AccountTarget`. It verifies their owner against the captured context, resolves
the row by stable ID, and rejects absent, detached, changed, or expired rows.
The resolved snapshot row—not a caller-provided clone—supplies account and
market values. Close intent construction repeats the native-market authority
check at its final boundary.

Review captures the exact selected-network context epoch, signer binding, market safety
fingerprint and reference price, account version, position or order identity,
and current values. Cryptographic `cloid` generation for closes uses the same
16-byte Expo Crypto boundary as Trade. Only one Portfolio cancel or close
confirmation may be in flight. The close operation fence binds the owner,
snapshot version and observation time,
market fingerprint and price, every position field, and every draft field. A
context, price, metadata, account, target, or editor change rejects the late
result before review opens.

Builder-market closes and protection changes remain unavailable until the
documented live testnet safety checks pass. Native perpetual TP/SL create and
modify operations use the same reviewed signer, nonce, journal, transport, and
reconciliation boundary as close and cancel; the screen does not create an
alternative trigger path.

## Action gates, phase, and Back behavior

Actions require a capability-enabled network, an exact target and API-wallet binding, current market
metadata, current account evidence, and a valid credential state. A background
refresh does not revoke review access to an otherwise current snapshot; it is
shown as a quiet syncing state, and confirmation still owns the authoritative
account refresh and immutable-review comparison. Locked sessions may start
Cancel or Close confirmation because the progressive path owns the exact
device-unlock and refresh sequence. When the root confirmation runtime is
unavailable, both actions stop safely before authentication or submission.
Stale, offline, invalidated, and unmatched states remain explicitly
browse-only. Mainnet uses the same exact-account and current-evidence gates and
is actionable only while the compile-owned private-candidate capability permits
it.

Portfolio stays one mounted vertical `ScrollView`; range and filter controls are
horizontal text chip rows, and each filter's rows use the bounded incremental
window described above. The Limit close editor expands inline rather than
creating a new signing phase. Android Back dismisses the keyboard first, then
closes the inline editor, then falls through to normal navigation. The root
action runtime owns Back after an explicit review opens or a progressive Close
handoff authenticates and reveals the sheet. HeroUI feedback and loading
animation honor the system Reduced Motion preference. Controls are at least 48
points and status is always expressed in text rather than color alone. Action
failures are announced at account level, and unavailable rows show their own
durable reason.
The shared account avatar sits at the top-right of the Portfolio heading, matching
Markets and Trade; pressing it opens the same account-selection dialog. The
former full-width account card is not duplicated in the content flow.
If the selected network has no saved account, the network-aware setup card is
shown after the stable Portfolio regions. If a saved account exists but is not
currently selectable, Portfolio shows the account-selection recovery action
instead of incorrectly asking the user to create another API wallet.

## Funding boundary

Portfolio discloses the exact destination, master account, and network for an
external funding handoff. It implements no deposit, withdrawal, internal
transfer, or bridge operation and does not claim that displaying an address
changes account authority.

## Verification boundary

Deterministic tests cover mixed native/HIP-3/spot normalization, current TP/SL
selection and presentation, compact edit controls, create/modify trigger wire
parity, long/short direction and price-bound validation, ambiguity-aware
market identity, all target discriminators, query-key isolation, wrong-owner,
detached-row and stale-snapshot rejection, native close authority, exact
slippage bounds and precision, close operation fences, full and partial close
intent rules, cancel and leverage intents, shared immutable review reuse,
high-precision chart summaries, source gaps, malformed decimals, and
non-monotonic history. Default tests make no network calls.

Still requiring release-device evidence: Dynamic Type layout, VoiceOver and
TalkBack focus/announcements, Android keyboard/Back interaction, system Reduced
Motion behavior, poor-connectivity refresh, rapid account switching, and the
explicit live testnet gates for builder-market correlation and the complete
review/reconciliation runtime.
