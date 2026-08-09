# Local setup

## Install

Use Bun from the repository root so workspace links resolve consistently:

```sh
bun install
```

The workspace contains `apps/*` and `packages/*`. The mobile app references
`@hyper-trader/hyperliquid` with `workspace:*`; it never resolves a registry
package with the same name.

## Run the mobile app

```sh
bun run mobile
```

Use an iOS Simulator or Android Emulator. HeroUI Native is not used for Expo web.
If native dependency resolution changes, clear Metro once:

```sh
bun --cwd apps/mobile start --clear
```

## HeroUI Native and Uniwind

The official HeroUI Native scaffold provides the required peer versions.

- `apps/mobile/src/global.css` imports Tailwind CSS, Uniwind, and HeroUI styles.
- `apps/mobile/metro.config.js` keeps `withUniwindConfig` as the outermost Metro
  wrapper.
- `apps/mobile/src/app/_layout.tsx` keeps `GestureHandlerRootView` outermost and
  installs `HeroUINativeProvider` directly below it.
- Imports use granular paths such as `heroui-native/card` consistently to retain
  bundle-size optimization.

When adding a HeroUI component, fetch its current Native documentation before
implementation and follow its compound anatomy.

## Hyperliquid client

The shared package exposes `createHyperliquidClient`. It accepts a network and an
optional `fetch` implementation for deterministic tests.

```ts
const client = createHyperliquidClient({ network: "testnet" });
const markets = await client.getAllMids();
```

Prices remain decimal strings in the package. Presentation code may format them,
but trading math must eventually use a decimal-safe representation rather than
binary floating point.

## Verification

```sh
./scripts/check.sh
```

The script runs Biome checks, all workspace type checks, and Bun tests.
