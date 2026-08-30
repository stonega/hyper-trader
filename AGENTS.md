# AGENTS.md

This document defines how AI agents should work in the Hyper Trader repository.

## Project Structure

Hyper Trader is a Bun monorepo:

```text
apps/mobile/             Expo mobile application
packages/hyperliquid/    Typed Hyperliquid API client and domain logic
docs/design/             Architecture and product design
docs/implementation/     Technical implementation notes
docs/user/               End-user documentation
examples/                Runnable API and workflow examples
scripts/                 Idempotent repository automation
postmortem/              Incident reports and retrospectives
```

Keep deployable applications in `apps/` and reusable code in `packages/`.

## Development Workflow

Before implementing a feature:

1. Read the relevant files in `docs/design/` and `docs/implementation/`.
2. Keep UI and platform integration inside `apps/mobile`.
3. Keep transport-independent Hyperliquid API and domain logic inside
   `packages/hyperliquid`.
4. Add deterministic tests beside the package or feature they cover.
5. Update documentation whenever architecture, APIs, or workflows change.

## Commands

Run commands from the repository root unless noted otherwise:

```sh
bun install
bun run mobile
bun run check
bun run typecheck
bun test
```

Run EAS and native Expo commands from `apps/mobile`.

## Coding Rules

- Use TypeScript with strict type checking.
- Keep functions small, composable, and explicit at trust boundaries.
- Prefer readability over cleverness and avoid duplication.
- Use Biome for formatting and linting.
- Do not introduce frameworks or runtime dependencies without documenting why.
- Use workspace dependencies (`workspace:*`) for internal packages.

## Mobile UI Rules

- Act as an experienced decentralized-exchange product manager. Continuously
  reduce unnecessary steps, inputs, screens, controls, and explanatory copy to
  improve the user experience. Every visible element and required action must
  have a clear user-facing purpose; do not expose internal architecture,
  defensive implementation details, or future functionality as UI.
- Use HeroUI Native, never HeroUI React web components.
- Fetch current HeroUI Native component documentation before using a component.
- Use Uniwind/Tailwind CSS v4 classes and semantic theme tokens.
- Use HeroUI compound component anatomy and React Native `onPress` handlers.
- Never nest a card inside another card. Use spacing, dividers, buttons, or rows
  to structure content within the parent card.
- Minimize required user input. Do not ask for values the app can safely derive,
  retrieve, or supply with a stable default, and do not add redundant actions
  for those values. Keep explicit review and confirmation at security-sensitive
  boundaries.
- Keep `GestureHandlerRootView` outermost and `HeroUINativeProvider` directly
  beneath it.
- Target iOS and Android. HeroUI Native web support is not a project target.

## Trading and Security Rules

- Default to Hyperliquid testnet for any authenticated or state-changing flow.
- Never commit private keys, seed phrases, API wallet keys, or signing payloads.
- Never log secrets or complete signed actions.
- Keep public market-data reads separate from authenticated exchange actions.
- Require an explicit confirmation UI before submitting an order.
- Validate network, market, price, size, leverage, and slippage at the boundary.
- Do not add live order submission until the signing and key-custody design is
  documented and reviewed.

## Testing Requirements

- Add unit tests for API parsing and domain logic.
- Add integration tests for workflows without relying on the live exchange.
- Keep fixtures deterministic and avoid network calls in the default test suite.
- Run formatting, linting, type checks, and tests before finishing a change.

## Documentation and Examples

- Architecture belongs in `docs/design/`.
- Technical setup belongs in `docs/implementation/`.
- User-facing instructions belong in `docs/user/`.
- New APIs and workflows require a runnable example in `examples/`.
- Automation in `scripts/` must be safe and idempotent.

## Safety

Preserve existing work. Do not delete large sections, restructure the repository,
or modify dependencies without a clear task-related reason. Never weaken trading
safety checks merely to make a test or demo pass.
