# Portfolio screen implementation

## Runtime status

Portfolio is a text-only native account surface for iOS and Android. It leads
with account value and range performance, then presents positions, open orders,
spot balances, fills, funding, and combined activity as filters over one exact
account owner. Native perpetual and builder-deployed perpetual rows preserve
their source DEX and canonical market identity. Spot order and balance identity
is not merged into a same-symbol perpetual.

The root action runtime remains intentionally unavailable while the security
review is conditional. Portfolio therefore renders current or safely cached
private state when an exact account adapter is available, but it never invents
signer or submission authority. Cancel, close, and margin controls fail closed
at confirmation while the injected root runtime is unavailable; immutable
review remains available. No screen-local signer, nonce, journal, exchange
client, or reconciliation state machine exists.

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

The current context contract exposes addresses but not the semantic type of a
different target. Portfolio can resolve a target as `master` only when master
and target addresses match. A different target remains unavailable until an
account adapter supplies the exact `subaccount` or `vault` discriminator;
Portfolio does not guess. The query function itself accepts any explicit
`AccountTarget`, so the account-management integration can provide those target
types without changing normalization.

For an exact target, the live account query requests clearinghouse state and
open orders for every validated perpetual DEX plus spot balances. A separate
history query requests fills, recent funding, and portfolio periods only after
live account data is available. Slow history therefore cannot delay current
positions, orders, balances, or action evidence. Partial endpoint failures
produce source-gap records. Aborted context work rejects rather than returning
an empty snapshot. Normalization runs at the query composition boundary, so
malformed source values fail before rendering. An uncached catalog failure is
also visible and retryable. Cached data remains on screen during a same-owner
refresh, offline, stale, or error state, while action review is disabled.

All independent endpoints inside each query start together. A normal pull
refresh reuses a healthy catalog and waits only for the live account query;
fills, funding, and performance refresh immediately afterward in the
background. An existing account or catalog fetch is reused instead of canceled
and restarted. Catalog recovery joins the gesture only when metadata is
missing, stale, or failed and no catalog refresh is already running. The pull
indicator represents that bounded manual work alone; background polling does
not hold it open.

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

## Quick actions and review ownership

Portfolio constructs only typed inputs already owned by the shared reviewed
action boundary:

- Cancel binds the current canonical asset and exact open `oid`, includes the
  current open-order evidence, and opens the shared confirmation review.
- Close starts as a full-size reduce-only market draft with editable 50 basis
  point maximum slippage. Its aggressive limit bound is computed from the
  current reference price with exact decimal arithmetic and current market
  precision. Full market close size is fixed to the current absolute position.
  A user may switch to a reduce-only GTC limit order and edit a partial size or
  limit price before review.
- Margin accepts a current-market-bounded leverage and applicable cross or
  isolated mode, then opens the same confirmation review.

Every review builder receives the current normalized Portfolio and explicit
`AccountTarget`. It verifies their owner against the captured context, resolves
the row by stable ID, and rejects absent, detached, changed, or expired rows.
The resolved snapshot row—not a caller-provided clone—supplies account and
market values. Close intent construction repeats the native-market authority
check at its final boundary.

Review captures the exact testnet context epoch, signer binding, market safety
fingerprint and reference price, account version, position or order identity,
and current values. Cryptographic `cloid` generation for closes uses the same
16-byte Expo Crypto boundary as Trade. One close preparation may be in flight.
Its operation fence binds the owner, snapshot version and observation time,
market fingerprint and price, every position field, and every draft field. A
context, price, metadata, account, target, or editor change rejects the late
result before review opens.

Builder-market closes remain unavailable until the documented live testnet
safety checks pass. TP/SL remains visible but unavailable because protective
orders are not yet supported by the shared action boundary. The screen does not
create an alternative trigger path.

## Action gates, phase, and Back behavior

Actions require testnet, an exact target and API-wallet binding, current market
metadata, current account evidence, and a valid credential state. Locked
sessions may reach review because confirmation owns the exact device-unlock and
refresh sequence. An unavailable root confirmation runtime leaves review usable
but omits confirmation and submission. Mainnet, stale, offline, refreshing,
invalidated, and unmatched states remain explicitly browse-only.

Portfolio stays one mounted vertical `ScrollView`; range and filter controls are
horizontal text chip rows. Close and margin editors expand inline rather than
creating a new signing phase. Android Back dismisses the keyboard first, then
closes the inline editor, then falls through to normal navigation. Root review
owns all subsequent Back consumption. HeroUI feedback and loading animation
honor the system Reduced Motion preference. Controls are at least 48 points and
status is always expressed in text rather than color alone. Action failures are
announced at account level, and unavailable rows show their own durable reason.
The shared account avatar sits at the top-right of the Portfolio heading, matching
Markets and Trade; pressing it opens the same account-selection dialog. The
former full-width account card is not duplicated in the content flow.

## Funding boundary

Portfolio discloses the exact destination, master account, and network for an
external funding handoff. It implements no deposit, withdrawal, internal
transfer, or bridge operation and does not claim that displaying an address
changes account authority.

## Verification boundary

Deterministic tests cover mixed native/HIP-3/spot normalization, ambiguity-aware
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
