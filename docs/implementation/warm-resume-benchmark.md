# Warm-resume benchmark contract

## Purpose

Measure whether a returning mobile user can interact with trustworthy cached
Trade content within one second of foreground resume. This document defines the
measurement harness only. It contains no physical-device results.

## Required build and cache state

- Use signed release builds for iOS and Android; development clients, Expo Go,
  simulators, and emulators are not performance evidence.
- Record commit SHA, runtime version, build profile, JavaScript engine, and
  whether an update bundle or embedded bundle ran.
- Populate the allowlisted public query cache by opening Trade online, waiting
  for a validated market catalog, mids, selected-market context, and candles,
  then backgrounding the app. Private account queries and mutations must not be
  present in the persisted record.
- Run the warm path by foregrounding the still-installed app. A terminated cold
  start and an empty-cache start are separate diagnostics, not warm-resume runs.
- Keep the selected market, public-cache age, network connection type, power
  mode, thermal state, and accessibility text-size setting constant across a
  comparison set.

## Baseline device record

Complete every field before collecting evidence:

| Field | iOS baseline | Android baseline |
|---|---|---|
| Device model | Pending selection | Pending selection |
| SoC / RAM | Pending selection | Pending selection |
| OS version and build | Pending selection | Pending selection |
| Free storage before run | Pending selection | Pending selection |
| Battery / low-power mode | Pending selection | Pending selection |
| Thermal state | Pending selection | Pending selection |
| Connection type and link | Pending selection | Pending selection |
| Release build identifier | Pending selection | Pending selection |

Changing a device, OS build, or release artifact starts a new evidence set.

## Markers and usable state

The mobile runtime emits these stable marker names:

- `hyper-trader:resume-started`: the native lifecycle reports active;
- `hyper-trader:public-cache-ready`: public cache restoration completes or
  safely falls back to a cold cache;
- `hyper-trader:usable-trade`: U4 marks the first committed Trade frame that has
  a selected valid market, trustworthy cached or fresh public content, and
  enabled scrolling/navigation. Account-only controls may remain locked.

The sample duration is `usable-trade - resume-started`. Cache restoration must
finish before a restored query refetch begins; `PersistQueryClientProvider`
owns that gate. U4 owns the final usable-Trade marker because U3 does not render
Trade.

## Run procedure

1. Verify the public cache is populated and record its age.
2. Background the app for the agreed interval.
3. Start a trace, foreground the app, and capture all three markers.
4. Confirm no private query or mutation appears in the persisted cache.
5. Record the duration and any missing-marker, crash, offline, or cache-removal
   anomaly. Do not replace a failed run silently.
6. Repeat at least 10 valid runs per baseline device. Run order should alternate
   iOS and Android when the lab permits.

Use `createWarmResumeSample` and `summarizeWarmResumeSamples` from
`apps/mobile/src/core/performance/warm-resume.ts` to produce deterministic p50,
p95, and maximum durations.

## Acceptance and evidence format

Report the run count, every raw duration, p50, p95, maximum, cache age range,
and anomalies. The warm-resume target passes only when the maximum valid run is
at most 1,000 ms on both agreed baseline devices. p50 and p95 remain diagnostic
and cannot hide a slower maximum. Missing markers, fewer than 10 valid runs, a
non-release build, or a changed baseline leaves the gate unverified.
