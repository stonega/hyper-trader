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
  MAINNET_CLOSURE_CHECK_IDS,
  MAINNET_REVIEW_ROLES,
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
    closureChecks: template.closureChecks.map((check) => ({
      ...check,
      decision: "pass",
      reviewerId: `reviewer-${check.id.toLowerCase()}`,
      reviewedAt: "2026-08-25T10:00:00.000Z",
      receiptId: `receipt-${check.id.toLowerCase()}`,
    })),
    approvals: template.approvals.map((approval) => ({
      ...approval,
      decision: "approved",
      reviewerId: `reviewer-${approval.role}`,
      reviewedAt: "2026-08-25T10:50:00.000Z",
      receiptId: `approval-${approval.role}`,
    })),
    disposableTestnet: {
      decision: "pass",
      operatorId: "testnet-operator",
      reviewedAt: "2026-08-25T10:45:00.000Z",
      receiptId: "receipt-disposable-testnet",
    },
    candidateDecision: {
      decision: "approved",
      reviewerId: "release-owner",
      reviewedAt: "2026-08-25T11:00:00.000Z",
      receiptId: "receipt-private-candidate-approval",
    },
    mainnetCanary: {
      ...template.mainnetCanary,
      authorizationId: "authorization-mainnet-canary",
      authorizedBy: "canary-authorizer",
      authorizedAt: "2026-08-25T11:30:00.000Z",
      authorizationExpiresAt: "2026-08-25T12:30:00.000Z",
      operatorId: "canary-operator",
      stopOwnerId: "incident-stop-owner",
      rollbackOwnerId: "release-rollback-owner",
    },
    releaseDecision: {
      decision: "stop",
      reviewerId: "release-owner",
      reviewedAt: "2026-08-25T11:00:00.000Z",
      receiptId: "receipt-release-stop",
    },
  };
}

function approvedReleaseManifest(): MainnetReleaseEvidenceManifest {
  const candidate = approvedCandidateManifest();
  return {
    ...candidate,
    mainnetCanary: {
      ...candidate.mainnetCanary,
      decision: "pass",
      startedAt: "2026-08-25T11:40:00.000Z",
      completedAt: "2026-08-25T11:55:00.000Z",
      receiptId: "receipt-mainnet-canary",
    },
    releaseDecision: {
      decision: "approved",
      reviewerId: "release-owner",
      reviewedAt: "2026-08-25T11:58:00.000Z",
      receiptId: "receipt-public-release-approval",
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
  test("generates a strict complete template without claiming evidence", () => {
    const template = createMainnetReleaseEvidenceTemplate();
    const parsed = parseMainnetReleaseEvidenceManifest(
      JSON.parse(JSON.stringify(template)),
    );

    expect(parsed.closureChecks.map(({ id }) => id)).toEqual(
      MAINNET_CLOSURE_CHECK_IDS,
    );
    expect(parsed.approvals.map(({ role }) => role)).toEqual(
      MAINNET_REVIEW_ROLES,
    );
    expect(
      parsed.closureChecks.every(({ decision }) => decision === "pending"),
    ).toBe(true);
    expect(parsed.releaseDecision.decision).toBe("stop");
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

  test("accepts a fully approved private candidate and keeps distribution stopped", () => {
    expect(() =>
      assertEvidenceStage("candidate", approvedCandidateManifest(), NOW),
    ).not.toThrow();
  });

  test("requires independent reviewers after closure and disposable-testnet evidence", () => {
    const candidate = approvedCandidateManifest();
    expect(() =>
      assertEvidenceStage(
        "candidate",
        {
          ...candidate,
          approvals: candidate.approvals.map((approval) => ({
            ...approval,
            reviewerId: "same-reviewer",
          })),
        },
        NOW,
      ),
    ).toThrow("independent reviewers");
    expect(() =>
      assertEvidenceStage(
        "candidate",
        {
          ...candidate,
          approvals: candidate.approvals.map((approval, index) =>
            index === 0
              ? { ...approval, reviewedAt: "2026-08-25T09:00:00.000Z" }
              : approval,
          ),
        },
        NOW,
      ),
    ).toThrow("must follow the completed closure");
  });

  test("requires all 28 rows and physical custody, even when other reviewers approve", () => {
    const candidate = approvedCandidateManifest();
    expect(() =>
      assertEvidenceStage(
        "candidate",
        { ...candidate, closureChecks: candidate.closureChecks.slice(1) },
        NOW,
      ),
    ).toThrow("exactly once");
    expect(() =>
      assertEvidenceStage(
        "candidate",
        {
          ...candidate,
          closureChecks: candidate.closureChecks.map((check) =>
            check.id === "M1"
              ? {
                  ...check,
                  decision: "not_applicable",
                  notApplicableReason: "device unavailable",
                }
              : check,
          ),
        },
        NOW,
      ),
    ).toThrow("physical platform custody evidence must pass");
  });

  test("enforces conservative canary limits and a live authorization window", () => {
    const candidate = approvedCandidateManifest();
    expect(() =>
      assertEvidenceStage(
        "candidate",
        {
          ...candidate,
          mainnetCanary: {
            ...candidate.mainnetCanary,
            maxOpenNotionalUsd: 51,
          },
        },
        NOW,
      ),
    ).toThrow("maxOpenNotionalUsd");
    expect(() =>
      assertEvidenceStage(
        "candidate",
        {
          ...candidate,
          mainnetCanary: {
            ...candidate.mainnetCanary,
            authorizationExpiresAt: "2026-08-25T11:59:59.000Z",
          },
        },
        NOW,
      ),
    ).toThrow("authorization is not currently valid");
  });

  test("approves release only after a passing in-window canary on the same manifest", () => {
    expect(() =>
      assertEvidenceStage("release", approvedReleaseManifest(), NOW),
    ).not.toThrow();

    const release = approvedReleaseManifest();
    expect(() =>
      assertEvidenceStage(
        "release",
        {
          ...release,
          releaseDecision: { ...release.releaseDecision, decision: "stop" },
        },
        NOW,
      ),
    ).toThrow("must be approved after the canary");
  });

  test("rejects unknown manifest fields", () => {
    const value = JSON.parse(
      JSON.stringify(createMainnetReleaseEvidenceTemplate()),
    ) as Record<string, unknown>;
    value.runtimeOverride = true;
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

  test("hashes exact distinct iOS, Android, and restricted evidence files", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "hyper-trader-mainnet-artifacts-"),
    );
    temporaryDirectories.push(directory);
    const files = {
      ios: "candidate.ipa",
      android: "candidate.aab",
      evidence: "evidence.tar",
    };
    const contents = {
      ios: "ios-artifact",
      android: "android-artifact",
      evidence: "restricted-evidence",
    };
    await Promise.all(
      Object.entries(files).map(([name, path]) =>
        writeFile(
          join(directory, path),
          contents[name as keyof typeof contents],
        ),
      ),
    );
    const digest = (value: string) =>
      createHash("sha256").update(value).digest("hex");
    const candidate = approvedCandidateManifest();
    const manifest: MainnetReleaseEvidenceManifest = {
      ...candidate,
      artifacts: {
        ios: {
          ...candidate.artifacts.ios,
          path: files.ios,
          sha256: digest(contents.ios),
        },
        android: {
          ...candidate.artifacts.android,
          path: files.android,
          sha256: digest(contents.android),
        },
      },
      evidenceBundle: {
        path: files.evidence,
        sha256: digest(contents.evidence),
      },
    };
    const manifestPath = join(directory, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest));

    await expect(
      assertArtifactDigests({ manifestPath, manifest }),
    ).resolves.toBeUndefined();
    await writeFile(join(directory, files.android), "tampered");
    await expect(
      assertArtifactDigests({ manifestPath, manifest }),
    ).rejects.toThrow("does not match");
  });
});
