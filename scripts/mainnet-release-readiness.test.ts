import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertArtifactDigests,
  assertCandidateRevision,
  assertEvidenceStage,
  assertSourceCapabilityConsistency,
  createMainnetReleaseEvidenceTemplate,
  MAINNET_RELEASE_PLATFORMS,
  type MainnetReleaseEvidenceManifest,
  parseMainnetReleaseEvidenceManifest,
} from "./mainnet-release-readiness";

const NOW = Date.parse("2026-08-25T12:00:00.000Z");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

function approvedCandidateManifest(): MainnetReleaseEvidenceManifest {
  const template = createMainnetReleaseEvidenceTemplate();
  return {
    ...template,
    automatedVerification: {
      ...template.automatedVerification,
      decision: "pass",
      completedAt: "2026-08-25T10:00:00.000Z",
      receiptId: "receipt-automated-check",
    },
    releaseOwner: {
      ownerId: "solo-release-owner",
      candidateDecision: "approved",
      decidedAt: "2026-08-25T10:30:00.000Z",
      receiptId: "receipt-private-candidate",
    },
    releaseDecision: {
      decision: "stop",
      ownerId: "solo-release-owner",
      decidedAt: "2026-08-25T10:30:00.000Z",
      receiptId: "receipt-release-stop",
    },
  };
}

function approvedReleaseManifest(): MainnetReleaseEvidenceManifest {
  const candidate = approvedCandidateManifest();
  return {
    ...candidate,
    releaseDecision: {
      decision: "approved",
      ownerId: "solo-release-owner",
      decidedAt: "2026-08-25T11:00:00.000Z",
      receiptId: "receipt-public-release",
    },
  };
}

function git(repositoryRoot: string, ...args: string[]): string {
  const result = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd: repositoryRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(result.exitCode).toBe(0);
  return new TextDecoder().decode(result.stdout).trim();
}

describe("mainnet release readiness manifest", () => {
  test("generates a strict solo-owner template without claiming evidence", () => {
    const template = createMainnetReleaseEvidenceTemplate();
    const parsed = parseMainnetReleaseEvidenceManifest(
      JSON.parse(JSON.stringify(template)),
    );

    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.artifacts.map(({ platform }) => platform)).toEqual([
      "android",
    ]);
    expect(MAINNET_RELEASE_PLATFORMS).toEqual(["ios", "android"]);
    expect(parsed.automatedVerification.decision).toBe("pending");
    expect(parsed.releaseOwner.candidateDecision).toBe("pending");
    expect(parsed.releaseDecision.decision).toBe("stop");
    expect("approvals" in parsed).toBe(false);
    expect("mainnetCanary" in parsed).toBe(false);
  });

  test("requires one consistent compile-owned source stage", () => {
    expect(() =>
      assertSourceCapabilityConsistency({
        releaseStage: "preactivation",
        releaseRuntimeEnabled: false,
        mainnetSignerAccess: false,
        mainnetExchangeTransport: false,
        testnetSignerAccess: true,
        testnetExchangeTransport: true,
      }),
    ).not.toThrow();
    expect(() =>
      assertSourceCapabilityConsistency({
        releaseStage: "candidate",
        releaseRuntimeEnabled: true,
        mainnetSignerAccess: true,
        mainnetExchangeTransport: false,
        testnetSignerAccess: true,
        testnetExchangeTransport: true,
      }),
    ).toThrow("must derive from one release stage");
  });

  test("accepts automated verification and one release owner", () => {
    expect(() =>
      assertEvidenceStage("candidate", approvedCandidateManifest(), NOW),
    ).not.toThrow();
  });

  test("requires automated verification before owner approval", () => {
    const candidate = approvedCandidateManifest();
    expect(() =>
      assertEvidenceStage(
        "candidate",
        {
          ...candidate,
          automatedVerification: {
            ...candidate.automatedVerification,
            decision: "pending",
          },
        },
        NOW,
      ),
    ).toThrow("complete automated check must pass");
    expect(() =>
      assertEvidenceStage(
        "candidate",
        {
          ...candidate,
          releaseOwner: {
            ...candidate.releaseOwner,
            decidedAt: "2026-08-25T09:59:59.000Z",
          },
        },
        NOW,
      ),
    ).toThrow("must follow automated verification");
  });

  test("supports a single target platform and rejects duplicate artifacts", () => {
    const candidate = approvedCandidateManifest();
    const artifact = candidate.artifacts[0];
    if (artifact === undefined) throw new Error("missing Android artifact");
    expect(candidate.artifacts).toHaveLength(1);
    expect(() =>
      assertEvidenceStage(
        "candidate",
        {
          ...candidate,
          artifacts: [...candidate.artifacts, artifact],
        },
        NOW,
      ),
    ).toThrow("each platform may appear at most once");
  });

  test("approves release with the same accountable owner and no canary", () => {
    expect(() =>
      assertEvidenceStage("release", approvedReleaseManifest(), NOW),
    ).not.toThrow();

    const release = approvedReleaseManifest();
    expect(() =>
      assertEvidenceStage(
        "release",
        {
          ...release,
          releaseDecision: {
            ...release.releaseDecision,
            ownerId: "different-owner",
          },
        },
        NOW,
      ),
    ).toThrow("must match the candidate release owner");
  });

  test("rejects unknown or removed manifest fields", () => {
    const value = JSON.parse(
      JSON.stringify(createMainnetReleaseEvidenceTemplate()),
    ) as Record<string, unknown>;
    value.approvals = [];
    expect(() => parseMainnetReleaseEvidenceManifest(value)).toThrow(
      "expected exactly",
    );
  });

  test("binds candidate verification to a clean one-line activation child commit", async () => {
    const repositoryRoot = await mkdtemp(
      join(tmpdir(), "hyper-trader-mainnet-preflight-"),
    );
    temporaryDirectories.push(repositoryRoot);
    const capabilityDirectory = join(
      repositoryRoot,
      "packages/hyperliquid/src/signing",
    );
    await mkdir(capabilityDirectory, { recursive: true });
    const capabilityPath = join(capabilityDirectory, "boundary.ts");
    await writeFile(
      capabilityPath,
      'export const MAINNET_TRADING_RELEASE_STAGE: MainnetTradingReleaseStage =\n  "preactivation";\n',
    );
    git(repositoryRoot, "init", "-q");
    git(repositoryRoot, "config", "user.name", "Readiness Test");
    git(repositoryRoot, "config", "user.email", "readiness@example.invalid");
    git(repositoryRoot, "add", ".");
    git(repositoryRoot, "commit", "-qm", "preactivation");
    const preactivationCommitSha = git(repositoryRoot, "rev-parse", "HEAD");
    await writeFile(
      capabilityPath,
      'export const MAINNET_TRADING_RELEASE_STAGE: MainnetTradingReleaseStage =\n  "candidate";\n',
    );
    git(repositoryRoot, "add", ".");
    git(repositoryRoot, "commit", "-qm", "candidate");
    const candidateCommitSha = git(repositoryRoot, "rev-parse", "HEAD");
    const candidateTreeSha = git(repositoryRoot, "rev-parse", "HEAD^{tree}");
    const manifest: MainnetReleaseEvidenceManifest = {
      ...approvedCandidateManifest(),
      revision: {
        preactivationCommitSha,
        candidateCommitSha,
        candidateTreeSha,
      },
    };

    expect(() =>
      assertCandidateRevision({ repositoryRoot, manifest }),
    ).not.toThrow();
    await writeFile(join(repositoryRoot, "untracked.txt"), "dirty\n");
    expect(() => assertCandidateRevision({ repositoryRoot, manifest })).toThrow(
      "clean worktree",
    );
  });

  test("hashes exact target-platform artifacts", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "hyper-trader-mainnet-artifacts-"),
    );
    temporaryDirectories.push(directory);
    const artifactPath = "candidate.aab";
    const artifactContents = "android-artifact";
    await writeFile(join(directory, artifactPath), artifactContents);
    const digest = createHash("sha256").update(artifactContents).digest("hex");
    const candidate = approvedCandidateManifest();
    const artifact = candidate.artifacts[0];
    if (artifact === undefined) throw new Error("missing Android artifact");
    const manifest: MainnetReleaseEvidenceManifest = {
      ...candidate,
      artifacts: [
        {
          ...artifact,
          path: artifactPath,
          sha256: digest,
        },
      ],
    };
    const manifestPath = join(directory, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest));

    await expect(
      assertArtifactDigests({ manifestPath, manifest }),
    ).resolves.toBeUndefined();
    await writeFile(join(directory, artifactPath), "tampered");
    await expect(
      assertArtifactDigests({ manifestPath, manifest }),
    ).rejects.toThrow("does not match");
  });
});
