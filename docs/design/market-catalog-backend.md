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
A sync lease fences concurrent workers. A new build copies the previous
generation first, refreshes native perpetual, spot, and applicable outcome
sources, then refreshes HIP-3 DEXes in bounded pages. Readers continue to see the
previous published generation until the complete build is atomically published.

The worker admits at most 840 weighted REST units per stage, starts no more than
eight source requests concurrently, and waits at least 65 seconds between
builder pages. A lease lasts 120 seconds so one bounded page can finish across
the upstream request deadline and scheduling margin.

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

`GET /v1/market-catalog/:network` accepts only `testnet` or `mainnet`, needs no
bearer, and returns schema version, network, generation, publication time,
validated markets, quarantined records, and bounded source errors. Before the
first publication it returns `503 not_ready` with `Retry-After: 30`.

A success response includes a strong generation ETag and public cache policy.
Mobile validates the complete snapshot, matching network, response media type,
and exact ETag before replacing its TanStack Query value. Later reads send
`If-None-Match` and reuse only the already validated in-memory generation after
`304 Not Modified`.

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
