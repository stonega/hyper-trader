import { describe, expect, test } from "bun:test";

import {
  MAINNET_TRADING_RELEASE_STAGE,
  type SignerBinding,
} from "@hyper-trader/hyperliquid";

import {
  AGENT_AUTHORIZATION_DURATION_MS,
  type AgentCredentialVault,
  type AgentRegistrationAuthority,
  createApiWalletSetupCoordinator,
  type MasterWalletApprovalAdapter,
  SETUP_ATTEMPT_DURATION_MS,
  type SetupAttempt,
  type SetupRepository,
} from "./setup-coordinator";

const MASTER = "0x1111111111111111111111111111111111111111";
const TARGET = "0x2222222222222222222222222222222222222222";
const AGENT = "0x3333333333333333333333333333333333333333";
const REGISTRATION_NAME = "Stone API";
const SERVER_TIME = 1_800_000_000_000;
const CONNECTOR_SESSION = "connector-session-7";

function bindingFor(attempt: SetupAttempt): SignerBinding {
  return {
    network: attempt.network,
    masterAccount: attempt.masterAccount,
    targetAccount: attempt.targetAccount,
    agentAddress: attempt.agentAddress,
    generation: attempt.registrationGeneration,
  };
}

function createHarness(
  options: {
    readonly registeredExpiry?: number | null;
    readonly registeredAddress?: string;
    readonly registeredName?: string;
    readonly authorizedTarget?: boolean;
    readonly verificationTime?: number;
    readonly deleteFails?: boolean;
  } = {},
) {
  const events: string[] = [];
  const attempts = new Map<string, SetupAttempt>();
  const active = new Map<string, SetupAttempt>();
  let authoritativeTime = SERVER_TIME;
  let secretDisposed = 0;
  let randomCalls = 0;

  const repository: SetupRepository = {
    nextGeneration: () => 1,
    getPendingAttemptForTarget(input) {
      return (
        [...attempts.values()].find(
          (attempt) =>
            attempt.network === input.network &&
            attempt.masterAccount === input.masterAccount &&
            attempt.targetAccount === input.targetAccount,
        ) ?? null
      );
    },
    createAttempt(attempt) {
      events.push("repository:create");
      attempts.set(attempt.id, attempt);
    },
    getPendingAttempt(id) {
      return attempts.get(id) ?? null;
    },
    consumeAndActivate(input) {
      const attempt = attempts.get(input.attemptId);
      if (!attempt || input.now >= attempt.expiresAt) return false;
      attempts.delete(input.attemptId);
      active.set(input.attemptId, attempt);
      events.push("repository:activate");
      return true;
    },
    cancelAttempt(id) {
      events.push(`repository:cancel:${id}`);
      attempts.delete(id);
    },
  };
  const vault: AgentCredentialVault = {
    async stage(input) {
      events.push("vault:stage");
      expect(input.secret.bytes).toHaveLength(32);
      input.secret.dispose();
      secretDisposed += 1;
    },
    async delete(binding) {
      events.push(`vault:delete:${binding.agentAddress}`);
      if (options.deleteFails) throw new Error("protected delete failed");
    },
  };
  const authority: AgentRegistrationAuthority = {
    async inspect(input) {
      events.push("authority:inspect");
      return {
        authoritativeTime,
        targetAuthorized: options.authorizedTarget ?? true,
        targetKind:
          input.masterAccount === input.targetAccount ? "master" : "subaccount",
      };
    },
    async verify(input) {
      events.push("authority:verify");
      const attempt = [...attempts.values()].find(
        (candidate) => candidate.agentAddress === input.agentAddress,
      );
      return {
        authoritativeTime: options.verificationTime ?? SERVER_TIME + 2_000,
        targetAuthorized: true,
        registration:
          attempt === undefined
            ? null
            : {
                agentAddress: options.registeredAddress ?? input.agentAddress,
                registrationName:
                  options.registeredName ?? attempt.registrationName,
                validUntil:
                  options.registeredExpiry === undefined
                    ? attempt.requestedExpiry
                    : options.registeredExpiry,
              },
      };
    },
  };
  const wallet: MasterWalletApprovalAdapter = {
    async requestApproval(input) {
      events.push("wallet:approval");
      expect(input.attempt.connectorSessionId).toBe(CONNECTOR_SESSION);
      expect(input.typedData.network).toBe("testnet");
      return { status: "returned" };
    },
  };
  const coordinator = createApiWalletSetupCoordinator({
    authority,
    repository,
    vault,
    wallet,
    clock: { now: () => SERVER_TIME + 1_000 },
    randomBytes: async (length) => {
      randomCalls += 1;
      const bytes = new Uint8Array(length);
      bytes.fill(7 + randomCalls);
      return bytes;
    },
    deriveAgentAddress: async () => AGENT,
  });
  return {
    active,
    attempts,
    coordinator,
    events,
    get randomCalls() {
      return randomCalls;
    },
    get secretDisposed() {
      return secretDisposed;
    },
    setAuthoritativeTime(value: number) {
      authoritativeTime = value;
    },
  };
}

async function prepare(harness: ReturnType<typeof createHarness>) {
  return harness.coordinator.prepare({
    network: "testnet",
    connectorSessionId: CONNECTOR_SESSION,
    connectedMasterAccount: MASTER,
    targetAccount: TARGET,
    registrationName: REGISTRATION_NAME,
  });
}

describe("API-wallet setup coordinator", () => {
  test("stages a target-bound secret before handoff with fixed expiries", async () => {
    const harness = createHarness();
    const attempt = await prepare(harness);

    expect(attempt.requestedExpiry).toBe(
      SERVER_TIME + AGENT_AUTHORIZATION_DURATION_MS,
    );
    expect(attempt.expiresAt).toBe(SERVER_TIME + SETUP_ATTEMPT_DURATION_MS);
    expect(attempt.registrationName).toBe(REGISTRATION_NAME);
    expect(bindingFor(attempt)).toEqual({
      network: "testnet",
      masterAccount: MASTER,
      targetAccount: TARGET,
      agentAddress: AGENT,
      generation: 1,
    });
    expect(harness.events).toEqual([
      "authority:inspect",
      "vault:stage",
      "repository:create",
    ]);

    await harness.coordinator.requestApproval(attempt.id);
    expect(harness.events.at(-1)).toBe("wallet:approval");
    expect(harness.secretDisposed).toBe(1);
  });

  test("applies the compile-owned mainnet stage before key generation", async () => {
    const harness = createHarness();
    const prepareMainnet = harness.coordinator.prepare({
      network: "mainnet",
      connectorSessionId: CONNECTOR_SESSION,
      connectedMasterAccount: MASTER,
      targetAccount: TARGET,
      registrationName: REGISTRATION_NAME,
    });
    if (MAINNET_TRADING_RELEASE_STAGE === "preactivation") {
      await expect(prepareMainnet).rejects.toThrow(
        "mainnet signer access is disabled",
      );
      expect(harness.events).toEqual([]);
      expect(harness.randomCalls).toBe(0);
    } else {
      await expect(prepareMainnet).resolves.toMatchObject({
        network: "mainnet",
      });
      expect(harness.events).toEqual([
        "authority:inspect",
        "vault:stage",
        "repository:create",
      ]);
      expect(harness.randomCalls).toBe(2);
    }
  });

  test("rejects a target relationship before generating or storing a key", async () => {
    const harness = createHarness({ authorizedTarget: false });
    await expect(prepare(harness)).rejects.toThrow("authoritatively linked");
    expect(harness.events).toEqual(["authority:inspect"]);
    expect(harness.randomCalls).toBe(0);
  });

  test("treats forged and duplicate returns as inert and activates from authority once", async () => {
    const harness = createHarness();
    const attempt = await prepare(harness);

    const forged = await harness.coordinator.verifyExternalReturn({
      attemptId: attempt.id,
      connectorSessionId: "forged-session",
    });
    expect(forged).toEqual({ status: "inert", reason: "binding_mismatch" });
    expect(harness.events).not.toContain("authority:verify");

    const activated = await harness.coordinator.verifyExternalReturn({
      attemptId: attempt.id,
      connectorSessionId: CONNECTOR_SESSION,
    });
    expect(activated.status).toBe("activated");
    expect(harness.active.size).toBe(1);

    const duplicate = await harness.coordinator.verifyExternalReturn({
      attemptId: attempt.id,
      connectorSessionId: CONNECTOR_SESSION,
    });
    expect(duplicate).toEqual({ status: "inert", reason: "not_pending" });
    expect(harness.active.size).toBe(1);
  });

  test("accepts any finite future registration expiry", async () => {
    for (const effectiveExpiry of [
      SERVER_TIME + 20 * 24 * 60 * 60 * 1_000,
      SERVER_TIME + 90 * 24 * 60 * 60 * 1_000,
    ]) {
      const harness = createHarness({ registeredExpiry: effectiveExpiry });
      const attempt = await prepare(harness);

      const result = await harness.coordinator.verifyExternalReturn({
        attemptId: attempt.id,
        connectorSessionId: CONNECTOR_SESSION,
      });
      expect(result).toMatchObject({
        status: "activated",
        effectiveExpiry,
      });
      expect(harness.active.size).toBe(1);
    }
  });

  test("verifies by exact address when the returned name differs", async () => {
    const verificationTime = SERVER_TIME + 2_000;
    const harness = createHarness({
      registeredName: "Different label",
      registeredExpiry: verificationTime + AGENT_AUTHORIZATION_DURATION_MS,
      verificationTime,
    });
    const attempt = await prepare(harness);

    const result = await harness.coordinator.verifyExternalReturn({
      attemptId: attempt.id,
      connectorSessionId: CONNECTOR_SESSION,
    });

    expect(result.status).toBe("activated");
    expect(harness.active.size).toBe(1);
  });

  test("keeps an address with no authoritative expiry inactive", async () => {
    const harness = createHarness({ registeredExpiry: null });
    const attempt = await prepare(harness);

    await expect(
      harness.coordinator.verifyExternalReturn({
        attemptId: attempt.id,
        connectorSessionId: CONNECTOR_SESSION,
      }),
    ).resolves.toEqual({
      status: "inert",
      reason: "registration_unverified",
    });
    expect(harness.active.size).toBe(0);
  });

  test("keeps an address with an expired authoritative expiry inactive", async () => {
    const verificationTime = SERVER_TIME + 2_000;
    const harness = createHarness({
      registeredExpiry: verificationTime - 1,
      verificationTime,
    });
    const attempt = await prepare(harness);

    await expect(
      harness.coordinator.verifyExternalReturn({
        attemptId: attempt.id,
        connectorSessionId: CONNECTOR_SESSION,
      }),
    ).resolves.toEqual({
      status: "inert",
      reason: "registration_unverified",
    });
    expect(harness.active.size).toBe(0);
  });

  test("does not activate when only the wallet name matches", async () => {
    const harness = createHarness({
      registeredAddress: "0x4444444444444444444444444444444444444444",
      registeredName: REGISTRATION_NAME,
    });
    const attempt = await prepare(harness);

    await expect(
      harness.coordinator.verifyExternalReturn({
        attemptId: attempt.id,
        connectorSessionId: CONNECTOR_SESSION,
      }),
    ).resolves.toEqual({
      status: "inert",
      reason: "registration_unverified",
    });
    expect(harness.active.size).toBe(0);
  });

  test("authoritative time expires an attempt even after local clock rollback", async () => {
    const harness = createHarness({
      verificationTime: SERVER_TIME + SETUP_ATTEMPT_DURATION_MS,
    });
    const attempt = await prepare(harness);
    const result = await harness.coordinator.verifyExternalReturn({
      attemptId: attempt.id,
      connectorSessionId: CONNECTOR_SESSION,
    });
    expect(result).toEqual({ status: "inert", reason: "expired" });
    expect(harness.active.size).toBe(0);
    expect(harness.events.slice(-2)).toEqual([
      `vault:delete:${AGENT}`,
      `repository:cancel:${attempt.id}`,
    ]);
  });

  test("retires an expired pending attempt before preparing a fresh credential", async () => {
    const harness = createHarness();
    const expired = await prepare(harness);
    harness.setAuthoritativeTime(expired.expiresAt);

    const fresh = await prepare(harness);

    expect(fresh.id).not.toBe(expired.id);
    expect(harness.attempts.has(expired.id)).toBe(false);
    expect(harness.attempts.has(fresh.id)).toBe(true);
    const deleteIndex = harness.events.indexOf(`vault:delete:${AGENT}`);
    const cancelIndex = harness.events.indexOf(
      `repository:cancel:${expired.id}`,
    );
    expect(deleteIndex).toBeGreaterThan(-1);
    expect(cancelIndex).toBeGreaterThan(deleteIndex);
  });

  test("preserves an expired checkpoint when protected deletion fails", async () => {
    const harness = createHarness({ deleteFails: true });
    const expired = await prepare(harness);
    harness.setAuthoritativeTime(expired.expiresAt);

    await expect(prepare(harness)).rejects.toThrow("protected delete failed");

    expect(harness.attempts.has(expired.id)).toBe(true);
    expect(harness.events).not.toContain(`repository:cancel:${expired.id}`);
  });

  test("a new process can resume an agent registered while the app was closed", async () => {
    const harness = createHarness();
    const attempt = await prepare(harness);
    const resumedCoordinator = createApiWalletSetupCoordinator({
      authority: {
        inspect: async () => {
          throw new Error("prepare should not repeat");
        },
        verify: async (input) => ({
          authoritativeTime: SERVER_TIME + 5_000,
          targetAuthorized: true,
          registration: {
            agentAddress: input.agentAddress,
            registrationName: attempt.registrationName,
            validUntil: attempt.requestedExpiry,
          },
        }),
      },
      repository: {
        nextGeneration: () => 1,
        getPendingAttemptForTarget: () => null,
        createAttempt: () => undefined,
        getPendingAttempt: (id) => harness.attempts.get(id) ?? null,
        consumeAndActivate(input) {
          const pending = harness.attempts.get(input.attemptId);
          if (!pending) return false;
          harness.attempts.delete(input.attemptId);
          harness.active.set(input.attemptId, pending);
          return true;
        },
        cancelAttempt: () => undefined,
      },
      vault: { stage: async () => undefined, delete: async () => undefined },
      wallet: { requestApproval: async () => ({ status: "returned" }) },
      clock: { now: () => SERVER_TIME + 4_000 },
      randomBytes: async (length) => new Uint8Array(length).fill(1),
      deriveAgentAddress: async () => AGENT,
    });

    const result = await resumedCoordinator.verifyExternalReturn({
      attemptId: attempt.id,
      connectorSessionId: CONNECTOR_SESSION,
    });
    expect(result.status).toBe("activated");
  });
});
