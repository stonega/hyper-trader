# Mobile release journeys

`bun run test:e2e:mobile` validates the committed Maestro journey contracts
without starting an app or contacting Hyperliquid, Expo Push, APNs, FCM, or a
wallet provider. Passing that command is static fixture evidence only.

The flows require a separately reviewed, locally installed fixture build that
implements the `HT_E2E_FIXTURE` launch argument. That build must use synthetic
accounts and deterministic public/account/action/notification adapters, keep
mainnet signer and exchange capabilities false, and make every exchange
transport a recording fake. A production or live-testnet build is not a fixture
build. This repository does not currently contain the native fixture adapter or
a reviewable fixture-build artifact, so device execution remains a release gate
rather than locally observed evidence.

After the fixture artifact is reviewed and installed on the selected simulator
or physical device, run:

```sh
APP_ID=com.example.reviewed.fixture \
HT_E2E_DEVICE_ACK=1 \
HT_E2E_FIXTURE_BUILD=1 \
bun run test:e2e:mobile:device
```

Record platform, OS, device model, build ID, runtime version, commit, fixture
revision, Maestro version, start/end time, and the per-flow result. Never set the
acknowledgement variables merely to make the command pass.

The flows intentionally stop at review, recovery, or authoritative safe-entry
state. They never confirm an exchange action, unlock a real signer, or treat a
notification payload as authority.
