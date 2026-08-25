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

export const MAINNET_CLOSURE_CHECK_IDS = [
  "P1",
  "P2",
  "P3",
  "P4",
  "P5",
  "P6",
  "P7",
  "M1",
  "M2",
  "M3",
  "M4",
  "M5",
  "M6",
  "M7",
  "M8",
  "N1",
  "N2",
  "N3",
  "N4",
  "N5",
  "N6",
  "N7",
  "N8",
  "R1",
  "R2",
  "R3",
  "R4",
  "R5",
] as const;

export const MAINNET_REVIEW_ROLES = [
  "protocol_signing",
  "mobile_custody_release",
  "notification_privacy_operations",
  "recovery_incident",
] as const;

export const MAINNET_CANARY_ACTIONS = [
  "limit_order",
  "cancel",
  "reduce_only_close",
] as const;

export const MAX_MAINNET_CANARY_CUMULATIVE_NOTIONAL_USD = 100;
export const MAX_MAINNET_CANARY_OPEN_NOTIONAL_USD = 50;
export const MAX_MAINNET_CANARY_DURATION_MINUTES = 30;

type ClosureCheckId = (typeof MAINNET_CLOSURE_CHECK_IDS)[number];
type ReviewRole = (typeof MAINNET_REVIEW_ROLES)[number];
type CanaryAction = (typeof MAINNET_CANARY_ACTIONS)[number];
type ClosureDecision = "pending" | "pass" | "not_applicable";
type ApprovalDecision = "pending" | "approved";
type PassDecision = "pending" | "pass";

export interface MainnetArtifactReference {
  readonly buildId: string;
  readonly path: string;
  readonly sha256: string;
}

export interface MainnetClosureCheck {
  readonly id: ClosureCheckId;
  readonly decision: ClosureDecision;
  readonly reviewerId: string;
  readonly reviewedAt: string;
  readonly receiptId: string;
  readonly notApplicableReason: string | null;
}

export interface MainnetReviewApproval {
  readonly role: ReviewRole;
  readonly decision: ApprovalDecision;
  readonly reviewerId: string;
  readonly reviewedAt: string;
  readonly receiptId: string;
}

export interface MainnetReleaseEvidenceManifest {
  readonly schemaVersion: 1;
  readonly evidenceRevision: string;
  readonly revision: {
    readonly preactivationCommitSha: string;
    readonly candidateCommitSha: string;
    readonly candidateTreeSha: string;
  };
  readonly artifacts: {
    readonly ios: MainnetArtifactReference;
    readonly android: MainnetArtifactReference;
  };
  readonly evidenceBundle: {
    readonly path: string;
    readonly sha256: string;
  };
  readonly closureChecks: readonly MainnetClosureCheck[];
  readonly approvals: readonly MainnetReviewApproval[];
  readonly disposableTestnet: {
    readonly decision: PassDecision;
    readonly operatorId: string;
    readonly reviewedAt: string;
    readonly receiptId: string;
  };
  readonly candidateDecision: {
    readonly decision: ApprovalDecision;
    readonly reviewerId: string;
    readonly reviewedAt: string;
    readonly receiptId: string;
  };
  readonly mainnetCanary: {
    readonly decision: PassDecision;
    readonly authorizationId: string;
    readonly authorizedBy: string;
    readonly authorizedAt: string;
    readonly authorizationExpiresAt: string;
    readonly operatorId: string;
    readonly stopOwnerId: string;
    readonly rollbackOwnerId: string;
    readonly maxCumulativeNotionalUsd: number;
    readonly maxOpenNotionalUsd: number;
    readonly maxOpenOrders: number;
    readonly maxLeverage: number;
    readonly maxDurationMinutes: number;
    readonly permittedActions: readonly CanaryAction[];
    readonly startedAt: string | null;
    readonly completedAt: string | null;
    readonly receiptId: string | null;
  };
  readonly releaseDecision: {
    readonly decision: "stop" | "approved";
    readonly reviewerId: string;
    readonly reviewedAt: string;
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
) {
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

function publicReason(value: unknown, path: string): string {
  const parsed = textValue(value, path);
  if (/0x[0-9a-fA-F]{40}|[0-9a-fA-F]{64}/u.test(parsed)) {
    fail(path, "must not contain an address, digest, or secret-like hex value");
  }
  return parsed;
}

function identifier(value: unknown, path: string): string {
  const parsed = textValue(value, path);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{1,127}$/u.test(parsed)) {
    fail(path, "expected an opaque identifier, not free-form evidence");
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

function nullableIsoTime(value: unknown, path: string): string | null {
  return value === null ? null : isoTime(value, path);
}

function nullableIdentifier(value: unknown, path: string): string | null {
  return value === null ? null : identifier(value, path);
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(path, "expected a finite number");
  }
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  const parsed = finiteNumber(value, path);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    fail(path, "expected a positive safe integer");
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

function parseArtifact(value: unknown, path: string): MainnetArtifactReference {
  const source = object(value, path);
  exactKeys(source, ["buildId", "path", "sha256"], path);
  return {
    buildId: identifier(source.buildId, `${path}.buildId`),
    path: textValue(source.path, `${path}.path`),
    sha256: sha256(source.sha256, `${path}.sha256`),
  };
}

function parseClosureCheck(value: unknown, index: number): MainnetClosureCheck {
  const path = `manifest.closureChecks[${index}]`;
  const source = object(value, path);
  exactKeys(
    source,
    [
      "id",
      "decision",
      "reviewerId",
      "reviewedAt",
      "receiptId",
      "notApplicableReason",
    ],
    path,
  );
  const decision = enumValue(
    source.decision,
    ["pending", "pass", "not_applicable"],
    `${path}.decision`,
  );
  const reason =
    source.notApplicableReason === null
      ? null
      : publicReason(source.notApplicableReason, `${path}.notApplicableReason`);
  if (decision === "not_applicable" && reason === null) {
    fail(`${path}.notApplicableReason`, "required for not_applicable");
  }
  if (decision !== "not_applicable" && reason !== null) {
    fail(`${path}.notApplicableReason`, "must be null unless not_applicable");
  }
  return {
    id: enumValue(source.id, MAINNET_CLOSURE_CHECK_IDS, `${path}.id`),
    decision,
    reviewerId: identifier(source.reviewerId, `${path}.reviewerId`),
    reviewedAt: isoTime(source.reviewedAt, `${path}.reviewedAt`),
    receiptId: identifier(source.receiptId, `${path}.receiptId`),
    notApplicableReason: reason,
  };
}

function parseApproval(value: unknown, index: number): MainnetReviewApproval {
  const path = `manifest.approvals[${index}]`;
  const source = object(value, path);
  exactKeys(
    source,
    ["role", "decision", "reviewerId", "reviewedAt", "receiptId"],
    path,
  );
  return {
    role: enumValue(source.role, MAINNET_REVIEW_ROLES, `${path}.role`),
    decision: enumValue(
      source.decision,
      ["pending", "approved"],
      `${path}.decision`,
    ),
    reviewerId: identifier(source.reviewerId, `${path}.reviewerId`),
    reviewedAt: isoTime(source.reviewedAt, `${path}.reviewedAt`),
    receiptId: identifier(source.receiptId, `${path}.receiptId`),
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
      "evidenceBundle",
      "closureChecks",
      "approvals",
      "disposableTestnet",
      "candidateDecision",
      "mainnetCanary",
      "releaseDecision",
    ],
    "manifest",
  );
  if (source.schemaVersion !== 1) {
    fail("manifest.schemaVersion", "expected 1");
  }

  const revision = object(source.revision, "manifest.revision");
  exactKeys(
    revision,
    ["preactivationCommitSha", "candidateCommitSha", "candidateTreeSha"],
    "manifest.revision",
  );
  const artifacts = object(source.artifacts, "manifest.artifacts");
  exactKeys(artifacts, ["ios", "android"], "manifest.artifacts");
  const evidenceBundle = object(
    source.evidenceBundle,
    "manifest.evidenceBundle",
  );
  exactKeys(evidenceBundle, ["path", "sha256"], "manifest.evidenceBundle");

  if (!Array.isArray(source.closureChecks)) {
    fail("manifest.closureChecks", "expected an array");
  }
  if (!Array.isArray(source.approvals)) {
    fail("manifest.approvals", "expected an array");
  }

  const disposable = object(
    source.disposableTestnet,
    "manifest.disposableTestnet",
  );
  exactKeys(
    disposable,
    ["decision", "operatorId", "reviewedAt", "receiptId"],
    "manifest.disposableTestnet",
  );
  const candidateDecision = object(
    source.candidateDecision,
    "manifest.candidateDecision",
  );
  exactKeys(
    candidateDecision,
    ["decision", "reviewerId", "reviewedAt", "receiptId"],
    "manifest.candidateDecision",
  );
  const canary = object(source.mainnetCanary, "manifest.mainnetCanary");
  exactKeys(
    canary,
    [
      "decision",
      "authorizationId",
      "authorizedBy",
      "authorizedAt",
      "authorizationExpiresAt",
      "operatorId",
      "stopOwnerId",
      "rollbackOwnerId",
      "maxCumulativeNotionalUsd",
      "maxOpenNotionalUsd",
      "maxOpenOrders",
      "maxLeverage",
      "maxDurationMinutes",
      "permittedActions",
      "startedAt",
      "completedAt",
      "receiptId",
    ],
    "manifest.mainnetCanary",
  );
  if (!Array.isArray(canary.permittedActions)) {
    fail("manifest.mainnetCanary.permittedActions", "expected an array");
  }
  const releaseDecision = object(
    source.releaseDecision,
    "manifest.releaseDecision",
  );
  exactKeys(
    releaseDecision,
    ["decision", "reviewerId", "reviewedAt", "receiptId"],
    "manifest.releaseDecision",
  );

  return {
    schemaVersion: 1,
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
    artifacts: {
      ios: parseArtifact(artifacts.ios, "manifest.artifacts.ios"),
      android: parseArtifact(artifacts.android, "manifest.artifacts.android"),
    },
    evidenceBundle: {
      path: textValue(evidenceBundle.path, "manifest.evidenceBundle.path"),
      sha256: sha256(evidenceBundle.sha256, "manifest.evidenceBundle.sha256"),
    },
    closureChecks: source.closureChecks.map(parseClosureCheck),
    approvals: source.approvals.map(parseApproval),
    disposableTestnet: {
      decision: enumValue(
        disposable.decision,
        ["pending", "pass"],
        "manifest.disposableTestnet.decision",
      ),
      operatorId: identifier(
        disposable.operatorId,
        "manifest.disposableTestnet.operatorId",
      ),
      reviewedAt: isoTime(
        disposable.reviewedAt,
        "manifest.disposableTestnet.reviewedAt",
      ),
      receiptId: identifier(
        disposable.receiptId,
        "manifest.disposableTestnet.receiptId",
      ),
    },
    candidateDecision: {
      decision: enumValue(
        candidateDecision.decision,
        ["pending", "approved"],
        "manifest.candidateDecision.decision",
      ),
      reviewerId: identifier(
        candidateDecision.reviewerId,
        "manifest.candidateDecision.reviewerId",
      ),
      reviewedAt: isoTime(
        candidateDecision.reviewedAt,
        "manifest.candidateDecision.reviewedAt",
      ),
      receiptId: identifier(
        candidateDecision.receiptId,
        "manifest.candidateDecision.receiptId",
      ),
    },
    mainnetCanary: {
      decision: enumValue(
        canary.decision,
        ["pending", "pass"],
        "manifest.mainnetCanary.decision",
      ),
      authorizationId: identifier(
        canary.authorizationId,
        "manifest.mainnetCanary.authorizationId",
      ),
      authorizedBy: identifier(
        canary.authorizedBy,
        "manifest.mainnetCanary.authorizedBy",
      ),
      authorizedAt: isoTime(
        canary.authorizedAt,
        "manifest.mainnetCanary.authorizedAt",
      ),
      authorizationExpiresAt: isoTime(
        canary.authorizationExpiresAt,
        "manifest.mainnetCanary.authorizationExpiresAt",
      ),
      operatorId: identifier(
        canary.operatorId,
        "manifest.mainnetCanary.operatorId",
      ),
      stopOwnerId: identifier(
        canary.stopOwnerId,
        "manifest.mainnetCanary.stopOwnerId",
      ),
      rollbackOwnerId: identifier(
        canary.rollbackOwnerId,
        "manifest.mainnetCanary.rollbackOwnerId",
      ),
      maxCumulativeNotionalUsd: finiteNumber(
        canary.maxCumulativeNotionalUsd,
        "manifest.mainnetCanary.maxCumulativeNotionalUsd",
      ),
      maxOpenNotionalUsd: finiteNumber(
        canary.maxOpenNotionalUsd,
        "manifest.mainnetCanary.maxOpenNotionalUsd",
      ),
      maxOpenOrders: positiveInteger(
        canary.maxOpenOrders,
        "manifest.mainnetCanary.maxOpenOrders",
      ),
      maxLeverage: positiveInteger(
        canary.maxLeverage,
        "manifest.mainnetCanary.maxLeverage",
      ),
      maxDurationMinutes: positiveInteger(
        canary.maxDurationMinutes,
        "manifest.mainnetCanary.maxDurationMinutes",
      ),
      permittedActions: canary.permittedActions.map((action, index) =>
        enumValue(
          action,
          MAINNET_CANARY_ACTIONS,
          `manifest.mainnetCanary.permittedActions[${index}]`,
        ),
      ),
      startedAt: nullableIsoTime(
        canary.startedAt,
        "manifest.mainnetCanary.startedAt",
      ),
      completedAt: nullableIsoTime(
        canary.completedAt,
        "manifest.mainnetCanary.completedAt",
      ),
      receiptId: nullableIdentifier(
        canary.receiptId,
        "manifest.mainnetCanary.receiptId",
      ),
    },
    releaseDecision: {
      decision: enumValue(
        releaseDecision.decision,
        ["stop", "approved"],
        "manifest.releaseDecision.decision",
      ),
      reviewerId: identifier(
        releaseDecision.reviewerId,
        "manifest.releaseDecision.reviewerId",
      ),
      reviewedAt: isoTime(
        releaseDecision.reviewedAt,
        "manifest.releaseDecision.reviewedAt",
      ),
      receiptId: identifier(
        releaseDecision.receiptId,
        "manifest.releaseDecision.receiptId",
      ),
    },
  };
}

function uniqueExactSet(
  actual: readonly string[],
  expected: readonly string[],
  path: string,
): void {
  if (
    actual.length !== expected.length ||
    new Set(actual).size !== actual.length ||
    [...actual]
      .sort()
      .some((value, index) => value !== [...expected].sort()[index])
  ) {
    fail(path, `expected each of ${expected.join(", ")} exactly once`);
  }
}

function assertNotFuture(value: string, nowMs: number, path: string): void {
  if (Date.parse(value) > nowMs) fail(path, "must not be in the future");
}

export function assertEvidenceStage(
  stage: "candidate" | "release",
  manifest: MainnetReleaseEvidenceManifest,
  nowMs = Date.now(),
): void {
  uniqueExactSet(
    manifest.closureChecks.map((check) => check.id),
    MAINNET_CLOSURE_CHECK_IDS,
    "manifest.closureChecks",
  );
  for (const check of manifest.closureChecks) {
    if (check.decision === "pending") {
      fail(`manifest.closureChecks.${check.id}`, "is still pending");
    }
    if ((check.id === "M1" || check.id === "M2") && check.decision !== "pass") {
      fail(
        `manifest.closureChecks.${check.id}`,
        "physical platform custody evidence must pass",
      );
    }
    assertNotFuture(
      check.reviewedAt,
      nowMs,
      `manifest.closureChecks.${check.id}.reviewedAt`,
    );
  }

  if (manifest.artifacts.ios.buildId === manifest.artifacts.android.buildId) {
    fail("manifest.artifacts", "iOS and Android build IDs must be distinct");
  }

  uniqueExactSet(
    manifest.approvals.map((approval) => approval.role),
    MAINNET_REVIEW_ROLES,
    "manifest.approvals",
  );
  for (const approval of manifest.approvals) {
    if (approval.decision !== "approved") {
      fail(`manifest.approvals.${approval.role}`, "is not approved");
    }
    assertNotFuture(
      approval.reviewedAt,
      nowMs,
      `manifest.approvals.${approval.role}.reviewedAt`,
    );
  }
  const approvalReviewers = manifest.approvals.map(
    (approval) => approval.reviewerId,
  );
  if (new Set(approvalReviewers).size !== approvalReviewers.length) {
    fail(
      "manifest.approvals",
      "the four review roles require independent reviewers",
    );
  }
  if (manifest.disposableTestnet.decision !== "pass") {
    fail("manifest.disposableTestnet.decision", "must pass before a candidate");
  }
  if (manifest.candidateDecision.decision !== "approved") {
    fail(
      "manifest.candidateDecision.decision",
      "must approve private candidate use",
    );
  }
  assertNotFuture(
    manifest.disposableTestnet.reviewedAt,
    nowMs,
    "manifest.disposableTestnet.reviewedAt",
  );
  assertNotFuture(
    manifest.candidateDecision.reviewedAt,
    nowMs,
    "manifest.candidateDecision.reviewedAt",
  );
  const latestPrerequisiteReview = Math.max(
    Date.parse(manifest.disposableTestnet.reviewedAt),
    ...manifest.closureChecks.map((check) => Date.parse(check.reviewedAt)),
  );
  for (const approval of manifest.approvals) {
    if (Date.parse(approval.reviewedAt) < latestPrerequisiteReview) {
      fail(
        `manifest.approvals.${approval.role}.reviewedAt`,
        "must follow the completed closure and disposable-testnet evidence",
      );
    }
  }
  const latestApproval = Math.max(
    ...manifest.approvals.map((approval) => Date.parse(approval.reviewedAt)),
  );
  if (Date.parse(manifest.candidateDecision.reviewedAt) < latestApproval) {
    fail(
      "manifest.candidateDecision.reviewedAt",
      "must follow all four approvals",
    );
  }
  if (approvalReviewers.includes(manifest.candidateDecision.reviewerId)) {
    fail(
      "manifest.candidateDecision.reviewerId",
      "release ownership must be independent of the four review roles",
    );
  }

  const canary = manifest.mainnetCanary;
  const authorizedAt = Date.parse(canary.authorizedAt);
  const authorizationExpiresAt = Date.parse(canary.authorizationExpiresAt);
  if (authorizationExpiresAt <= authorizedAt) {
    fail(
      "manifest.mainnetCanary.authorizationExpiresAt",
      "must follow authorization",
    );
  }
  if (authorizedAt < Date.parse(manifest.candidateDecision.reviewedAt)) {
    fail(
      "manifest.mainnetCanary.authorizedAt",
      "must follow private-candidate approval",
    );
  }
  if (canary.authorizedBy === canary.operatorId) {
    fail(
      "manifest.mainnetCanary.operatorId",
      "the canary operator cannot authorize their own run",
    );
  }
  if (
    canary.stopOwnerId === canary.operatorId ||
    canary.rollbackOwnerId === canary.operatorId
  ) {
    fail(
      "manifest.mainnetCanary",
      "stop and rollback ownership must be independent of the operator",
    );
  }
  if (
    canary.maxCumulativeNotionalUsd <= 0 ||
    canary.maxCumulativeNotionalUsd > MAX_MAINNET_CANARY_CUMULATIVE_NOTIONAL_USD
  ) {
    fail(
      "manifest.mainnetCanary.maxCumulativeNotionalUsd",
      `must be within (0, ${MAX_MAINNET_CANARY_CUMULATIVE_NOTIONAL_USD}]`,
    );
  }
  if (
    canary.maxOpenNotionalUsd <= 0 ||
    canary.maxOpenNotionalUsd > MAX_MAINNET_CANARY_OPEN_NOTIONAL_USD ||
    canary.maxOpenNotionalUsd > canary.maxCumulativeNotionalUsd
  ) {
    fail(
      "manifest.mainnetCanary.maxOpenNotionalUsd",
      `must be within (0, ${MAX_MAINNET_CANARY_OPEN_NOTIONAL_USD}] and no greater than cumulative notional`,
    );
  }
  if (canary.maxOpenOrders !== 1) {
    fail("manifest.mainnetCanary.maxOpenOrders", "must equal 1");
  }
  if (canary.maxLeverage > 2) {
    fail("manifest.mainnetCanary.maxLeverage", "must not exceed 2");
  }
  if (canary.maxDurationMinutes > MAX_MAINNET_CANARY_DURATION_MINUTES) {
    fail(
      "manifest.mainnetCanary.maxDurationMinutes",
      `must not exceed ${MAX_MAINNET_CANARY_DURATION_MINUTES}`,
    );
  }
  uniqueExactSet(
    canary.permittedActions,
    MAINNET_CANARY_ACTIONS,
    "manifest.mainnetCanary.permittedActions",
  );

  if (stage === "candidate") {
    if (canary.decision !== "pending") {
      fail(
        "manifest.mainnetCanary.decision",
        "must be pending before the canary",
      );
    }
    if (
      canary.startedAt !== null ||
      canary.completedAt !== null ||
      canary.receiptId !== null
    ) {
      fail(
        "manifest.mainnetCanary",
        "pending canary cannot claim execution evidence",
      );
    }
    if (nowMs < authorizedAt || nowMs >= authorizationExpiresAt) {
      fail("manifest.mainnetCanary", "authorization is not currently valid");
    }
    if (manifest.releaseDecision.decision !== "stop") {
      fail(
        "manifest.releaseDecision.decision",
        "must remain stop before canary",
      );
    }
    return;
  }

  if (
    canary.decision !== "pass" ||
    canary.startedAt === null ||
    canary.completedAt === null ||
    canary.receiptId === null
  ) {
    fail(
      "manifest.mainnetCanary",
      "release requires completed passing evidence",
    );
  }
  const startedAt = Date.parse(canary.startedAt);
  const completedAt = Date.parse(canary.completedAt);
  if (
    startedAt < authorizedAt ||
    completedAt > authorizationExpiresAt ||
    completedAt <= startedAt
  ) {
    fail(
      "manifest.mainnetCanary",
      "execution must fit inside its authorization window",
    );
  }
  if (completedAt - startedAt > canary.maxDurationMinutes * 60 * 1_000) {
    fail(
      "manifest.mainnetCanary",
      "execution exceeded the authorized duration",
    );
  }
  if (manifest.releaseDecision.decision !== "approved") {
    fail(
      "manifest.releaseDecision.decision",
      "must be approved after the canary",
    );
  }
  if (
    manifest.releaseDecision.reviewerId !==
    manifest.candidateDecision.reviewerId
  ) {
    fail(
      "manifest.releaseDecision.reviewerId",
      "must match the private-candidate release owner",
    );
  }
  if (Date.parse(manifest.releaseDecision.reviewedAt) < completedAt) {
    fail(
      "manifest.releaseDecision.reviewedAt",
      "must follow canary completion",
    );
  }
  assertNotFuture(
    manifest.releaseDecision.reviewedAt,
    nowMs,
    "manifest.releaseDecision.reviewedAt",
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

  const changedPaths = git(input.repositoryRoot, [
    "diff",
    "--name-only",
    `${parent}..${head}`,
  ])
    .split("\n")
    .filter(Boolean);
  const capabilityPath = "packages/hyperliquid/src/signing/boundary.ts";
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
  const references = [
    [
      "artifacts.ios",
      input.manifest.artifacts.ios.path,
      input.manifest.artifacts.ios.sha256,
    ],
    [
      "artifacts.android",
      input.manifest.artifacts.android.path,
      input.manifest.artifacts.android.sha256,
    ],
    [
      "evidenceBundle",
      input.manifest.evidenceBundle.path,
      input.manifest.evidenceBundle.sha256,
    ],
  ] as const;
  const resolvedPaths = references.map(([, path]) =>
    artifactPath(input.manifestPath, path),
  );
  if (new Set(resolvedPaths).size !== resolvedPaths.length) {
    fail("manifest.artifacts", "artifact and evidence paths must be distinct");
  }
  for (let index = 0; index < references.length; index += 1) {
    const [name, , expected] = references[index] as (typeof references)[number];
    const actual = await hashFile(resolvedPaths[index] as string);
    if (actual !== expected) {
      fail(`manifest.${name}.sha256`, "does not match the referenced file");
    }
  }
}

function templateTime(): string {
  return "1970-01-01T00:00:00.000Z";
}

export function createMainnetReleaseEvidenceTemplate(): MainnetReleaseEvidenceManifest {
  const placeholderSha256 = "0".repeat(64);
  const placeholderGitSha = "0".repeat(40);
  return {
    schemaVersion: 1,
    evidenceRevision: "replace-mainnet-evidence-revision",
    revision: {
      preactivationCommitSha: placeholderGitSha,
      candidateCommitSha: placeholderGitSha,
      candidateTreeSha: placeholderGitSha,
    },
    artifacts: {
      ios: {
        buildId: "replace-ios-build-id",
        path: "replace/ios-release.ipa",
        sha256: placeholderSha256,
      },
      android: {
        buildId: "replace-android-build-id",
        path: "replace/android-release.aab",
        sha256: placeholderSha256,
      },
    },
    evidenceBundle: {
      path: "replace/restricted-evidence-bundle.tar",
      sha256: placeholderSha256,
    },
    closureChecks: MAINNET_CLOSURE_CHECK_IDS.map((id) => ({
      id,
      decision: "pending",
      reviewerId: "replace-reviewer-id",
      reviewedAt: templateTime(),
      receiptId: "replace-receipt-id",
      notApplicableReason: null,
    })),
    approvals: MAINNET_REVIEW_ROLES.map((role) => ({
      role,
      decision: "pending",
      reviewerId: "replace-reviewer-id",
      reviewedAt: templateTime(),
      receiptId: "replace-receipt-id",
    })),
    disposableTestnet: {
      decision: "pending",
      operatorId: "replace-operator-id",
      reviewedAt: templateTime(),
      receiptId: "replace-receipt-id",
    },
    candidateDecision: {
      decision: "pending",
      reviewerId: "replace-release-owner-id",
      reviewedAt: templateTime(),
      receiptId: "replace-receipt-id",
    },
    mainnetCanary: {
      decision: "pending",
      authorizationId: "replace-authorization-id",
      authorizedBy: "replace-authorizer-id",
      authorizedAt: templateTime(),
      authorizationExpiresAt: "1970-01-01T00:30:00.000Z",
      operatorId: "replace-operator-id",
      stopOwnerId: "replace-stop-owner-id",
      rollbackOwnerId: "replace-rollback-owner-id",
      maxCumulativeNotionalUsd: 100,
      maxOpenNotionalUsd: 50,
      maxOpenOrders: 1,
      maxLeverage: 2,
      maxDurationMinutes: 30,
      permittedActions: [...MAINNET_CANARY_ACTIONS],
      startedAt: null,
      completedAt: null,
      receiptId: null,
    },
    releaseDecision: {
      decision: "stop",
      reviewerId: "replace-release-owner-id",
      reviewedAt: templateTime(),
      receiptId: "replace-receipt-id",
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
