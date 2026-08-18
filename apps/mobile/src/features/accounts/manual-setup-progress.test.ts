import { describe, expect, test } from "bun:test";
import {
  createManualSetupProgressRepository,
  MANUAL_SETUP_PROGRESS_KEY,
  parseManualSetupProgress,
} from "./manual-setup-progress";
import type { SetupAttempt } from "./setup-coordinator";

const ATTEMPT: SetupAttempt = {
  id: `0x${"a".repeat(64)}`,
  network: "testnet",
  connectorSessionId: "manual-session-1",
  masterAccount: "0x1111111111111111111111111111111111111111",
  targetAccount: "0x1111111111111111111111111111111111111111",
  agentAddress: "0x2222222222222222222222222222222222222222",
  registrationName: "ht-123456789abcd",
  registrationGeneration: 1,
  approvalNonce: 1_800_000_000_000,
  requestedExpiry: 1_802_592_000_000,
  createdAt: 1_800_000_000_000,
  expiresAt: 1_800_086_400_000,
};

describe("manual setup progress", () => {
  test("persists only public resumable setup state", async () => {
    const values = new Map<string, string>();
    const repository = createManualSetupProgressRepository({
      getItem: async (key) => values.get(key) ?? null,
      setItem: async (key, value) => {
        values.set(key, value);
      },
      removeItem: async (key) => {
        values.delete(key);
      },
    });

    await repository.saveProtection(
      ATTEMPT.masterAccount,
      "Stone API",
      ATTEMPT.createdAt,
    );
    await expect(repository.load()).resolves.toMatchObject({
      phase: "protection",
      masterAccount: ATTEMPT.masterAccount,
      registrationName: "Stone API",
    });
    await repository.saveAuthorization(ATTEMPT, ATTEMPT.createdAt + 1);
    await expect(repository.load()).resolves.toMatchObject({
      phase: "authorization",
      attempt: { agentAddress: ATTEMPT.agentAddress },
    });
    expect(values.get(MANUAL_SETUP_PROGRESS_KEY)).not.toContain("private");
    await repository.clear();
    await expect(repository.load()).resolves.toBeNull();
  });

  test("rejects unknown fields and a mismatched master target", () => {
    expect(() =>
      parseManualSetupProgress(
        JSON.stringify({
          version: 1,
          phase: "protection",
          masterAccount: ATTEMPT.masterAccount,
          updatedAt: ATTEMPT.createdAt,
          secret: "forbidden",
        }),
      ),
    ).toThrow("malformed");
    expect(() =>
      parseManualSetupProgress(
        JSON.stringify({
          version: 1,
          phase: "authorization",
          attempt: { ...ATTEMPT, targetAccount: ATTEMPT.agentAddress },
          updatedAt: ATTEMPT.createdAt,
        }),
      ),
    ).toThrow("malformed");
  });

  test("restores a legacy protection checkpoint for identity review", () => {
    expect(
      parseManualSetupProgress(
        JSON.stringify({
          version: 1,
          phase: "protection",
          masterAccount: ATTEMPT.masterAccount,
          updatedAt: ATTEMPT.createdAt,
        }),
      ),
    ).toEqual({
      version: 1,
      phase: "protection",
      masterAccount: ATTEMPT.masterAccount,
      registrationName: "",
      updatedAt: ATTEMPT.createdAt,
    });
  });
});
