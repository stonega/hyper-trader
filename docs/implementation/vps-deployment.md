# VPS backend deployment

The public Bun/PostgreSQL backend is hosted on `root@13.140.242.169` at
`https://hyper-trader-backend.clawearn.xyz`. Cloudflare proxies its A record to
`13.140.242.169`. It serves market catalogs, market summaries, Portfolio
snapshots, `/privacy`, and `/health`. Notification registration, provider workers,
wallet custody, signing, and exchange submission are not enabled by this adapter.

## Layout and trust boundary

`apps/api/deploy/vps/compose.yaml` defines an isolated `hyper-trader` Compose
project. PostgreSQL has no published host port and uses the persistent
`hyper-trader_postgres_data` volume. The application connects as the database owner
`hyper_trader`, with no superuser, role-creation, or database-creation privileges.
Runtime images are pinned by digest.

The backend runs as UID 1000 with a read-only filesystem, dropped capabilities,
and a loopback-only published port, `127.0.0.1:8788`. It still terminates TLS
directly. Caddy verifies the private upstream certificate and forwards the
original Host explicitly so the exact HTTPS-origin check remains effective.
Caddy marks catalog ETags as weak before compression, preserving the generation
identifier accepted by the mobile client across gzip and zstd representations.
Without that rule, compression appends an encoding suffix to strong ETags and
the client rejects the snapshot.
The separate RSA upstream certificate covers the public IP, loopback IP, and
`hyper-trader-backend.internal`. It is pinned locally, valid for ten years, and
must be replaced in both the secret store and Caddy trust file before expiry.

Caddy automatically obtains and renews the hostname's public certificate. The
legacy HTTPS IP address redirects to the hostname and keeps its certificate
using Let's Encrypt's `shortlived` ACME profile. IP certificates require that profile;
see the [Let's Encrypt operational notes](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability/).
The host Caddyfile imports `/etc/caddy/hyper-trader/site.caddy` and supplies
`default_sni 13.140.242.169` for clients connecting without TLS SNI.

The host stores deployment state under `/opt/hyper-trader`:

- `secrets/`: server-generated passwords, application database URL, and private
  upstream TLS material, mounted only into the services that need each file.
  The parent directory is root-only; secret files have service-specific ownership.
- `deployment.env`: the non-secret exact `BACKEND_ORIGIN`.
- `releases/`: immutable bundles, SQL migrations, source revision, and checksums.
- `current`: the last healthy application release.
- `release.env`: the active release path for manual Compose commands.
- `deploy/`: the Compose and startup files copied from this repository.
- `backups/`: restricted PostgreSQL dumps taken before subsequent deployments.

Initial provisioning requires Docker Compose and Caddy, independent generated
admin/application passwords, an application database URL, and the pinned private
upstream TLS certificate. The PostgreSQL entrypoint runs `init-database.sh` only
when initializing the project's empty volume. Never rotate the password files
alone after initialization: change the database role password and its corresponding
secret files together, then recreate the catalog container. Keep secrets on the
VPS; do not copy them into the repository or command output.

## Deploy an update

Run the repository quality gate, then deploy:

```sh
./scripts/check.sh
bun run backend:deploy:vps root@13.140.242.169
```

The script bundles the backend locally, includes all forward/rollback migration
files, uploads into a fresh release directory, takes a database backup if the
database is already running, and waits for container health. A failed startup
restores the previous application release when available. Database migrations
are not automatically reversed; recover schema changes with the documented
migration/restore procedures when necessary. Dirty source is marked `-worktree`
in `REVISION`; `SHA256SUMS` records the exact deployed bundle and migrations.

The script updates application containers only. Changes to the public origin or
Caddy configuration require separately validating and reloading Caddy. Keep the
Compose project and persistent volume names stable across updates.

## Inspect and recover

On the VPS:

```sh
cd /opt/hyper-trader
set -a
. ./release.env
set +a
docker compose --env-file deployment.env -f deploy/compose.yaml ps
docker compose --env-file deployment.env -f deploy/compose.yaml logs --tail 50 catalog
cat current/REVISION
(cd current && sha256sum -c SHA256SUMS)
```

Use the same Compose arguments for `restart catalog` or `exec -T postgres`.
To roll the application back, export `RELEASE_DIR` pointing to a retained release,
run `up -d --wait`, and update `current` and `release.env` after verification.
Never use `down -v`; that deletes the persistent database volume.
Retain predeployment dumps separately before pruning old releases. This deployment
stores reconstructible public catalog data only; enabling notification state
requires the additional backup, deletion-ledger, and recovery authorities in the
notification operations documentation.

Check public readiness:

```sh
curl --fail https://hyper-trader-backend.clawearn.xyz/health
curl --fail 'https://hyper-trader-backend.clawearn.xyz/v1/market-summaries/testnet?limit=1'
curl --fail 'https://hyper-trader-backend.clawearn.xyz/v1/market-summaries/mainnet?limit=1'
```

Container health confirms the process and TLS boundary. A fresh database may
return `503 not_ready` for catalog routes while bounded discovery builds its
first generation; verify a nonempty publication for both networks before routing
clients to a fresh deployment.

## Mobile builds

The checked-in mobile default and local Expo override use
`https://hyper-trader-backend.clawearn.xyz`. Users can override the public backend
in Settings → Backend API and restore the build default with Use default.
`EXPO_PUBLIC_BACKEND_ORIGIN` supplies a different build default. Existing released
applications keep their compiled backend origin until updated; the previous
`workers.dev` backend remains independently configured for those clients.
