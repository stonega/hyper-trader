# Mainnet trading readiness plan

## Objective

Make Hyper Trader capable of submitting reviewed Hyperliquid mainnet actions
without weakening the existing custody, context, nonce, journal, one-shot
transport, or reconciliation guarantees. Testnet and mainnet authority remain
strictly isolated. A release build may expose mainnet submission only after the
external evidence and approval gate in this plan is complete.

## Baseline and implementation state

The baseline shared protocol package already modeled both Hyperliquid networks,
fixed network origins, L1 source-domain separation, and network-scoped signer
bindings. This change generalizes mobile setup, protected custody manifests,
signer sessions, authoritative refresh, Trade, Portfolio, runtime composition,
and signer-free reconciliation to the exact selected network. Legacy testnet
setup rows migrate in place to the network-generic schema.

The current worktree is deliberately open for private mainnet functional
testing:

- `MAINNET_TRADING_RELEASE_STAGE` is `candidate`;
- mainnet signer access, exchange transport, and the release action runtime are
  all derived from that single compile-owned stage and are true; and
- mainnet public reads, protected-key access, nonce reservation, signing,
  fixed-origin `/exchange` submission, and same-network reconciliation are
  available to exact authorized contexts.

The testnet security-closure record remains conditional. Mainnet approval is
not inferred from deterministic tests, testnet evidence, this implementation,
or the dirty functional-testing worktree. Public distribution remains stopped.

## Non-negotiable mainnet invariants

1. A mainnet secret is generated and authorized specifically for one immutable
   `(mainnet, master, target, agent, generation)` binding. Testnet authority is
   never reusable.
2. The selected network is visible at draft, review, authentication, status,
   and result boundaries. A network change invalidates the complete action.
3. Mainnet capability is compile-owned. Environment variables, remote config,
   OTA, deep links, callbacks, restored state, and UI state cannot enable it.
4. Every action performs authoritative mainnet market, account, registration,
   and server-time refresh before protected key access.
5. Nonce reservation and the immutable journal record commit atomically before
   signing. `submission_started` commits before the only transport write.
6. An unresolved request is reconciled on the same network and is never
   submitted again.
7. Mainnet private keys, signatures, canonical bytes, signed envelopes, and
   complete provider responses remain memory-only and are never logged.
8. Mainnet release activation requires an immutable build, independent
   protocol and mobile-security approval, physical-device custody evidence, a
   disposable-agent testnet run, and a separately authorized low-risk mainnet
   canary with a rollback owner.

## Delivery plan

### M0 — Freeze the contract

- [x] Record the current mainnet capability and testnet-only call sites.
- [x] Confirm current official exchange-envelope, API-wallet, nonce, and network
  signing-domain behavior.
- [ ] Assign protocol, mobile-security, release, and incident owners for the
  immutable evidence revision.

### M1 — Generalize compile-owned capabilities

- [x] Replace testnet-named signing helpers with network-generic action
  capability checks and signing functions.
- [x] Keep signer access and exchange transport as separate capability checks at
  validation, custody, nonce, signing, and transport boundaries; reconciliation
  is intentionally signer-free.
- [x] Add exhaustive mainnet/testnet capability and domain-separation tests.

### M2 — Network-scoped API-wallet custody and setup

- [x] Generalize setup attempts, repository rows, protected credential records,
  manual authorization, activation, replacement, and account-context recovery
  to `HyperliquidNetwork`.
- [x] Ensure generation counters, SecureStore keys, tombstones, and nonce scopes
  include the network.
- [x] Make the manual authorization handoff and authoritative registration query
  use the selected network's fixed official endpoints.
- [x] Add cross-network substitution, legacy restore, setup, custody, nonce, and
  reconciliation tests. Destructive rotation remains release-gated for both
  networks and is not presented as available.

### M3 — Network-generic signer and action runtime

- [x] Sign the payload network captured by the exact binding; never synthesize
  `testnet` inside the session.
- [x] Replace the development-only composition with a release-capable provider
  whose availability is derived exclusively from compile-owned capabilities
  and an active exact binding.
- [x] Preserve lifecycle locking, late-result fences, and process-wide action
  serialization for both networks.

### M4 — Trade, Portfolio, refresh, transport, and reconciliation

- [x] Permit a supported network only when its signer and transport capabilities
  are both compiled true.
- [x] Use the review binding's network for catalog/account refresh, server-time
  sampling, exchange submission, reconciliation, restart recovery, and cache
  publication.
- [x] Reject any client, journal, signer, target, or evidence network mismatch
  before secret access or transport.
- [x] Preserve HIP-3 family gates and unsupported-action denial independently on
  each network.

### M5 — Mainnet user experience and operational safety

- [x] Add explicit Mainnet labeling and a high-signal first-use warning without
  adding a redundant confirmation to every action.
- [x] Keep account setup, active signer, balances, positions, drafts, and action
  results visibly network-scoped.
- [x] Provide an incident stop that disables new mainnet signing while retaining
  signer-free reconciliation for already-started actions.
- [x] Document emergency external agent revocation and rollback ownership.

### M6 — Deterministic verification

- [x] Add official mainnet/testnet vectors for approval and every enabled action
  family, including distinct domains/hashes and recovered addresses.
- [x] Cover network-generic accepted/rejected/expired/response-loss/restart and
  no-duplicate behavior, plus same-network mainnet reconciliation with injected
  fixed-origin clients. Mainnet submission itself remains unreachable while the
  compile-owned capability is false.
- [x] Cover mainnet/testnet authority substitution at signer, custody, setup,
  nonce, refresh, client, journal, and evidence boundaries.
- [x] Run formatting, strict types, offline tests, native tests, secret scans,
  exports, and the production aggregate on the current working tree. M7 repeats
  them on the immutable release revision.
- [x] Make activation a one-line direct-child source change and add a strict
  preflight that binds all 28 closure rows, four approvals, commit/tree IDs,
  iOS/Android build IDs and artifact digests, the restricted evidence digest,
  canary authorization/limits, and final decision.

### M7 — External release evidence and activation

- [ ] Close the existing 28-row testnet runtime/security evidence revision.
- [ ] Complete physical iOS and Android mainnet custody matrices on release
  artifacts.
- [ ] Obtain independent protocol/signing and mobile-security approval for the
  exact mainnet revision.
- [ ] Run the approved disposable-agent testnet sequence and review redacted
  evidence.
- [ ] From the frozen preactivation commit, make the one-line direct-child stage
  change to `candidate`; build private iOS/Android artifacts; then pass the
  candidate preflight with a current, separately approved bounded-canary
  authorization.
- [ ] Run the canary on those private artifacts, verify reconciliation and
  external revocation, record rollback readiness, then pass the release
  preflight only after every required row is signed and the final decision is
  `approved` for the same commit, tree, artifacts, and build IDs.

## Definition of ready

The codebase is mainnet-capable when M1-M6 pass on an immutable revision while
the mainnet release capability remains closed. Mainnet is release-ready only
when M7 is complete and the final preflight passes for the same candidate that
ran the canary. The compile-owned capability is opened only in the private
candidate by the one-line reviewed direct-child source change; public
distribution remains stopped until the canary and final decision complete.
Until that private-candidate boundary is authorized, public mainnet data remains
available but mainnet signer access and `/exchange` submission must fail closed.

The executable manifest contract and exact operator sequence are documented in
[`mainnet-release-preflight.md`](../implementation/mainnet-release-preflight.md).
