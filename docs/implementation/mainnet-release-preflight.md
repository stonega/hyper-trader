# Mainnet release preflight

Mainnet authority has one compile-owned source stage in
`packages/hyperliquid/src/signing/boundary.ts`:

- `preactivation` compiles mainnet signer access, nonce reservation, release
  action runtime, and exchange transport closed; and
- `candidate` compiles those boundaries open for an immutable release build.

The release process is designed for a single accountable maintainer. It trusts
the repository's deterministic checks and exact artifact digests instead of
requiring separate human reviewers. The runtime safeguards remain unchanged:
the API-wallet secret stays on the user's device, every action requires explicit
confirmation and device authentication, and uncertain submissions enter
signer-free reconciliation without an automatic retry.

## Release sequence

1. Keep the source stage at `preactivation` while changing or verifying code.
2. Run `./scripts/check.sh` on a clean commit.
3. Create one direct child commit that changes only
   `MAINNET_TRADING_RELEASE_STAGE` from `preactivation` to `candidate`.
4. Build the target-platform release artifact from that exact candidate.
5. Record its build ID and SHA-256 digest in the version-two manifest.
6. Approve the exact candidate as the release owner and run the candidate
   preflight. The preflight reruns `./scripts/check.sh` itself.
7. Smoke-test the release artifact on the target platform, set the release
   decision to `approved`, and run the release preflight for the same artifact.
8. Submit that verified artifact without rebuilding it.

Any source change after step 3 invalidates the candidate. Make the fix with the
stage returned to `preactivation`, commit it, and create a new one-line candidate
child.

## Manifest

Generate the strict template outside the repository:

```sh
bun run mainnet:preflight template > /restricted/mainnet-release.json
```

The manifest binds:

- the preactivation parent, candidate commit, and candidate tree;
- one or more target-platform build IDs, artifact paths, and SHA-256 digests;
- the exact aggregate verification command and its receipt;
- the single release owner's private-candidate decision; and
- the final distribution decision.

One Android artifact is sufficient for a Google Play release. One iOS artifact
is sufficient for an App Store release. If both platforms are shipped, include
both artifacts; build IDs, platforms, and paths must be unique.

The manifest contains only opaque identifiers and digests. Private keys,
signatures, signing payloads, account addresses, provider responses, and
unrestricted logs must never be copied into it.

## Commands

Every ordinary repository verification checks that source capabilities are
internally consistent:

```sh
bun run check:mainnet-source
```

Confirm the fail-closed source state before creating a candidate:

```sh
bun run mainnet:preflight preactivation
```

Validate the private candidate and its artifact:

```sh
bun run mainnet:preflight candidate /restricted/mainnet-release.json
```

The candidate command requires a clean worktree, an exact direct-parent
relationship, a one-line activation-only diff, matching commit/tree IDs,
matching artifact digests, a recorded passing aggregate verification, and the
release owner's candidate approval. The distribution decision remains `stop`.

After smoke-testing the same artifact, change only the external manifest's final
decision and run:

```sh
bun run mainnet:preflight release /restricted/mainnet-release.json
```

The release command requires the same release owner, an `approved` distribution
decision, the same immutable artifact, and a fresh successful execution of
`./scripts/check.sh`.

## What the preflight proves

The preflight verifies repository stage consistency, revision ancestry,
activation-diff minimality, strict manifest shape, target-artifact digests, and
the current automated test/lint/type/security aggregate. It does not claim that
a local API-wallet key is a server-held asset: Hyper Trader is non-custodial and
the secret remains on the user's device.

Operational recovery is implemented as ordinary product behavior rather than a
separate approval role. New signing can be disabled in source, the user can
delete or externally revoke an API wallet, and already-started journal records
remain available for signer-free reconciliation.
