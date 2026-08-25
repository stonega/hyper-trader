# Spot market context misassociation

## Status

The parser remediation and deterministic regression coverage are implemented
and verified locally. Deploying the corrected Worker and confirming new
testnet and mainnet catalog generations remain pending.

## Summary

On 2026-08-25, a user reported that Hyper Trader showed PUCKY/USDC near
`27.675` while the Hyperliquid testnet interface showed `0.00060000`. The user
also could not readily find HYPE/USDC in the volume-sorted Markets list.

Hyperliquid's `spotMetaAndAssetCtxs` responses contained sparse spot universes:
a market's array position could differ from its authoritative
`universe.index`. Hyper Trader joined each universe entry to an asset context
using the array position instead of the universe index. PUCKY/USDC therefore
received HYPE/USDC's price and volume context on testnet, while affected
mainnet markets also received context belonging to another spot index.

## Impact

- PUCKY/USDC displayed HYPE/USDC's price, previous-day price, and notional
  volume in the Markets and Trade market metadata.
- HYPE/USDC displayed an unrelated price and zero notional volume.
- The default volume sort promoted PUCKY/USDC and pushed HYPE/USDC deep into
  the catalog, making HYPE/USDC appear absent during ordinary browsing.
- Other testnet and mainnet spot markets after gaps in the universe could
  receive context from a different spot market.
- The incident affected public read data. It did not mutate Hyperliquid state,
  expose signing material, or perform an authenticated exchange action.
- There is no evidence in the investigation establishing that an order was
  submitted using an affected displayed reference price.

## Detection

The issue was detected by comparing Hyper Trader's PUCKY/USDC price with the
Hyperliquid testnet interface. A live API comparison reproduced the mismatch:

- HYPE/USDC was at universe array position `907`, with universe index `1035`.
- PUCKY/USDC was at universe array position `1035`, with universe index `1204`.
- Context `1035` belonged to HYPE/USDC and reported `midPx: 27.6745` and
  `dayNtlVlm: 7187.484`.
- Context `1204` belonged to PUCKY/USDC and reported `markPx: 0.0006`.
- The response contained 1,310 current universe entries and 2,764 context
  slots, demonstrating that enumeration position was not a safe identity.

The configured backend's published testnet generation `245` reproduced the
same incorrect association with no catalog source error.

A follow-up mainnet comparison found 326 current universe entries, 717 context
slots, and 255 entries whose array position differed from their universe
index. NOCEX/USDC at `spot:72` demonstrated the deployed impact: Hyperliquid's
indexed context `@72` reported `markPx: 1.2188`, while backend generation `634`
reported `markPx: 1.0` from positional context `@71`, again with no source
error.

## Root cause

`parseSpotSource` correctly read `spotMeta.universe[*].index` for the market's
canonical ID, order asset ID, and coin, but used the local enumeration
`fallbackIndex` to select from `spotMetaAndAssetCtxs[1]`.

This mixed two different identities:

- `fallbackIndex`: the market's current position in the filtered universe
  array; and
- `universeIndex`: Hyperliquid's stable spot market index and `@<index>` coin
  identity.

When the two values diverged, the parser still accepted the selected context
because it ignored the context's `coin` field. Valid decimal parsing therefore
made the wrong association look structurally valid.

## Contributing factors

- The deterministic spot fixture declared universe index `7` at array position
  `0`, but supplied its context at position `0`. It encoded the same positional
  assumption as the implementation.
- Test fixtures used compact context arrays and did not model removed or
  otherwise absent universe entries.
- The parser tolerated forward-compatible context fields but did not use the
  available `coin` field to verify identity.
- Previous responses with contiguous universe indices made array position and
  universe index appear interchangeable.

## Remediation

The spot catalog trust boundary now:

1. Selects each asset context using the authoritative universe index.
2. Validates the context's `coin` when Hyperliquid supplies it.
3. Quarantines a market when the indexed context is missing or identifies a
   different coin instead of attaching untrusted price data.
4. Uses a sparse context fixture whose array slot matches the declared
   universe index.
5. Includes a PUCKY/HYPE-shaped regression proving that sparse universe
   positions resolve to their own prices and volumes.

## Verification

- `bun test packages/hyperliquid/src/markets/catalog.test.ts` passed with 14
  tests.
- `bun run check` and `git diff --check` passed.
- `bun run typecheck` passed for every workspace.
- `bun test` passed with 671 tests and 42 existing integration-test skips.
- An end-to-end live testnet read through the corrected client returned
  HYPE/USDC `midPx: 27.6745` and PUCKY/USDC `markPx: 0.0006`, with neither
  market quarantined and no spot source error.
- A live mainnet read confirmed that all current spot universe names match the
  `coin` at their indexed context slot, including canonical `PURR/USDC`.

## Timeline

- 2026-08-25: A user reported the PUCKY/USDC price discrepancy and missing
  HYPE/USDC market.
- 2026-08-25: Live testnet metadata and the configured backend reproduced the
  context swap.
- 2026-08-25: A mainnet follow-up found 255 currently listed spot markets past
  sparse universe gaps and reproduced the swap in backend generation `634`.
- 2026-08-25: Investigation identified the positional context join and the
  fixture gap.
- 2026-08-25: The parser, identity validation, sparse fixture, and regression
  tests were implemented and verified locally.
- Pending: deploy the corrected backend and confirm that new testnet and
  mainnet catalog generations publish correctly indexed spot summaries.

## Follow-up actions

- [x] Join spot contexts using the authoritative universe index.
- [x] Validate an available context coin against the universe coin.
- [x] Add sparse-index and identity-mismatch regression coverage.
- [x] Correct the deterministic spot fixture.
- [x] Record the incident and remediation.
- [ ] Deploy the corrected public backend.
- [ ] Confirm a new testnet generation reports PUCKY/USDC at `0.0006` and
  HYPE/USDC with context `@1035`.
- [ ] Confirm a new mainnet generation reports NOCEX/USDC from context `@72`
  and no longer attaches positional context `@71`.
- [ ] Add catalog telemetry for spot-market quarantine reasons so future
  identity mismatches are visible without inspecting the full snapshot.
