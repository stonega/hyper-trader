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
  endpoints, including native perpetuals, builder-deployed HIP-3 perpetuals,
  spot pairs, and testnet outcome markets.
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
backend API + PostgreSQL
  generation-pinned market catalog + Portfolio aggregation + notification state
              │
              ├── Hyperliquid public metadata APIs
              └── platform push-notification providers

packages/hyperliquid
  typed market discovery, account data, actions, and boundary validation
              │
              ▼
Hyperliquid POST /info and /exchange APIs
```

The backend owns market-catalog discovery, expensive Portfolio fan-out, and
reliable alerts while the app is closed. Focused live prices, candles, books,
trades, and account-change signals use Hyperliquid WebSockets after the backend
has supplied the validated canonical market identity. REST establishes a
validated baseline and handles explicit reconciliation; it is not used as a
continuous polling transport. Signed exchange actions remain
device-to-Hyperliquid and never pass through the backend.

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

- Synchronize and publish the validated market catalog through a public,
  generation-pinned API
- Aggregate bounded live and historical Portfolio snapshots across the
  published catalog's perpetual DEXes
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
Data-source ownership, freshness, persistence, and stream consistency are
defined in [`data-access-and-caching.md`](data-access-and-caching.md).

## Trading trust boundary

Public market data may be read directly from the mobile device. Authenticated
exchange actions use a dedicated Hyperliquid API wallet, also called an agent
wallet. The API wallet signs on behalf of an approved master account or
sub-account; it is not the account identity used for portfolio queries.

The intended authorization and submission path is:

```text
master wallet connection → generate API wallet → master approves API wallet
                         → store scoped signer securely

order draft → human confirmation → authoritative market/account review
            → device authentication → API-wallet signature
            → selected-network exchange submission → verified response and reconciliation
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

- Run complete catalog discovery in the backend. The mobile app consumes only a
  validated published generation and has no direct catalog-discovery fallback.
- Discover perpetual DEXes and their universes from the current perpetual
  metadata endpoints; do not assume the first perpetual DEX is the complete
  universe.
- Discover spot pairs and token metadata from the current spot metadata
  endpoints. Preserve Hyperliquid's canonical asset identifiers separately from
  user-facing display names.
- Discover testnet outcome sides from `outcomeMeta` and preserve their outcome,
  side, coin, and order-asset encodings. Outcome sides remain browse-only until
  the runtime metadata supplies enough precision data to validate order input;
  the client never guesses lot or tick sizes.
- Read prices, order books, candles, funding, open interest, and tradability from
  the market-specific contexts exposed by Hyperliquid.
- Preserve delisted, isolated-only, margin-mode, precision, and maximum-leverage
  metadata. These constraints must drive the trade form and boundary validation.
- Keep featured, favorite, recent, and searched markets as presentation-layer
  views over the complete validated market catalog.

The catalog publication and failure policy is defined in
[`market-catalog-backend.md`](market-catalog-backend.md).

References: [Hyperliquid perpetual metadata](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals),
[spot metadata](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/spot),
[asset IDs](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/asset-ids),
and [exchange actions](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint).

## Network policy

- Public price display currently reads mainnet.
- Fresh application contexts default to mainnet.
- The chosen network must be visible anywhere an order can be signed.
- API-wallet authorization, storage, and nonce state are network-scoped and must
  never be silently reused across testnet and mainnet.
- The action implementation accepts either validated network. Mainnet signer
  access and transport remain controlled by the compile-owned release stage and
  require separate release evidence and safety review before public distribution.

## Security architecture contract

The repository has three enforced trust domains. `apps/mobile` owns native
lifecycle, OS key storage, the process-wide context epoch/action queue, and the
SQLite nonce journal. `packages/hyperliquid` owns transport-independent remote
validation, typed actions, exact protocol bytes, and repository ports. The
notification runtime may import only `@hyper-trader/hyperliquid/public`, a
dedicated `/info` and public-stream surface with no signer, action,
authenticated-account, or `/exchange` capability.

Normative detail lives in:

- [`api-wallet-custody.md`](api-wallet-custody.md): immutable local binding,
  SecureStore/session policy, authorization, replacement, loss, and unlink;
- [`action-lifecycle.md`](action-lifecycle.md): byte ownership, atomic
  nonce+journal reservation, write-once transport, and reconciliation; and
- [`notification-service.md`](notification-service.md): account ownership proof,
  push-key custody, retention, deletion races, and incidents.

The only state-changing path is:

```text
typed intent -> validation -> immutable review -> atomic nonce+journal
            -> codec bytes -> device signature -> durable submission marker
            -> one fixed-origin write -> authoritative reconciliation
```

Only the action codec owns signing bytes. Private keys, raw signatures, signing
preimages, canonical action bytes, and complete signed request bodies are
prohibited from durable storage, logs, analytics, crash reports, support bundles,
notification payloads, and backend requests.

## Compile-owned mainnet candidate gate

The current `candidate` source stage derives this compile-owned action
capability matrix:

```text
testnet: { signerAccess: true, exchangeTransport: true }
mainnet: { signerAccess: true, exchangeTransport: true }
```

The shared action entry point, mobile signer repository, nonce reservation, and
exchange transport check the capability appropriate to their boundary. A
mainnet context may use every currently implemented action after exact setup,
authoritative refresh, review, and explicit confirmation. Already-started
journal records remain eligible for signer-free, same-network reconciliation if
an incident build later disables new signer access and transport. Remote
configuration, backend responses, deep links, notifications, restored state,
environment variables, and debug menus cannot change the compiled capability.

`candidate` enables real mainnet submission. Public distribution additionally
binds the exact target-platform artifact to the automated aggregate and the
single release-owner preflight.

The network-generic implementation, migrations, and deterministic parity tests
are tracked in
[`../plans/2026-08-24-mainnet-trading-readiness.md`](../plans/2026-08-24-mainnet-trading-readiness.md).
Opening a private candidate requires one explicit reviewed source-line change
from `preactivation` to `candidate`; mainnet capability and the release action
runtime derive from that one value and cannot disagree. The automated
aggregate, target-device smoke test, artifact digest, and single release-owner
decision remain mandatory. Public release requires the final preflight for the
exact candidate artifact being submitted. See
[`../implementation/mainnet-release-preflight.md`](../implementation/mainnet-release-preflight.md).

## Fixed origins and release integrity

Hyperliquid clients use exact compile-owned origins:

| Network | HTTPS | WSS |
|---|---|---|
| Testnet | `https://api.hyperliquid-testnet.xyz` | `wss://api.hyperliquid-testnet.xyz/ws` |
| Mainnet | `https://api.hyperliquid.xyz` | `wss://api.hyperliquid.xyz/ws` |

Clients reject overrides, non-TLS schemes, alternate ports, userinfo, suffix
host matching, redirects, and TLS errors. Certificate pinning is not assumed.
The notification service has a separately configured exact HTTPS origin; clients
do not supply its base URL.

Signing-capable builds accept only signed EAS Updates. If update-code signing is
not configured and verified for the release channel, OTA is disabled and changes
ship in a new store build. Certificate rotation uses a new runtime version.
Dependency and lockfile changes, Reown configuration, and native config plugins
require provenance, permission, generated-native-diff, and credential review.
Update, Reown, TLS, push-provider, and notification-encryption credentials have
separate owners and exercised rotation paths.

The blocking gate is
[`../implementation/security-review.md`](../implementation/security-review.md).
