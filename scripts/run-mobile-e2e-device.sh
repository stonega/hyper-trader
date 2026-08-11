#!/usr/bin/env bash

set -euo pipefail

if [[ "${HT_E2E_DEVICE_ACK:-}" != "1" ]]; then
  echo "Refusing to claim device execution without HT_E2E_DEVICE_ACK=1." >&2
  echo "Use only a reviewed fixture build; see apps/mobile/e2e/README.md." >&2
  exit 2
fi

if [[ "${HT_E2E_FIXTURE_BUILD:-}" != "1" ]]; then
  echo "HT_E2E_FIXTURE_BUILD=1 is required to attest the installed build is fixture-only." >&2
  exit 2
fi

if [[ -z "${APP_ID:-}" ]]; then
  echo "APP_ID must identify the installed iOS bundle or Android application." >&2
  exit 2
fi

if ! command -v maestro >/dev/null 2>&1; then
  echo "Maestro CLI is unavailable; no device journey was run." >&2
  exit 2
fi

maestro test apps/mobile/e2e/flows
