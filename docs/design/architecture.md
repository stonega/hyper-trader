# Architecture

## Goal

Hyper Trader is a full trading client for Hyperliquid on iOS and Android. The
product target includes market discovery, order entry and management, portfolio
tracking, and account settings across every supported Hyperliquid market. The
architecture separates public market-data reads from authenticated exchange
actions so security-sensitive signing cannot leak into ordinary UI and transport
code.

## Product scope

- Support every active market returned by Hyperliquid's documented metadata
  endpoints, including native perpetuals, builder-deployed HIP-3 perpetuals, and
  spot pairs.
- Discover markets and their precision, leverage, margin, lifecycle, and asset-ID
  rules at runtime. A hard-coded featured-symbol list may be used for curation,
  but never as the source of truth for market coverage.
- Treat new or changed markets as remote data at a trust boundary. A market that
  cannot be validated must not be traded and must surface an explicit unavailable
  state instead of falling back to guessed parameters.
- Provide the complete user workflow for supported markets: inspect market data,
  draft and review orders, submit and manage orders, and reconcile fills,
  balances, positions, margin, and PnL.

## System shape

```text
apps/mobile
  Expo Router screen
      │
      ├── HeroUI Native + Uniwind presentation
      ├── TanStack Query lifecycle and caching
      └── notification preferences and device registration
              │
              ▼
packages/hyperliquid
  typed market discovery, account data, actions, and boundary validation
              │
              ▼
Hyperliquid POST /info and /exchange APIs

notification service
  public-address monitoring + alert evaluation + push delivery
              │
              ├── Hyperliquid public data APIs and streams
              └── platform push-notification providers
```

Public price reads and signed exchange actions do not require a proxy. Reliable
alerts while the app is closed are a concrete server-side responsibility, so the
product requires a notification service without moving signing authority
off-device.

## Responsibilities

### `apps/mobile`

- Native routing, lifecycle, accessibility, and responsive layout
- HeroUI Native composition and semantic theme tokens
- Query cache, refresh behavior, loading states, and errors
- Master-account connection, API-wallet lifecycle UX, and explicit order
  confirmations

### `packages/hyperliquid`

- Network selection and endpoint ownership
- Market metadata, account query, and exchange-action construction
- Runtime validation at the remote-data boundary
- Preservation of decimal values as strings
- Asset-ID resolution and transaction nonce coordination
- Deterministic unit tests with injected `fetch`

The package must not depend on React Native so it remains testable and reusable
from future services or tooling.

### Notification service

- Register device push tokens and network-scoped alert preferences
- Monitor public account and market data while the mobile app is closed
- Evaluate fill, rejection, margin-risk, liquidation-risk, price, and funding
  alert rules
- Deduplicate, rate-limit, and deliver notifications without issuing exchange
  actions
- Store only the minimum public account identifiers and alert-delivery data
  required for the service

The notification service must never receive an API-wallet private key, seed
phrase, signed action, or authority to call a state-changing exchange endpoint.
Its data retention, device-token revocation, account unlinking, and privacy model
must be documented before production deployment.

Screen behavior and cross-screen state are defined in
[`mobile-screen-system.md`](mobile-screen-system.md).

## Trading trust boundary

Public market data may be read directly from the mobile device. Authenticated
exchange actions use a dedicated Hyperliquid API wallet, also called an agent
wallet. The API wallet signs on behalf of an approved master account or
sub-account; it is not the account identity used for portfolio queries.

The intended authorization and submission path is:

```text
master wallet connection → generate API wallet → master approves API wallet
                         → store scoped signer securely

order draft → local validation → human confirmation → API-wallet signature
            → testnet exchange submission → verified response and reconciliation
```

The master-account private key or seed phrase must never be requested, persisted,
or logged by Hyper Trader. The API-wallet private key is a scoped trading
credential: it must never be written to general application storage, logs,
analytics, crash reports, backups, or source control. Its OS-protected storage,
device-authentication policy, rotation, expiry, deregistration, and recovery
behavior must be documented and reviewed before live order submission is added.

Account and portfolio queries must use the master-account or sub-account address,
not the API-wallet address. An API-wallet address must not be reused after expiry
or deregistration because its prior nonce state may be pruned. Independent client
sessions and concurrently used sub-accounts must not share a signer when doing so
could create nonce collisions.

All signed actions must pass through one nonce coordinator per API-wallet signer.
The coordinator must issue unique millisecond nonces within Hyperliquid's accepted
time window, remain correct when actions complete out of order, and prevent
concurrent screens or background work from signing with the same nonce. Pending
actions must have a reconciliation path for accepted, rejected, expired, and
unknown outcomes.

Reference: [Hyperliquid: Nonces and API wallets](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/nonces-and-api-wallets).

## Market discovery policy

- Discover perpetual DEXes and their universes from the current perpetual
  metadata endpoints; do not assume the first perpetual DEX is the complete
  universe.
- Discover spot pairs and token metadata from the current spot metadata
  endpoints. Preserve Hyperliquid's canonical asset identifiers separately from
  user-facing display names.
- Read prices, order books, candles, funding, open interest, and tradability from
  the market-specific contexts exposed by Hyperliquid.
- Preserve delisted, isolated-only, margin-mode, precision, and maximum-leverage
  metadata. These constraints must drive the trade form and boundary validation.
- Keep featured, favorite, recent, and searched markets as presentation-layer
  views over the complete validated market catalog.

References: [Hyperliquid perpetual metadata](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals),
[spot metadata](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/spot),
and [exchange asset IDs](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint).

## Network policy

- Public price display currently reads mainnet.
- Authenticated and state-changing development defaults to testnet.
- The chosen network must be visible anywhere an order can be signed.
- API-wallet authorization, storage, and nonce state are network-scoped and must
  never be silently reused across testnet and mainnet.
- Mainnet trading requires an explicit product decision and a separate release
  safety review.
