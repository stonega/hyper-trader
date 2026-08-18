# Hyper Trader

Hyper Trader is a native iOS and Android Hyperliquid client built as a Bun
monorepo. It provides runtime market discovery, Trade and Portfolio workflows,
target-scoped testnet action boundaries, account/security controls, and a
portable notification service while keeping live integration behind explicit
release gates.

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
bun run test:mobile
bun run test:e2e:mobile
bun run check:secrets
```

Or run the complete local gate:

```sh
./scripts/check.sh
```

`test:e2e:mobile` validates deterministic fixture contracts only. See
[`apps/mobile/e2e/README.md`](apps/mobile/e2e/README.md) before any device run.

## Current capabilities

- Discover validated native perpetual, HIP-3, spot, and outcome-market metadata
  at runtime with safe stale/offline/quarantine presentation.
- Provide the four-tab native shell, read-only onboarding, progressive Trade,
  unified Portfolio, multi-account settings, and safe notification entry.
- Keep protocol parsing, action validation/encoding, mainnet denial, target
  binding, nonce/reconciliation rules, and public-only notification imports at
  typed boundaries with deterministic offline tests.
- Run the portable Bun/PostgreSQL notification monitor and outbox integration
  suite against ephemeral dependencies with Hyperliquid and Expo mocked.

Live wallet approval and testnet submission remain disabled until the conditional
security review becomes unconditional for one release revision. Mainnet signing
and submission are compile-denied and have no enablement path.

## Documentation

- [Architecture](docs/design/architecture.md)
- [Local setup](docs/implementation/setup.md)
- [Release evidence](docs/implementation/release-evidence.md)
- [Safety and current app behavior](docs/user/getting-started.md)
- [HeroUI Native documentation](https://heroui.com/en/docs/native/getting-started/quick-start)
- [Hyperliquid API documentation](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api)
