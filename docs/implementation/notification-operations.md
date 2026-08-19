# Notification monitoring and delivery operations

U14 activates the public-data monitor, exact-decimal rule evaluator, durable
outbox, and Expo delivery workers introduced behind the U11 storage boundary.
This is an operations contract: production adapters may change process layout,
but may not weaken the database fences, fixed origins, budgets, or retention
rules described here.

## `0004_workers` concurrent-index upgrade

Stop worker activation and leave API mutation admission closed before starting
the upgrade. The migration runner takes the notification advisory lock, closes
all database gates, applies the columns and receipt backfill transactionally,
and records version 4 as `applying`. It then builds the six indexes in separate
non-transactional `CREATE INDEX CONCURRENTLY` commands. It changes history to
`applied` only after catalog verification succeeds. Do not manually change the
history state or flip a gate.

After the runner returns successfully, this query must return one `workers` row
with `state = 'applied'` and both checksum checks true:

```sql
SELECT version, name, state,
       up_checksum ~ '^[0-9a-f]{64}$' AS up_checksum_valid,
       down_checksum ~ '^[0-9a-f]{64}$' AS down_checksum_valid
FROM notification_migration_history
WHERE version = 4;
```

This query must return exactly six rows. Every row must have the expected table,
`present = true`, `ready = true`, and `valid = true`; retain
`index_definition` with the release evidence:

```sql
WITH expected(index_name, table_name, ordinal) AS (
  VALUES
    ('notification_push_tokens_active_delivery_idx',
     'notification_push_tokens', 1),
    ('notification_outbox_bounded_dispatch_idx',
     'notification_outbox', 2),
    ('notification_dispatch_submission_deadline_idx',
     'notification_dispatch_permits', 3),
    ('notification_dispatch_active_expiry_idx',
     'notification_dispatch_permits', 4),
    ('notification_outbox_leased_expiry_idx',
     'notification_outbox', 5),
    ('notification_provider_tickets_due_receipt_idx',
     'notification_provider_tickets', 6)
)
SELECT expected.index_name,
       expected.table_name AS expected_table,
       table_class.relname AS actual_table,
       index_class.oid IS NOT NULL AS present,
       COALESCE(index_state.indisready, false) AS ready,
       COALESCE(index_state.indisvalid, false) AS valid,
       pg_get_indexdef(index_class.oid) AS index_definition
FROM expected
LEFT JOIN pg_namespace AS index_namespace
  ON index_namespace.nspname = current_schema()
LEFT JOIN pg_class AS index_class
  ON index_class.relnamespace = index_namespace.oid
 AND index_class.relname = expected.index_name
LEFT JOIN pg_index AS index_state
  ON index_state.indexrelid = index_class.oid
LEFT JOIN pg_class AS table_class
  ON table_class.oid = index_state.indrelid
ORDER BY expected.ordinal;
```

The gates must remain closed after the schema upgrade. This query must return
`blocked, false, false, false`; restore replay and the normal activation audit
are still required before traffic resumes:

```sql
SELECT restore_state, mutations_enabled, monitors_enabled, delivery_enabled
FROM notification_service_state
WHERE singleton;
```

If migration fails, keep every process disabled and inspect both phase state and
same-name catalog objects:

```sql
SELECT version, name, state
FROM notification_migration_history
WHERE version = 4;

SELECT namespace.nspname, relation.relname, relation.relkind,
       index_state.indisready, index_state.indisvalid,
       pg_get_indexdef(index_state.indexrelid) AS index_definition
FROM pg_class AS relation
JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
LEFT JOIN pg_index AS index_state ON index_state.indexrelid = relation.oid
WHERE namespace.nspname = current_schema()
  AND relation.relname IN (
    'notification_push_tokens_active_delivery_idx',
    'notification_outbox_bounded_dispatch_idx',
    'notification_dispatch_submission_deadline_idx',
    'notification_dispatch_active_expiry_idx',
    'notification_outbox_leased_expiry_idx',
    'notification_provider_tickets_due_receipt_idx'
  )
ORDER BY relation.relname;
```

An `applying` row is an incomplete migration, not an applied version. Resolve a
same-name non-index conflict only after confirming its ownership, then rerun the
same forward migration. The runner reuses valid expected indexes and safely
drops/rebuilds an invalid expected concurrent index. It refuses status, restore,
activation, and rollback while version 4 is `applying`; do not delete the row or
run the down file by hand.

Rollback is deliberately not an online inverse. First complete any `applying`
phase, keep all gates closed, stop API and worker processes, and then use the
migration runner to target version 3. The checked down migration drops indexes
inside its schema transaction and can wait for PostgreSQL locks; schedule a
maintenance window and inspect blockers before proceeding. A failed rollback
must be investigated and retried through the runner—never bypass the down-source
checksum or edit migration history.

## Activation gate

`NOTIFICATION_ENABLE_PROVIDER_WORKERS=true` is only a request to start workers.
It does not open either database gate. The supervisor must prove all of the
following before `activateWorkerGates()` atomically sets `monitors_enabled` and
`delivery_enabled`:

1. Migration history is contiguous, checksum-valid, and includes
   `0004_workers`.
2. The schema is `contracted`, restore state is `ready`, mutations are enabled,
   and the deletion-ledger head equals the restored watermark.
3. All push-token KEK versions needed by stored rows are available and every
   ciphertext authenticates with its row-bound AAD.
4. There are no draining revocations and every active rule still joins an
   active installation, active exact account link when applicable, and active
   Expo token.
5. Hyperliquid public connectivity, Expo credentials/access-token policy, TLS,
   the independent deletion ledger, and observability dependencies pass the
   deployment readiness probe.

Any failed check keeps both gates false. Shutdown first closes admission by
calling `deactivateWorkerGates()`, then closes streams and lets marked provider
attempts reach their ten-second database deadline. Never use the environment
flag, process liveness, or a health endpoint as a substitute for the PostgreSQL
gate.

Exactly one service instance owns notification egress. API-only instances may
scale independently, but monitor REST/WebSocket work and Expo work share the
PostgreSQL `runtime:egress` lease so process-local counters still enforce the
per-IP/per-project ceilings. The lease is 30 seconds with a monotonic generation.
Every baseline/open admission revalidates that generation; dispatch claim,
receipt claim, and the immediate pre-send authorization check bind the same
owner and generation. A takeover therefore fences stale work before new external
I/O. Expensive migration, restore, ciphertext, authorization, and readiness
checks run at startup/takeover or bounded degraded recovery—not every one-second
tick. Normal ticks cheaply renew ownership, reconcile, drain one bounded unit,
and never overlap.

## Hyperliquid monitor contract

The notification service imports Hyperliquid only through
`@hyper-trader/hyperliquid/public`. Authenticated actions, signing, nonces, API
wallets, and private account transports are not reachable from the service.
Every monitor target is an exact tuple:

- account: `network + lowercase 20-byte address`;
- market: `network + canonical market ID`.

One in-process registry shares listeners for the exact target. PostgreSQL owns
the cross-process lease: 30-second duration, renewal every 10 seconds, and a
monotonic generation on takeover. A stale owner cannot renew or release the new
owner's generation.

Startup, takeover, and every detected stream gap clear the in-memory baseline.
The owner obtains an authoritative `/info` snapshot before it accepts any delta.
Baseline data initializes crossing state and never emits an alert. A gap closes
the stream, rejects later deltas, and repeats the snapshot sequence. Hyperliquid
documents that time-series user subscriptions can themselves start with an
`isSnapshot` message; this is not a replacement for the service-owned HTTP
baseline. See the official [subscription schemas and snapshot behavior](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions)
and [public `/info` endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint).

Market subscriptions share one shard per network and use the catalog's exact
exchange `coin` for `activeAssetCtx`. Account monitors use a dedicated
connection because the official SDK notes that `userEvents` and `orderUpdates`
messages do not carry enough user identity to multiplex safely. The connection
also carries `userFills`, `userFundings`, and
`allDexsClearinghouseState`. This supports catalog-discovered perp, spot,
outcome, and HIP-3 canonical market identities without UI ticker aliases. The
non-multiplexing behavior is visible in Hyperliquid's official
[Python WebSocket manager](https://github.com/hyperliquid-dex/hyperliquid-python-sdk/blob/master/hyperliquid/websocket_manager.py).

Hyperliquid closes a connection after 60 seconds without a client message. The
public session sends the documented `{ "method": "ping" }` every 50 seconds and
treats unexpected connection closure as a gap; see
[timeouts and heartbeats](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/timeouts-and-heartbeats).

### Capacity budgets

Current official per-IP limits are 1,200 REST weight/minute, 10 WebSocket
connections, 30 new connections/minute, 1,000 subscriptions, 10 unique user
subscriptions, 2,000 sent WebSocket messages/minute, and 100 simultaneous
in-flight WebSocket posts. The source of truth is Hyperliquid's current
[rate-limit documentation](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits).

The service admits no projected work above 70% of those values:

| Resource | Hard limit | Service ceiling |
|---|---:|---:|
| REST weight/minute | 1,200 | 840 |
| WebSocket connections | 10 | 7 |
| New WebSocket connections/minute | 30 | 21 |
| WebSocket subscriptions | 1,000 | 700 |
| Unique subscribed users | 10 | 7 |
| Sent WebSocket messages/minute | 2,000 | 1,400 |
| In-flight WebSocket posts | 100 | 70 |

REST snapshot admission uses conservative projected weights before starting a
request. For response-size-dependent endpoints it reserves the documented
maximum 500-row surcharge before transport, then charges each endpoint's base
weight at the request boundary. Global order/fill/funding datasets are fetched
once per account baseline; only clearinghouse/open-order state is fetched per
DEX, in batches of four. Catalog baselines coalesce per network for 30 seconds;
consumer abort is isolated while the last departing consumer aborts the shared
request. When projected work would cross 840, stop new admission and retry on a
later bounded reconciliation tick; never spin or grow subscriptions without
bound.

The global account request completes before bounded per-DEX batches begin. The
service intentionally does not overlap those phases because shared REST
admission order and sibling cancellation would otherwise depend on transport
timing. No WebSocket delta is accepted until the complete account baseline
succeeds.

## Rule evaluation and atomic persistence

Rules cover fill, cancellation, rejection, margin risk, liquidation risk,
price-above/below, and funding-above/below. The evaluator requires the exact
network, canonical market, account link for account rules, event family, and
threshold. Decimal parsing and comparison never use JavaScript `Number`.
Malformed, noncanonical, missing-baseline, wrong-scope, and ambiguous provider
values fail closed.

Execution events use exchange identities such as fill transaction identity or
order ID/status time. Metric alerts require an actual threshold crossing; a
value already beyond the threshold at baseline is not an event. The stable
event key is a SHA-256 digest of version, rule identity, exact scope, and stable
source identity. It contains no address, token, threshold, payload, or secret in
clear text.

One PostgreSQL transaction locks the active rule/authorization scope, claims the
event key, inserts one random 128-bit opaque alert ID, and inserts one outbox row
capturing installation/link generations. A duplicate key inserts nothing. The
alert ID remains stable for every delivery attempt and is the mobile client's
dedupe key. Neither public stream payloads nor complete provider requests or
responses are persisted.

Each rule has a bounded ordered in-memory update chain. If a slow persistence
boundary fills that chain, the rule enters a redacted degraded state exactly
once, detaches its listener, and is eligible for a fresh authoritative baseline
on a later reconciliation. This is an explicit best-effort execution gap:
exchange events received after overload and before rebaseline may not produce an
alert, and the HTTP baseline is not claimed to replay every missed event. The
degraded signal and rebaseline counter make the gap observable; stable event
keys still deduplicate every event that reaches persistence.

## Outbox and provider fence

Pending work is claimed with `FOR UPDATE SKIP LOCKED`. An outbox row receives at
most eight claims. Its lease and dispatch permit last 30 seconds; the permit's
provider deadline is 10 seconds from creation. Expired unmarked attempts may be
recovered and requeued by the next recovery scan, at most ten seconds after the
durable deadline while the egress leader remains healthy. Recovery runs
immediately when a leader starts or takes over, then at most once per ten-second
idle cadence. Partial expiry indexes bound the submission-deadline,
active-permit, and leased-outbox scans.

The corrected KTD22 sequence is mandatory:

1. Claim one active outbox row and persist its exact installation/link
   generations in a permit.
2. Immediately before the provider marker, re-lock and recheck installation,
   link, token, outbox, generations, permit state, lease, and deadline.
3. Atomically mark the permit `submission_started` and outbox
   `provider_submission_started`.
4. Before decrypting the token—the first possible provider fetch—and again
   immediately before `fetch`, repeat the authorization/generation/deadline
   checks.
5. Make exactly one provider transport attempt whose `AbortSignal` expires at
   the earlier of ten seconds or the permit's original absolute provider
   deadline. Refuse synchronously if no time remains.

A crash before step 3 can be retried after lease expiry. A crash, timeout, parse
failure, or lost response after step 3 becomes `provider_outcome_unknown` when
the deadline expires and is never resubmitted. This intentionally gives bounded
at-least-once behavior without claiming exactly-once delivery. Revocation or
unlink racing any pre-marker check rejects the attempt; drain waits only for
already marked work through its bounded deadline.

## Expo boundary and receipts

The only send origin is
`https://exp.host/--/api/v2/push/send`; the only receipt origin is
`https://exp.host/--/api/v2/push/getReceipts`. Redirects fail. The message is one
opaque record containing the Expo token, fixed generic title/body, and only
`alertId`, `category`, `network`, and `routeHint` in `data`. It never contains an
account, position, order, price, size, PnL, market payload, rule threshold, or
credential.

Expo currently documents 600 notifications/second/project, up to 100
notifications in a send request, up to 1,000 receipt IDs per receipt request,
and six concurrent connections in its Node SDK. Hyper Trader uses the stricter
admission ceilings of 420 notifications/second, 70 messages per future batch,
100 receipts per query, and four connections. The current worker is stricter:
it submits one opaque notification and one receipt request serially per tick.
See Expo's current
[sending, ticket, receipt, limit, and error contract](https://docs.expo.dev/push-notifications/sending-notifications/).

The provider call has no in-call transport retry. Expo recommends backoff for
some failures in a generic sender, but this service cannot distinguish a
response lost after provider acceptance; retrying a marked attempt could submit
twice. Bounded retry exists only before the durable marker. Provider 4xx/5xx,
ticket errors, and receipt details are reduced to a fixed code allowlist; full
provider payloads are discarded after bounded parsing.

An accepted ticket proves only Expo acceptance, not device delivery. Receipt
work begins after 15 minutes, uses a 30-second database lease, and retries
missing/failed queries at 15, 30, 60, and 120-minute windows. Five unsuccessful
receipt observations become terminal `unknown`; no loop occurs inside one
worker tick. Tickets and receipts retain only ticket ID, opaque outbox/token
references, timestamps, state, bounded attempts, and reduced error code. Expo
documents that receipts are cleared after 24 hours and that
`DeviceNotRegistered` means the token must no longer be used. Either a ticket or
receipt with that code marks the exact encrypted token invalid until a fresh,
proof-bound rebind.

Expo describes its handoff as best effort with at least one attempt and possible
duplicates; see its [delivery guarantee FAQ](https://docs.expo.dev/push-notifications/faq/).
The app must therefore dedupe by stable `alertId`, fetch current details after a
tap, and never treat a notification as proof of exchange state.

## Metrics, alerts, and retention

Metrics are limited to these names: `monitor_leases`, `monitor_rebaselines`,
`subscription_rejections`, `upstream_utilization_percent`, `outbox_pending`,
`delivery_attempts`, `delivery_accepted`, `delivery_rejected`,
`delivery_unknown`, `receipt_pending`, and `receipt_failed`. Labels are limited
to network, provider `expo`, and coarse accepted/rejected/unknown outcome.
The authoritative lease/outbox/receipt aggregate is read at startup or takeover
and then at most every ten seconds. Unchanged aggregate snapshots and unchanged
individual gauges are not republished.

Never label or log an address, market, installation ID, link ID, alert ID,
outbox ID, ticket ID, token fingerprint, rule ID, provider message, public
payload, ciphertext, or error object. Page on sustained lease loss, repeated
rebaselines, outbox growth, any delivery-unknown increase, receipt backlog,
or utilization above the service ceiling.

Deduplication keys expire within seven days. Alerts, outbox metadata, permits,
tickets, and receipts use the U11 30-day retention job. Push tokens remain
encrypted and are removed by installation/token lifecycle. Deletion tombstones
remain governed by the independent ledger and are not delivery-retention data.

## Incident and recovery playbooks

### Hyperliquid gap or exhaustion

1. Stop new monitor admission and noncritical refresh.
2. Preserve lease renewal for owned targets within budget.
3. Close the affected stream, clear its baseline, and wait for the rolling
   budget window.
4. Obtain a fresh authoritative snapshot, then reopen the stream.
5. Confirm no delta was evaluated before the new baseline and watch bounded
   subscription/connection counts recover.

### Expo outage or uncertainty

1. Stop new provider admission before 420 notifications/second or four
   connections would be exceeded; the current serial worker normally uses one.
2. Do not resubmit any `provider_submission_started` attempt.
3. Let its ten-second deadline record `provider_outcome_unknown`.
4. Continue bounded receipt checks for tickets already recorded; never infer
   device delivery from a ticket.
5. Resume pending unmarked outbox work only after readiness is healthy and the
   rate window permits it.

### Restore or key failure

Keep both worker gates closed. Repeat the U11 restore sequence through the
current independent-ledger head, validate every retained token with every
required KEK version, verify migration checksums through `0005_market_catalog`,
and run the authorization consistency query before activation. Do not skip or
manually flip a gate to clear a queue.

## Verification

Default tests use injected public clients, WebSocket connections, clocks, and
Expo `fetch`; they never contact a live service and contain no real tokens or
provider credentials.

To inspect the split public account baseline manually on testnet, set an exact
public address and run `bun examples/notification-account-baseline.ts`. The
example performs no signing or authenticated action.

```sh
bun test apps/notifications/src packages/hyperliquid/src/public-boundary.test.ts
bun run test:notifications
bun run typecheck
bun run check
```

`bun run test:notifications` starts a disposable PostgreSQL 17 container with
rootless Podman on a loopback-only random port, runs the U11 foundation suite and
U14 worker suite sequentially, rolls every migration back, and stops the exact
container. Set `CONTAINER_ENGINE=docker` to validate Docker compatibility; the
runner validates the engine name and keeps the same exact-name and loopback-port
safeguards.
