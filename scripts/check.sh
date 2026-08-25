#!/usr/bin/env bash

set -euo pipefail

bun run check
bun run typecheck
bun test
bun run test:mobile
bun run test:notifications
bun run test:e2e:mobile
bun run check:mainnet-source
bun run check:secrets
