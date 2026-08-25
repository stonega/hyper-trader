# Mainnet release preflight

Mainnet authority has one compile-owned source stage in
`packages/hyperliquid/src/signing/boundary.ts`:

- `preactivation` compiles mainnet signer access, nonce reservation, the release
  action runtime, and exchange transport closed; and
- `candidate` compiles those boundaries open for one immutable, privately
  distributed release candidate.

`candidate` is not a public-release decision. There is no environment, remote
configuration, OTA, deep-link, callback, persisted-state, or UI override. The
same candidate binaries must pass the bounded canary and final release
preflight before distribution.

## Why the candidate precedes the canary

A mainnet canary cannot run in a build whose mainnet signing boundary is
compiled closed. The safe sequence is therefore:

1. Freeze a clean preactivation commit and complete its 28-row runtime and
   security evidence.
2. Complete physical iOS and Android custody checks, the disposable-agent
   testnet run, and all four independent approvals.
3. Create one direct child commit that changes only
   `MAINNET_TRADING_RELEASE_STAGE` from `preactivation` to `candidate`.
4. Build private iOS and Android release artifacts from that child commit.
5. Obtain a time-bounded canary authorization and pass the `candidate`
   preflight.
6. Run the canary on those private artifacts, reconcile every started action,
   externally revoke the disposable agent, and attach the redacted receipt.
7. Approve and pass the `release` preflight for the exact same commit, tree,
   iOS build, Android build, and evidence bundle. Do not rebuild after the
   canary.

Any other source change makes the candidate preflight fail. A required fix
starts again from a new preactivation commit and invalidates affected evidence.

## Evidence manifest

Generate the strict version-one template into a restricted evidence location,
not into the repository:

```sh
bun run mainnet:preflight template > /restricted/mainnet-release.json
```

The manifest stores opaque reviewer, operator, authorization, receipt, build,
and revision identifiers. Sensitive action bodies, keys, signatures, account
addresses, provider responses, and unrestricted logs belong only in the
restricted evidence system and must not be copied into the manifest.

The manifest binds:

- the preactivation parent commit, candidate commit, and candidate tree;
- exact iOS and Android build identifiers, artifact paths, and SHA-256 digests;
- one restricted evidence archive and its SHA-256 digest;
- all 28 closure IDs (`P1-P7`, `M1-M8`, `N1-N8`, and `R1-R5`);
- all four review roles;
- the approved disposable-agent testnet receipt;
- private-candidate authorization;
- mainnet-canary authorization, operator, stop owner, rollback owner, limits,
  execution window, and receipt; and
- the final release decision.

The physical iOS and Android custody rows (`M1` and `M2`) must pass and cannot
be marked not applicable. Other `not_applicable` decisions require an explicit
reason and remain reviewer-owned. M8 must include the frozen dependency graph,
the reviewed narrow noble-hashes export patch, and warning-free iOS and Android
production export receipts defined in
[`mobile-crypto-dependency-patch.md`](mobile-crypto-dependency-patch.md).

## Preflight commands

Every ordinary repository verification checks that the source capabilities are
internally consistent:

```sh
bun run check:mainnet-source
```

Before external evidence is complete, confirm that mainnet is still closed:

```sh
bun run mainnet:preflight preactivation
```

After creating and building the one-line private candidate, run:

```sh
bun run mainnet:preflight candidate /restricted/mainnet-release.json
```

The candidate command requires a clean worktree, an exact direct-parent
relationship, a one-line activation-only diff, matching commit/tree IDs,
matching artifact and evidence-bundle digests, 28 completed closure rows, four
approvals, a passed disposable-agent testnet run, an approved private-candidate
decision, a currently valid canary authorization, and a release decision of
`stop`.

After the canary, update only the external manifest and restricted evidence
bundle. Do not change or rebuild the candidate. Then run:

```sh
bun run mainnet:preflight release /restricted/mainnet-release.json
```

The release command additionally requires a passing canary receipt within the
authorized window and a later final `approved` decision.

## Canary ceiling

The verifier refuses an authorization broader than all of these limits:

- cumulative notional: USD 100;
- simultaneously open notional: USD 50;
- open orders: one;
- leverage: 2x;
- duration: 30 minutes; and
- permitted actions: limit order, cancel, and reduce-only close only.

The operator may authorize stricter limits. Market orders and leverage changes
are not part of the canary permission set. The app's ordinary explicit review,
device authentication, exact binding, authoritative refresh, nonce/journal,
one-shot transport, and reconciliation protections remain mandatory.
The manifest does not remotely configure the app or enforce these limits at
runtime. The operator must make the ceiling real through the separately
authorized procedure, minimally funded disposable authority, selected market,
and continuous stop-owner supervision; inability to enforce a stated bound is a
stop, not an exception.

## Scope and rollback

The preflight proves repository stage consistency, manifest completeness,
revision ancestry, activation-diff minimality, and local file digests. It does
not manufacture reviewer judgment, physical-device results, exchange results,
artifact-signing provenance, or distribution authorization. Those remain
external evidence.

Before public distribution, rollback means keep the candidate private, revoke
its API wallet externally, reconcile started actions, and return the source
stage to `preactivation` on a new revision. After distribution, the incident
owner stops new signing through the documented release/incident process;
signer-free reconciliation and exact credential deletion remain available.

There is intentionally no command-line mainnet submission script. The canary
uses the reviewed mobile candidate so it exercises the real custody,
confirmation, lifecycle, journal, and recovery boundaries.
