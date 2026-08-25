# Mobile crypto dependency patch

Hyper Trader applies one reproducible metadata patch to
`@noble/hashes@1.8.0`. The package is a transitive dependency of the mobile
signing graph. No cryptographic implementation is modified.

## Why the patch exists

Version 1.8.0 exposes `./crypto` and maps that browser entry to `./crypto.js`.
Metro 0.84 applies the browser redirect and then validates the redirected
`./crypto.js` path against the package export map. Because version 1.8.0 does
not list that spelling, Metro falls back to the same file and emits a package
exports warning during both iOS and Android production exports.

The committed Bun patch adds `./crypto.js` as an alias with exactly the same
Node, ESM, and default targets as the existing `./crypto` export. This makes the
already-selected target explicit to Metro. It does not change hash algorithms,
randomness, signing bytes, platform conditions, or runtime files.

The patch is stored at
`patches/@noble%2Fhashes@1.8.0.patch` and is bound through the root
`patchedDependencies` field and `bun.lock`. `scripts/release-contract.test.ts`
guards that binding and the narrow export-map-only diff.

## Verification and removal

For an immutable release revision, run the frozen install and both production
exports:

```sh
bun install --frozen-lockfile

IOS_OUT=$(mktemp -d /tmp/hyper-trader-ios-export.XXXXXX)
(cd apps/mobile && bunx expo export --platform ios --output-dir "$IOS_OUT")

ANDROID_OUT=$(mktemp -d /tmp/hyper-trader-android-export.XXXXXX)
(cd apps/mobile && bunx expo export --platform android --output-dir "$ANDROID_OUT")
```

Both exports must complete without the `@noble/hashes/crypto.js` package
exports warning. Record the output paths and artifact digests in the restricted
release evidence.

Remove the patch when the resolved dependency graph no longer contains
`@noble/hashes@1.8.0`, or when the resolved upstream version exports the browser
redirect target itself. Removal requires a frozen install, the full repository
verification, warning-free iOS and Android exports, and dependency-provenance
review.
