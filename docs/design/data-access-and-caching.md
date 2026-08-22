# Data access and caching

## Goal

The app uses one explicit freshness policy for every class of server state:
continuous data arrives over a managed WebSocket, fan-out reads are aggregated
by the backend, and stable public presentation data may be restored from device
storage. Cached presentation state never becomes permission to sign or submit an
action.

## Ownership model

```text
published catalog ──────────────────────── backend → device cache
Portfolio fan-out ── Hyperliquid /info → backend → mobile memory
market snapshots ─── Hyperliquid /info ──────────→ mobile query cache
live deltas ───────── Hyperliquid WebSocket ─────→ mobile query cache
local preferences ───────────────────────────────→ device cache
signing authority ───────────────────────────────→ protected device storage
```

The backend owns expensive aggregation: enumerating perpetual DEXes and joining
their clearinghouse states and open orders, plus loading fills, funding, and
performance history. The mobile app owns focused live subscriptions and renders
their results. State-changing exchange requests and signing material never pass
through the backend.

## Policy matrix

| Data | Baseline | Live change signal | Storage | Freshness/reconciliation |
|---|---|---|---|---|
| Market catalog | Backend generation | None | Public device cache | stale after 2 minutes; reconcile every 5 minutes while active |
| Candles | Hyperliquid REST | `candle` | Memory only | 15-second stale threshold; no interval polling |
| Active market context | Published catalog | `activeAssetCtx` | Memory only | 15-second stale threshold; no interval polling |
| Order book | Hyperliquid REST | `l2Book` | Memory only | 5-second stale threshold; no interval polling |
| Recent trades | Hyperliquid REST | `trades` | Memory only | 5-second stale threshold; no interval polling |
| Trade account snapshot | Hyperliquid REST | account event invalidation | Memory only | 15-second stale threshold; refresh on focus/event/manual refresh |
| Portfolio live snapshot | Backend aggregate | account event invalidation | Memory only | 15-second stale threshold; refresh on focus/event/manual refresh |
| Portfolio history | Backend aggregate | fill/funding invalidation | Memory only | 5-minute stale threshold; refresh on focus/event/manual refresh |
| Preferences | Local | None | Public device cache | no remote reconciliation |
| Signing state | Protected local authority | None | Secure storage/session memory | revalidated at every action boundary |

The implementation table is `mobileDataPolicies`; query hooks consume it rather
than defining independent polling constants.

Only the stable market catalog participates in TanStack Query device
persistence. Cache writes subscribe only to catalog query changes. Candle,
market-context, order-book, and trade WebSocket updates remain in memory, so a
high-frequency stream cannot repeatedly serialize the complete catalog on the
JavaScript thread. Focused REST or catalog baselines restore those live views
after a cold start. The cache key is versioned; the former shared live-data cache
is discarded once during restoration without affecting preferences, account
records, or protected signing state.

Only a structurally valid catalog containing at least one validated market may
be restored or persisted. An empty result is an unavailable baseline, not an
empty market universe. The mobile client rejects it, keeps any compatible
non-empty development bootstrap visible, and exposes retry instead of allowing
the failed result to poison later launches. Catalog cache version 3 discards
older catalog entries once during restoration.

## WebSocket consistency

The process-wide stream runtime reference-counts equivalent declarations, so
multiple consumers share one subscription. Reusing a key for a different wire
subscription fails instead of silently merging incompatible data.
`userEvents` and `orderUpdates` payloads do not carry a safely demultiplexable
account identity, so one socket generation refuses to subscribe those channel
types for different users.

Every market stream loads a validated REST or catalog baseline before applying
buffered deltas. A new connection generation fences messages from an older
socket. Bounded heartbeat and reconnect handling restore a new baseline after a
gap. Market payloads are validated before entering TanStack Query.

Account messages are deliberately invalidation-only. Their untrusted payloads
never become Portfolio or trade-account cache data. Relevant events coalesce
inside a fixed 250-millisecond window, which reloads the fully parsed
authoritative snapshot without canceling an equivalent refresh already in
flight. The fixed window does not extend for every event, so a continuous
stream still reconciles while an event burst cannot create one HTTP request per
message.

## Backend Portfolio boundary

Mobile calls fixed HTTPS `POST` routes so the public account address is not put
in a URL:

- `/v1/portfolio-snapshots/live`
- `/v1/portfolio-snapshots/history`

Both accept the exact `{ network, user }` identity and return a versioned,
strictly validated, `no-store` envelope. The service limits request duration,
response size, concurrent aggregation, DEX fan-out concurrency, and in-memory
cache size. Live results are reused for 5 seconds and history for 60 seconds.
Partial upstream failures are represented as source gaps instead of fabricated
rows.

Configured and release builds fail closed when this backend is unavailable or
invalid. An unconfigured development build may use the existing direct loader
to keep local testnet UI work possible; that path is not release behavior.

## Action authority

Display freshness and action authority are separate. Persisted catalog data,
WebSocket deltas, account-event notifications, and backend Portfolio aggregates
may improve responsiveness, but none authorizes an order. Explicit review is
retained. Confirmation performs the action orchestrator's authoritative market
and account refresh, then rechecks the immutable review before nonce reservation,
signing, and submission.

## Failure behavior

- Render the last compatible cached public value while a baseline reconnects.
- Keep private snapshots isolated by network and exact account target and only
  in memory.
- Do not carry a previous owner's data into a newly selected owner.
- Surface stale, offline, partial, and unavailable states without clearing safe
  presentation data.
- Reject empty market-catalog generations at publication, transport, and device
  restoration boundaries.
- Fence malformed, oversized, wrong-market, wrong-account, or wrong-generation
  messages before cache mutation.
- Preserve pull-to-refresh as a bounded user-controlled reconciliation path.

## Protocol references

- [Hyperliquid WebSocket subscriptions](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions)
- [Hyperliquid WebSocket reconnect guidance](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket)
- [Hyperliquid rate and connection limits](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits)
