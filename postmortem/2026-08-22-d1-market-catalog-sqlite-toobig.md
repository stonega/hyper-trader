# D1 market catalog `SQLITE_TOOBIG`

## Status

Remediation is implemented and verified locally. The D1 migration and Worker
deployment remain pending for the remote `hyper-trader-backend` service.

## Summary

At 2026-08-22 05:48:54 UTC, the once-per-minute Cloudflare Worker catalog sync
failed while claiming its next synchronization lease:

```text
D1_ERROR: string or blob too big: SQLITE_TOOBIG
at D1MarketCatalogStore.claimDueSync
at MarketCatalogSynchronizer.runOnce
```

The D1 schema stored the complete published and building catalog documents in
the same `market_catalog_sync_state` row. Lease queries also returned both JSON
documents. As the catalog grew, the combined row or query result crossed D1's
2 MB string, BLOB, or row limit.

## Impact

- Scheduled catalog synchronization could not claim or continue work for the
  affected network.
- Publication of newer market metadata was stalled until remediation.
- An existing published generation remained the reader-facing snapshot; the
  failure did not partially publish the building generation.
- The affected Worker is limited to public market data. No signer, private key,
  authenticated exchange action, or private account data was involved.
- The supplied log does not establish the first failure, last failure, or which
  network reached the limit first, so incident duration and exact network scope
  remain unknown.

## Detection

Cloudflare cron error telemetry reported the failure for:

- service: `hyper-trader-backend`
- trigger: `* * * * *`
- request: `KZOSNC4UDQR9WF1E`
- script version: `e4e6f0bd-3d4e-4882-9e60-fc43b8e8dae8`

## Root cause

Migration `0001_market_catalog.sql` denormalized two independently growing JSON
documents into `market_catalog_sync_state`:

- `published_payload`
- `building_payload`

`D1MarketCatalogStore.claimDueSync` returned both columns when updating the
lease. The same row also held both payloads during an incremental build. This
made catalog size, rather than an explicit bounded field, determine whether a
lease claim could execute within D1's hard row limit.

The failure was architectural scaling behavior, not a malformed individual
market record.

## Contributing factors

- The D1 adapter used one serialized catalog document while the PostgreSQL
  implementation already used generation-scoped record and source-error rows.
- Existing Cloudflare tests covered payload merge behavior but did not exercise
  the D1 store and migrations with a catalog whose published and building
  copies exceeded 2 MB in aggregate.
- Small deterministic fixtures did not expose the database limit.

## Remediation

The fix normalizes the D1 catalog and keeps sync state metadata-only:

1. `0002_catalog_records.sql` migrates existing published and building JSON into
   `market_catalog_records` and `market_catalog_source_errors`, scoped by
   network and generation.
2. The migration rebuilds `market_catalog_sync_state` without either payload
   column.
3. Lease claims now return only generation, progress, and fencing metadata.
4. Generation copy, source replacement, publication, and cleanup use
   transactional D1 batches with the existing owner and lease-generation fence.
5. Incoming record arrays are split into at most 512 KB JSON batches before
   D1's JSON extension expands them into individual rows.
6. The previous published generation remains available throughout a build, and
   publication changes the visible generation only after the build completes.

## Verification

- Added a regression test that migrates and copies a catalog whose two
  serialized generations exceed 2 MB in aggregate.
- Added a deterministic claim, core sync, builder completion, publication, and
  read lifecycle test against an in-memory SQLite-backed D1 adapter.
- Applied both migrations successfully with Wrangler's local D1 runtime.
- `bun run check` passed.
- `bun run typecheck` passed for every workspace.
- `bun test` passed with 585 tests and 42 existing integration-test skips.

## Timeline

- 2026-08-22 05:48:54 UTC: Cloudflare recorded `SQLITE_TOOBIG` during the cron
  lease claim.
- 2026-08-22: Investigation identified the combined D1 state row and
  `RETURNING` result as the unbounded storage boundary.
- 2026-08-22: The catalog was normalized, lease-fenced D1 batches were added,
  and regression and lifecycle tests passed.
- Pending: apply the migration remotely, deploy the Worker, and verify catalog
  generation advancement.

## Follow-up actions

- [x] Normalize D1 catalog records and source errors by generation.
- [x] Remove catalog payloads from sync-state lease queries.
- [x] Add oversized-catalog migration coverage.
- [x] Add a complete D1 catalog lifecycle test.
- [x] Document the normalized Cloudflare storage model.
- [ ] Apply `0002_catalog_records.sql` to the remote D1 database immediately
  before deploying the matching Worker code.
- [ ] Confirm both testnet and mainnet generations advance after deployment.
- [ ] Add an operational alert for repeated scheduled-sync failures and
  excessive published-generation age.
