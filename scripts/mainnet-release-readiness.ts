import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { RELEASE_ACTION_RUNTIME_ENABLED } from "../apps/mobile/src/features/actions/development-capability";
import {
  ACTION_CAPABILITIES,
  MAINNET_TRADING_RELEASE_STAGE,
  type MainnetTradingReleaseStage,
} from "../packages/hyperliquid/src/signing/boundary";

export const MAINNET_RELEASE_PLATFORMS = ["ios", "android"] as const;

type MainnetReleasePlatform = (typeof MAINNET_RELEASE_PLATFORMS)[number];
type ApprovalDecision = "pending" | "approved";
type PassDecision = "pending" | "pass";

export interface MainnetArtifactReference {
  readonly platform: MainnetReleasePlatform;
  readonly buildId: string;
  readonly path: string;
  readonly sha256: string;
}

export interface MainnetReleaseEvidenceManifest {
  readonly schemaVersion: 2;
  readonly evidenceRevision: string;
  readonly revision: {
    readonly preactivationCommitSha: string;
    readonly candidateCommitSha: string;
    readonly candidateTreeSha: string;
  };
  readonly artifacts: readonly MainnetArtifactReference[];
  readonly automatedVerification: {
    readonly command: "./scripts/check.sh";
    readonly decision: PassDecision;
    readonly completedAt: string;
    readonly receiptId: string;
  };
  readonly releaseOwner: {
    readonly ownerId: string;
    readonly candidateDecision: ApprovalDecision;
    readonly decidedAt: string;
    readonly receiptId: string;
  };
  readonly releaseDecision: {
    readonly decision: "stop" | "approved";
    readonly ownerId: string;
    readonly decidedAt: string;
    readonly receiptId: string;
  };
}

export interface MainnetSourceCapabilitySnapshot {
  readonly releaseStage: MainnetTradingReleaseStage;
  readonly releaseRuntimeEnabled: boolean;
  readonly mainnetSignerAccess: boolean;
  readonly mainnetExchangeTransport: boolean;
  readonly testnetSignerAccess: boolean;
  readonly testnetExchangeTransport: boolean;
}

type JsonObject = Record<string, unknown>;

function fail(path: string, message: string): never {
  throw new Error(`${path}: ${message}`);
}

function object(value: unknown, path: string): JsonObject {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail(path, "expected an object");
  }
  return value as JsonObject;
}

function exactKeys(
  value: JsonObject,
  expected: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    fail(path, `expected exactly ${wanted.join(", ")}`);
  }
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function textValue(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    hasControlCharacter(value)
  ) {
    fail(path, "expected bounded non-control text");
  }
  return value;
}

function identifier(value: unknown, path: string): string {
  const parsed = textValue(value, path);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{1,127}$/u.test(parsed)) {
    fail(path, "expected an opaque identifier");
  }
  return parsed;
}

function sha256(value: unknown, path: string): string {
  const parsed = textValue(value, path);
  if (!/^[0-9a-f]{64}$/u.test(parsed)) {
    fail(path, "expected a lowercase SHA-256 digest");
  }
  return parsed;
}

function gitSha(value: unknown, path: string): string {
  const parsed = textValue(value, path);
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(parsed)) {
    fail(path, "expected a lowercase Git object ID");
  }
  return parsed;
}

function isoTime(value: unknown, path: string): string {
  const parsed = textValue(value, path);
  const timestamp = Date.parse(parsed);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== parsed
  ) {
    fail(path, "expected a canonical UTC ISO-8601 timestamp");
  }
  return parsed;
}

function enumValue<const T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    fail(path, `expected one of ${allowed.join(", ")}`);
  }
  return value as T;
}

function parseArtifact(
  value: unknown,
  index: number,
): MainnetArtifactReference {
  const path = `manifest.artifacts[${index}]`;
  const source = object(value, path);
  exactKeys(source, ["platform", "buildId", "path", "sha256"], path);
  return {
    platform: enumValue(
      source.platform,
      MAINNET_RELEASE_PLATFORMS,
      `${path}.platform`,
    ),
    buildId: identifier(source.buildId, `${path}.buildId`),
    path: textValue(source.path, `${path}.path`),
    sha256: sha256(source.sha256, `${path}.sha256`),
  };
}

export function parseMainnetReleaseEvidenceManifest(
  value: unknown,
): MainnetReleaseEvidenceManifest {
  const source = object(value, "manifest");
  exactKeys(
    source,
    [
      "schemaVersion",
      "evidenceRevision",
      "revision",
      "artifacts",
      "automatedVerification",
      "releaseOwner",
      "releaseDecision",
    ],
    "manifest",
  );
  if (source.schemaVersion !== 2) {
    fail("manifest.schemaVersion", "expected 2");
  }

  const revision = object(source.revision, "manifest.revision");
  exactKeys(
    revision,
    ["preactivationCommitSha", "candidateCommitSha", "candidateTreeSha"],
    "manifest.revision",
  );
  if (!Array.isArray(source.artifacts) || source.artifacts.length === 0) {
    fail("manifest.artifacts", "expected at least one platform artifact");
  }
  const automatedVerification = object(
    source.automatedVerification,
    "manifest.automatedVerification",
  );
  exactKeys(
    automatedVerification,
    ["command", "decision", "completedAt", "receiptId"],
    "manifest.automatedVerification",
  );
  if (automatedVerification.command !== "./scripts/check.sh") {
    fail(
      "manifest.automatedVerification.command",
      "expected ./scripts/check.sh",
    );
  }
  const releaseOwner = object(source.releaseOwner, "manifest.releaseOwner");
  exactKeys(
    releaseOwner,
    ["ownerId", "candidateDecision", "decidedAt", "receiptId"],
    "manifest.releaseOwner",
  );
  const releaseDecision = object(
    source.releaseDecision,
    "manifest.releaseDecision",
  );
  exactKeys(
    releaseDecision,
    ["decision", "ownerId", "decidedAt", "receiptId"],
    "manifest.releaseDecision",
  );

  return {
    schemaVersion: 2,
    evidenceRevision: identifier(
      source.evidenceRevision,
      "manifest.evidenceRevision",
    ),
    revision: {
      preactivationCommitSha: gitSha(
        revision.preactivationCommitSha,
        "manifest.revision.preactivationCommitSha",
      ),
      candidateCommitSha: gitSha(
        revision.candidateCommitSha,
        "manifest.revision.candidateCommitSha",
      ),
      candidateTreeSha: gitSha(
        revision.candidateTreeSha,
        "manifest.revision.candidateTreeSha",
      ),
    },
    artifacts: source.artifacts.map(parseArtifact),
    automatedVerification: {
      command: "./scripts/check.sh",
      decision: enumValue(
        automatedVerification.decision,
        ["pending", "pass"],
        "manifest.automatedVerification.decision",
      ),
      completedAt: isoTime(
        automatedVerification.completedAt,
        "manifest.automatedVerification.completedAt",
      ),
      receiptId: identifier(
        automatedVerification.receiptId,
        "manifest.automatedVerification.receiptId",
      ),
    },
    releaseOwner: {
      ownerId: identifier(
        releaseOwner.ownerId,
        "manifest.releaseOwner.ownerId",
      ),
      candidateDecision: enumValue(
        releaseOwner.candidateDecision,
        ["pending", "approved"],
        "manifest.releaseOwner.candidateDecision",
      ),
      decidedAt: isoTime(
        releaseOwner.decidedAt,
        "manifest.releaseOwner.decidedAt",
      ),
      receiptId: identifier(
        releaseOwner.receiptId,
        "manifest.releaseOwner.receiptId",
      ),
    },
    releaseDecision: {
      decision: enumValue(
        releaseDecision.decision,
        ["stop", "approved"],
        "manifest.releaseDecision.decision",
      ),
      ownerId: identifier(
        releaseDecision.ownerId,
        "manifest.releaseDecision.ownerId",
      ),
      decidedAt: isoTime(
        releaseDecision.decidedAt,
        "manifest.releaseDecision.decidedAt",
      ),
      receiptId: identifier(
        releaseDecision.receiptId,
        "manifest.releaseDecision.receiptId",
      ),
    },
  };
}

function assertNotFuture(value: string, nowMs: number, path: string): void {
  if (Date.parse(value) > nowMs) fail(path, "must not be in the future");
}

export function assertEvidenceStage(
  stage: "candidate" | "release",
  manifest: MainnetReleaseEvidenceManifest,
  nowMs = Date.now(),
): void {
  const artifactPlatforms = manifest.artifacts.map(({ platform }) => platform);
  if (new Set(artifactPlatforms).size !== artifactPlatforms.length) {
    fail("manifest.artifacts", "each platform may appear at most once");
  }
  const buildIds = manifest.artifacts.map(({ buildId }) => buildId);
  if (new Set(buildIds).size !== buildIds.length) {
    fail("manifest.artifacts", "build IDs must be distinct");
  }
  if (manifest.automatedVerification.decision !== "pass") {
    fail(
      "manifest.automatedVerification.decision",
      "the complete automated check must pass",
    );
  }
  assertNotFuture(
    manifest.automatedVerification.completedAt,
    nowMs,
    "manifest.automatedVerification.completedAt",
  );
  if (manifest.releaseOwner.candidateDecision !== "approved") {
    fail(
      "manifest.releaseOwner.candidateDecision",
      "the release owner must approve the exact private candidate",
    );
  }
  if (
    Date.parse(manifest.releaseOwner.decidedAt) <
    Date.parse(manifest.automatedVerification.completedAt)
  ) {
    fail(
      "manifest.releaseOwner.decidedAt",
      "must follow automated verification",
    );
  }
  assertNotFuture(
    manifest.releaseOwner.decidedAt,
    nowMs,
    "manifest.releaseOwner.decidedAt",
  );
  if (manifest.releaseDecision.ownerId !== manifest.releaseOwner.ownerId) {
    fail(
      "manifest.releaseDecision.ownerId",
      "must match the candidate release owner",
    );
  }

  if (stage === "candidate") {
    if (manifest.releaseDecision.decision !== "stop") {
      fail(
        "manifest.releaseDecision.decision",
        "must remain stop while validating the private candidate",
      );
    }
    return;
  }

  if (manifest.releaseDecision.decision !== "approved") {
    fail(
      "manifest.releaseDecision.decision",
      "the release owner must approve public distribution",
    );
  }
  if (
    Date.parse(manifest.releaseDecision.decidedAt) <
    Date.parse(manifest.releaseOwner.decidedAt)
  ) {
    fail(
      "manifest.releaseDecision.decidedAt",
      "must follow private-candidate approval",
    );
  }
  assertNotFuture(
    manifest.releaseDecision.decidedAt,
    nowMs,
    "manifest.releaseDecision.decidedAt",
  );
}

export function currentMainnetSourceCapabilitySnapshot(): MainnetSourceCapabilitySnapshot {
  return {
    releaseStage: MAINNET_TRADING_RELEASE_STAGE,
    releaseRuntimeEnabled: RELEASE_ACTION_RUNTIME_ENABLED,
    mainnetSignerAccess: ACTION_CAPABILITIES.mainnet.signerAccess,
    mainnetExchangeTransport: ACTION_CAPABILITIES.mainnet.exchangeTransport,
    testnetSignerAccess: ACTION_CAPABILITIES.testnet.signerAccess,
    testnetExchangeTransport: ACTION_CAPABILITIES.testnet.exchangeTransport,
  };
}

export function assertSourceCapabilityConsistency(
  snapshot: MainnetSourceCapabilitySnapshot,
): void {
  const candidate = snapshot.releaseStage === "candidate";
  if (
    snapshot.releaseRuntimeEnabled !== candidate ||
    snapshot.mainnetSignerAccess !== candidate ||
    snapshot.mainnetExchangeTransport !== candidate
  ) {
    fail(
      "source.capability",
      "release runtime, signer access, and exchange transport must derive from one release stage",
    );
  }
  if (!snapshot.testnetSignerAccess || !snapshot.testnetExchangeTransport) {
    fail("source.capability.testnet", "testnet actions must remain compiled");
  }
}

function git(repositoryRoot: string, args: readonly string[]): string {
  const result = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd: repositoryRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    fail("repository.git", `command failed: git ${args.join(" ")}`);
  }
  return new TextDecoder().decode(result.stdout).trim();
}

export function assertCandidateRevision(input: {
  readonly repositoryRoot: string;
  readonly manifest: MainnetReleaseEvidenceManifest;
}): void {
  const status = git(input.repositoryRoot, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  if (status !== "") {
    fail(
      "repository.status",
      "candidate verification requires a clean worktree",
    );
  }
  const head = git(input.repositoryRoot, ["rev-parse", "HEAD"]);
  const tree = git(input.repositoryRoot, ["rev-parse", "HEAD^{tree}"]);
  const parent = git(input.repositoryRoot, ["rev-parse", "HEAD^"]);
  const parents = git(input.repositoryRoot, [
    "rev-list",
    "--parents",
    "-n",
    "1",
    "HEAD",
  ])
    .split(" ")
    .filter(Boolean);
  if (parents.length !== 2) {
    fail("repository.activationDiff", "candidate must not be a merge commit");
  }
  if (head !== input.manifest.revision.candidateCommitSha) {
    fail("manifest.revision.candidateCommitSha", "does not match HEAD");
  }
  if (tree !== input.manifest.revision.candidateTreeSha) {
    fail("manifest.revision.candidateTreeSha", "does not match HEAD tree");
  }
  if (parent !== input.manifest.revision.preactivationCommitSha) {
    fail(
      "manifest.revision.preactivationCommitSha",
      "must be the candidate commit's direct parent",
    );
  }

  const capabilityPath = "packages/hyperliquid/src/signing/boundary.ts";
  const changedPaths = git(input.repositoryRoot, [
    "diff",
    "--name-only",
    `${parent}..${head}`,
  ])
    .split("\n")
    .filter(Boolean);
  if (changedPaths.length !== 1 || changedPaths[0] !== capabilityPath) {
    fail(
      "repository.activationDiff",
      `candidate must change only ${capabilityPath}`,
    );
  }
  const numstat = git(input.repositoryRoot, [
    "diff",
    "--numstat",
    `${parent}..${head}`,
    "--",
    capabilityPath,
  ]);
  if (numstat !== `1\t1\t${capabilityPath}`) {
    fail(
      "repository.activationDiff",
      "candidate must change exactly one source line",
    );
  }
  const diff = git(input.repositoryRoot, [
    "diff",
    "--unified=0",
    `${parent}..${head}`,
    "--",
    capabilityPath,
  ]);
  const changedLines = diff
    .split("\n")
    .filter(
      (line) =>
        (line.startsWith("-") && !line.startsWith("---")) ||
        (line.startsWith("+") && !line.startsWith("+++")),
    );
  if (
    changedLines.length !== 2 ||
    changedLines[0] !== '-  "preactivation";' ||
    changedLines[1] !== '+  "candidate";'
  ) {
    fail(
      "repository.activationDiff",
      "the only allowed source edit is preactivation to candidate",
    );
  }
}

async function hashFile(path: string): Promise<string> {
  const details = await lstat(path).catch(() => null);
  if (details === null || !details.isFile() || details.isSymbolicLink()) {
    fail("artifact.path", "must resolve to a regular non-symlink file");
  }
  if (details.size === 0) fail("artifact.path", "must not be empty");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function artifactPath(manifestPath: string, value: string): string {
  return isAbsolute(value) ? value : resolve(dirname(manifestPath), value);
}

export async function assertArtifactDigests(input: {
  readonly manifestPath: string;
  readonly manifest: MainnetReleaseEvidenceManifest;
}): Promise<void> {
  const resolvedPaths = input.manifest.artifacts.map(({ path }) =>
    artifactPath(input.manifestPath, path),
  );
  if (new Set(resolvedPaths).size !== resolvedPaths.length) {
    fail("manifest.artifacts", "artifact paths must be distinct");
  }
  for (let index = 0; index < input.manifest.artifacts.length; index += 1) {
    const artifact = input.manifest.artifacts[
      index
    ] as MainnetArtifactReference;
    const actual = await hashFile(resolvedPaths[index] as string);
    if (actual !== artifact.sha256) {
      fail(`manifest.artifacts.${artifact.platform}.sha256`, "does not match");
    }
  }
}

function templateTime(): string {
  return "1970-01-01T00:00:00.000Z";
}

export function createMainnetReleaseEvidenceTemplate(): MainnetReleaseEvidenceManifest {
  return {
    schemaVersion: 2,
    evidenceRevision: "replace-mainnet-evidence-revision",
    revision: {
      preactivationCommitSha: "0".repeat(40),
      candidateCommitSha: "0".repeat(40),
      candidateTreeSha: "0".repeat(40),
    },
    artifacts: [
      {
        platform: "android",
        buildId: "replace-android-build-id",
        path: "replace/android-release.aab",
        sha256: "0".repeat(64),
      },
    ],
    automatedVerification: {
      command: "./scripts/check.sh",
      decision: "pending",
      completedAt: templateTime(),
      receiptId: "replace-automated-check-receipt",
    },
    releaseOwner: {
      ownerId: "replace-release-owner-id",
      candidateDecision: "pending",
      decidedAt: templateTime(),
      receiptId: "replace-candidate-decision-receipt",
    },
    releaseDecision: {
      decision: "stop",
      ownerId: "replace-release-owner-id",
      decidedAt: templateTime(),
      receiptId: "replace-release-decision-receipt",
    },
  };
}

async function readManifest(
  path: string,
): Promise<MainnetReleaseEvidenceManifest> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch {
    fail("manifest", "could not read strict JSON");
  }
  return parseMainnetReleaseEvidenceManifest(value);
}

async function runAutomatedVerification(repositoryRoot: string): Promise<void> {
  const process = Bun.spawn(["bash", "scripts/check.sh"], {
    cwd: repositoryRoot,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await process.exited) !== 0) {
    fail("automatedVerification", "./scripts/check.sh failed");
  }
}

async function run(): Promise<void> {
  const [command, manifestArgument, ...extra] = process.argv.slice(2);
  if (extra.length > 0) fail("arguments", "unexpected extra arguments");
  const snapshot = currentMainnetSourceCapabilitySnapshot();
  assertSourceCapabilityConsistency(snapshot);

  if (command === "template" && manifestArgument === undefined) {
    console.log(
      JSON.stringify(createMainnetReleaseEvidenceTemplate(), null, 2),
    );
    return;
  }
  if (command === "source" && manifestArgument === undefined) {
    console.log(
      `Mainnet source capability is consistent: ${snapshot.releaseStage}.`,
    );
    return;
  }
  if (command === "preactivation" && manifestArgument === undefined) {
    if (snapshot.releaseStage !== "preactivation") {
      fail("source.releaseStage", "expected preactivation");
    }
    console.log(
      "Mainnet preactivation is fail-closed at runtime, signer, and transport boundaries.",
    );
    return;
  }
  if ((command !== "candidate" && command !== "release") || !manifestArgument) {
    fail(
      "arguments",
      "use template, source, preactivation, candidate <manifest>, or release <manifest>",
    );
  }
  if (snapshot.releaseStage !== "candidate") {
    fail("source.releaseStage", `${command} verification requires candidate`);
  }

  const manifestPath = resolve(manifestArgument);
  const manifest = await readManifest(manifestPath);
  assertEvidenceStage(command, manifest);
  const repositoryRoot = resolve(import.meta.dir, "..");
  assertCandidateRevision({ repositoryRoot, manifest });
  await assertArtifactDigests({ manifestPath, manifest });
  await runAutomatedVerification(repositoryRoot);
  const manifestDigest = await hashFile(manifestPath);
  console.log(
    `${command === "candidate" ? "Private candidate" : "Public release"} preflight passed for ${manifest.revision.candidateCommitSha}; manifest SHA-256 ${manifestDigest}.`,
  );
}

if (import.meta.main) {
  await run().catch((error: unknown) => {
    console.error(
      `Mainnet release preflight failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    process.exitCode = 1;
  });
}
