# Market catalog backend operations

## Local PostgreSQL with rootless Podman

The repository uses the explicitly qualified
`docker.io/library/postgres:17-alpine` image. Start or resume the persistent
loopback-only database and apply all notification and catalog migrations:

```sh
bun run db:local:up
```

The command owns only the exact container `hyper-trader-postgres-local` and the
named volume `hyper-trader-postgres-local-data`. It is idempotent: an existing
running container is reused, a stopped container is started, and a missing
container is created. It never removes the volume. The development-only
connection is:

```text
postgres://hyper_trader:hyper_trader_local_only@127.0.0.1:5432/hyper_trader
```

Override the initial host port with `HYPER_TRADER_POSTGRES_PORT`. A later command
must use the same port as the existing container; a mismatch stops with an error
instead of replacing it.

Inspect or stop the exact container without deleting data:

```sh
bun run db:local:status
bun run db:local:down
```

Do not reuse the synthetic local credential outside a developer machine. The
production database URL comes from the deployment secret manager and must use a
separate role, password, network policy, backup owner, and rotation procedure.

## Backend composition

The production notification-service composition receives a Bun `SQL` pool,
runs `migrateNotifications`, constructs `PostgresMarketCatalogStore`, and passes
that store as `catalogStore` to `composeNotificationServiceRuntime`. This starts
the generation synchronizer independently of push-provider worker activation,
serves the public catalog route through the existing direct-TLS boundary, and
allows notification monitors to reuse a published catalog.

The service deployment adapter remains responsible for PostgreSQL lifecycle,
TLS material, push-token key authority, deletion-ledger authority, Expo
credentials, WebSocket creation, readiness gates, signals, and graceful SQL
pool closure. Catalog support does not weaken any notification activation gate
and does not make local synthetic credentials suitable for the full service.

The repository also provides a catalog-only executable so market publication
does not depend on provisioning notification encryption, deletion-ledger, Expo,
or WebSocket authorities:

```sh
NOTIFICATION_SERVICE_ORIGIN=https://catalog.example.com \
NOTIFICATION_DATABASE_URL=postgres://... \
NOTIFICATION_TLS_CERT_FILE=/run/secrets/catalog-cert.pem \
NOTIFICATION_TLS_KEY_FILE=/run/secrets/catalog-key.pem \
bun run market-catalog
```

The executable applies forward migrations, synchronizes testnet and mainnet
catalog generations, and exposes `/health`,
`/v1/market-catalog/{testnet|mainnet}`, and the bounded Portfolio aggregation
routes `/v1/portfolio-snapshots/{live|history}`. Portfolio requests use `POST`
with `{ network, user }`; the public address is not placed in the URL, and
responses are explicitly `no-store`. It terminates TLS directly and reads key
material from files rather than ordinary environment-variable values. Set a
unique, lowercase `NOTIFICATION_INSTANCE_ID` in multi-instance deployments.

Catalog publication fails closed when core discovery contains no validated
native perpetual market. The public catalog route also treats an absent or
previously published empty generation as temporarily unavailable: it returns
`503 { "error": "not_ready" }` with `Retry-After: 30` rather than presenting a
successful empty catalog to mobile clients.

## Mobile configuration

Set `EXPO_PUBLIC_BACKEND_ORIGIN` to the reviewed exact HTTPS origin at build
time. Expo `extra.backendOrigin` is the matching native-config field. During the
transition, `EXPO_PUBLIC_NOTIFICATION_SERVICE_ORIGIN` and Expo
`extra.notificationServiceOrigin` remain accepted aliases because the catalog
route is hosted by that service. The client captures the origin once and rejects
runtime changes or invalid values.

Portfolio uses this same origin for its versioned live and history aggregates.
An invalid configured origin is an unavailable backend, not permission to fall
back to device-side fan-out. Private aggregates remain memory-only on mobile.

When no backend origin is supplied, Expo development builds may bootstrap only
validated testnet core metadata directly from Hyperliquid so a physical-device
UI session is not blocked on backend deployment. The bootstrap is testnet-only,
does not enumerate HIP-3 builder DEXes, remains visibly partial, and is compiled
out of release behavior. Configured development builds and every release build
continue to use the generation-pinned backend exclusively.

On an empty development cache, the mobile client requests validated native
perpetual metadata alongside the complete core bootstrap. Trade may select and
render that native subset as soon as it arrives while spot and outcome metadata
continue loading. The complete core result atomically replaces the subset; the
progressive request is never used in configured or release builds.

## Cloudflare public-backend deployment

The repository includes a Cloudflare Worker deployment adapter for the public
market-catalog and Portfolio routes. It uses D1 for generation and incremental
sync state, runs one bounded synchronization step per minute, and keeps the
same exact-origin, request-size, response-size, ETag, and fail-closed HTTP
contracts as the Bun service.

The Worker keeps Portfolio live reads within Cloudflare's six simultaneous
outbound-connection limit by batching three active DEXes at a time. Active DEX
candidates come from bounded public order, fill, and funding activity and are
intersected with the published catalog. A request reads at most 16 active DEXes;
history-window or DEX-count saturation is returned as a source gap.

This adapter is intentionally limited to public backend data. It does not host
installation credentials, account-link proofs, push tokens, notification rules,
or provider workers. Those capabilities still require the reviewed PostgreSQL,
key-provider, deletion-ledger, Expo, and direct-TLS deployment authorities.

Provision and deploy from the repository root:

```sh
wrangler d1 create hyper-trader-backend
# Copy the returned database ID into apps/api/wrangler.jsonc.
bun --cwd apps/api wrangler d1 migrations apply BACKEND_DB --remote
# Set BACKEND_ORIGIN to the exact workers.dev or reviewed custom origin.
bun run backend:deploy
```

The Worker name is `hyper-trader-backend`; its D1 database uses the same name.
`BACKEND_ORIGIN` is a non-secret exact HTTPS origin and is source-controlled so
an unexpected host fails with `421` instead of being inferred from forwarding
headers. Wrangler configuration is the deployment source of truth.

## Verification

The default tests inject fetch, clients, clocks, and stores and make no network
requests. PostgreSQL integration tests default to rootless Podman and use a
disposable loopback-only container:

```sh
bun test apps/api/src/catalog apps/mobile/src/features/markets/catalog-client.test.ts
bun run test:notifications
bun run typecheck
bun run check
```

Set `CONTAINER_ENGINE=docker` only when validating Docker compatibility. The
disposable integration runner and persistent local database use different exact
container names and cannot stop or replace one another.
