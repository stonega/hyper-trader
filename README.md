# Hyper Trader

Hyper Trader is a mobile-first Hyperliquid client built as a Bun monorepo. The
starter app displays live perpetual-market mid prices through Hyperliquid's public
API and establishes the safety boundaries for adding wallet-backed trading.

## Stack

- Expo SDK 57 with Expo Router
- React Native 0.86 and TypeScript 6
- HeroUI Native with Uniwind and Tailwind CSS v4
- TanStack Query for server state
- Bun workspaces, tests, and package management
- Biome for formatting and linting

## Repository layout

```text
apps/mobile/             iOS and Android Expo app
packages/hyperliquid/    Typed public Hyperliquid API client
docs/                    Architecture, setup, and user documentation
examples/                Runnable package examples
scripts/                 Repository automation
postmortem/              Incident and learning records
```

## Start developing

Prerequisites: Bun 1.3.14 or newer and an Expo-compatible iOS Simulator or
Android Emulator.

```sh
bun install
bun run mobile
```

From the Expo terminal, press `i` for iOS or `a` for Android. You can also launch
a platform directly:

```sh
bun run mobile:ios
bun run mobile:android
```

HeroUI Native currently targets iOS and Android; web is intentionally not a
project target.

## Quality checks

```sh
bun run check
bun run typecheck
bun test
```

Or run the complete local gate:

```sh
./scripts/check.sh
```

## Current capabilities

- Fetch live prices from Hyperliquid's public `POST /info` endpoint using the
  `allMids` request.
- Show BTC, ETH, SOL, and HYPE mid prices with pull-to-refresh and background
  refresh.
- Switch between mainnet and testnet in the shared client configuration.
- Keep API response parsing and decimal price strings inside a reusable,
  deterministic package.

Authenticated trading is deliberately not enabled yet. Before order submission
is added, the project requires a reviewed key-custody design, testnet-first
signing, order validation, and an explicit confirmation screen.

## Documentation

- [Architecture](docs/design/architecture.md)
- [Local setup](docs/implementation/setup.md)
- [Safety and current app behavior](docs/user/getting-started.md)
- [HeroUI Native documentation](https://heroui.com/en/docs/native/getting-started/quick-start)
- [Hyperliquid API documentation](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api)
