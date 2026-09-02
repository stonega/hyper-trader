# Market catalog backend

## Goal and trust boundary

The backend is the authoritative discovery boundary for Hyper Trader's market
catalog. Mobile receives one validated, immutable PostgreSQL generation rather
than independently enumerating native, spot, outcome, and HIP-3 sources on every
device. This reduces upstream fan-out, gives all clients the same canonical IDs
and trading constraints, and keeps source failures observable without inventing
metadata.

The catalog worker imports only `@hyper-trader/hyperliquid/public` and calls
public Hyperliquid `/info` methods. It has no signer, API-wallet key,
authenticated account transport, signed payload, or `/exchange` capability.
Live prices, candles, books, trades, and public account reads remain separate
from catalog publication.

## Publication model

Each network has at most one building generation and one published generation.
A sync lease fences concurrent workers. A new build refreshes native perpetual,
spot, and applicable outcome sources, then refreshes HIP-3 DEXes in bounded
pages. The D1 adapter starts the building generation empty and copies only a
source whose bounded retries fail; a source-resolution ledger distinguishes a
successfully empty source from one that has not run. The PostgreSQL adapter may
seed the building generation from the previous publication. Readers continue to
see the previous published generation until the complete build is atomically
published.

The worker admits at most 840 weighted REST units per stage, starts no more than
eight source requests concurrently, and waits at least 65 seconds between
builder pages. A lease lasts 120 seconds so one bounded page can finish across
the upstream request deadline and scheduling margin.

The Cloudflare adapter stores sync metadata separately from catalog content.
Each market, quarantined record, and bounded source error occupies its own
generation-scoped D1 row, so lease claims and state transitions never carry a
growing catalog document. Successful source retries use change-aware upserts and
an index-constrained stale-record deletion instead of deleting and reinserting a
whole source. Publication swaps the generation pointer in the same D1 batch that
finishes the building records, then retires superseded rows.

One failed source is retained as a typed source error. The worker retries a
stage three times with bounded exponential or upstream `Retry-After` delay. If a
published generation exists, persistent failure retains that source's previous
validated records and publishes the error alongside them. In particular, a
failed DEX enumeration never erases the previously published builder catalog.
Without a previous generation, successfully validated sources may be published
after the same bounded retries; absent data stays absent and the error remains
visible.

## PostgreSQL ownership

Migration `0005_market_catalog` adds:

- `market_catalog_generations` for immutable building, published, and retired
  generation state;
- `market_catalog_records` for validated market and quarantine JSONB records;
- `market_catalog_source_errors` for bounded diagnostics and retry metadata;
  and
- `market_catalog_sync_state` for network publication pointers, page progress,
  retry time, and generation-fenced worker leases.

Partial unique indexes enforce one building and one published generation per
network. Foreign keys keep every record and error pinned to a generation. Old
generations are retired only inside publication and retained long enough for a
reader that already selected the former generation to finish safely.

## Public API and mobile behavior

`GET /privacy` serves the public Hyper Trader privacy policy as a responsive
HTML document for app-store disclosure and in-app access. It accepts no query
parameters, requires no bearer, and is also available through `HEAD` for link
verification. The response uses a restrictive content-security policy and
contains no scripts or third-party page assets.

`GET /v1/market-summaries/:network` is the Markets browse path. It accepts
bounded search, family, availability, lifecycle, sort, canonical-ID, limit, and
generation-bound cursor parameters. The default and mobile page size is 24 and
the hard maximum is 50. Its response contains only row presentation fields,
price-display precision, perpetual maximum leverage, counts, publication
metadata, and the next cursor; order-asset IDs, remaining trading constraints,
quarantine records, and source-error details are excluded. A cursor from an older publication returns
`409 generation_changed`, causing mobile pagination to restart from page one.

Markets uses this endpoint with infinite pagination and requests the next page
only near the end of the loaded list. Search and filters run at the backend, so
the device never downloads the complete catalog merely to find a row. Only the
default first page is persisted for immediate reopening.

`GET /v1/market-catalog/:network` accepts only `testnet` or `mainnet`, needs no
bearer, and returns schema version, network, generation, publication time,
validated markets, quarantined records, and bounded source errors. Before the
first publication it returns `503 not_ready` with `Retry-After: 30`.

A success response includes a strong generation ETag and public cache policy.
Trading workflows validate this complete snapshot, matching network, response
media type, and exact ETag before replacing their in-memory TanStack Query
value. Later reads send `If-None-Match` and reuse only the already validated
in-memory generation after `304 Not Modified`. Browse summaries never authorize
or parameterize an order.

The release build supplies one exact HTTPS backend origin. HTTP, paths,
credentials, query strings, fragments, redirects, cross-network responses,
oversized bodies, and malformed UTF-8/JSON fail closed. Mobile does not fall
back to direct catalog discovery when the backend is missing or unavailable;
its retained query data and stale/offline presentation remain the only fallback.

An unconfigured Expo development build has one narrower test-only exception: it
may read validated testnet native-perpetual, spot, and outcome metadata directly
to unblock physical-device UI verification. It never enumerates builder DEXes,
never applies to mainnet, reports partial coverage, and is not available in a
release build. Supplying a backend origin disables this bootstrap, including
when that configured backend is unavailable or invalid.
