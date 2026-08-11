import { describe, expect, test } from "bun:test";

import type {
  AccountLinkResponse,
  ChallengeResponse,
  CredentialRotationResponse,
  DeletedRuleResponse,
  DrainResponse,
  InstallationResponse,
  LostRevokeResponse,
  MobileAlertResponse,
  MobileInstallationSnapshotResponse,
  NotificationApplication,
  NotificationApplicationContext,
  PushTokenResponse,
  RuleResponse,
} from "./application";
import { createNotificationRequestHandler } from "./server";

class FakeApplication implements NotificationApplication {
  calls: string[] = [];

  async registerInstallation(): Promise<InstallationResponse> {
    this.calls.push("register");
    return { installationId: "11".repeat(16), state: "active" };
  }

  async issueChallenge(): Promise<ChallengeResponse> {
    this.calls.push("challenge");
    return {
      challenge: "22".repeat(32),
      issuedAt: 1_800_000_000_000,
      expiresAt: 1_800_000_300_000,
      operationDigest: "23".repeat(32),
      proofVersion: 1,
    };
  }

  async verifyAccountLink(): Promise<AccountLinkResponse> {
    this.calls.push("link");
    return { accountLinkId: "24".repeat(16), state: "active" };
  }

  async putRule(): Promise<RuleResponse> {
    this.calls.push("rule");
    return { ruleId: "25".repeat(16), state: "active" };
  }

  async revokeInstallation(): Promise<DrainResponse> {
    this.calls.push("revoke");
    return { operationId: "26".repeat(16), state: "draining" };
  }

  async unlinkAccount(): Promise<DrainResponse> {
    this.calls.push("unlink");
    return { operationId: "27".repeat(16), state: "draining" };
  }

  async revokeLostInstallations(): Promise<LostRevokeResponse> {
    this.calls.push("revoke-lost");
    return {
      state: "accepted",
      operations: [{ operationId: "28".repeat(16), state: "draining" }],
    };
  }

  async rotateInstallationCredential(): Promise<CredentialRotationResponse> {
    this.calls.push("rotate-credential");
    return {
      installationId: "11".repeat(16),
      state: "active",
      credentialGeneration: 2,
    };
  }

  async rebindPushToken(): Promise<PushTokenResponse> {
    this.calls.push("rebind-token");
    return { tokenFingerprint: "29".repeat(32), state: "active" };
  }

  async readInstallationSnapshot(): Promise<MobileInstallationSnapshotResponse> {
    this.calls.push("snapshot");
    return {
      installationId: "11".repeat(16),
      state: "active",
      tokenState: "active",
      deliveryHealth: "healthy",
      pendingDeliveryCount: 0,
      unknownDeliveryCount: 0,
      accountLinks: [],
      rules: [],
    };
  }

  async readAlert(): Promise<MobileAlertResponse> {
    this.calls.push("alert");
    return {
      alertId: "30".repeat(16),
      state: "active",
      category: "price",
      network: "testnet",
      routeHint: "trade",
      createdAtMs: 1_800_000_000_000,
      deliveryState: "provider_accepted",
      rule: {
        ruleId: "25".repeat(16),
        scope: "price",
        marketId: "perp:BTC",
        eventType: "price_above",
      },
      account: null,
    };
  }

  async deletePriceRule(): Promise<DeletedRuleResponse> {
    this.calls.push("delete-price-rule");
    return { ruleId: "25".repeat(16), state: "deleted" };
  }
}

function request(
  path: string,
  body: unknown,
  credential = "33".repeat(32),
  method = "POST",
): Request {
  return new Request(`https://notify.example.com${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${credential}`,
      "content-length": String(
        new TextEncoder().encode(JSON.stringify(body)).length,
      ),
    },
    body: JSON.stringify(body),
  });
}

function getRequest(path: string, credential = "33".repeat(32)): Request {
  return new Request(`https://notify.example.com${path}`, {
    headers: { authorization: `Bearer ${credential}` },
  });
}

describe("bounded public notification API", () => {
  test("routes bounded strict requests without exposing private authority", async () => {
    const application = new FakeApplication();
    const handler = createNotificationRequestHandler({
      application,
      serviceOrigin: "https://notify.example.com",
    });
    const response = await handler(
      request("/v1/installations", {
        installationId: "11".repeat(16),
        credential: "33".repeat(32),
        provider: "expo",
        pushToken: "ExponentPushToken[synthetic-token]",
      }),
      { ip: "192.0.2.1" } satisfies NotificationApplicationContext,
    );
    expect(response.status).toBe(201);
    expect(application.calls).toEqual(["register"]);
    expect(await response.json()).toEqual({
      installationId: "11".repeat(16),
      state: "active",
    });
  });

  test("rejects oversized, forbidden, wrong-origin, and malformed auth input", async () => {
    const application = new FakeApplication();
    const handler = createNotificationRequestHandler({
      application,
      serviceOrigin: "https://notify.example.com",
    });
    const forbidden = await handler(
      request("/v1/installations", {
        installationId: "11".repeat(16),
        credential: "33".repeat(32),
        provider: "expo",
        pushToken: "ExponentPushToken[synthetic-token]",
        privateKey: "never",
      }),
      { ip: "192.0.2.1" },
    );
    expect(forbidden.status).toBe(400);
    const oversized = new Request(
      "https://notify.example.com/v1/installations",
      {
        method: "POST",
        headers: {
          "content-length": "65537",
          "content-type": "application/json",
        },
        body: "{}",
      },
    );
    expect((await handler(oversized, { ip: "192.0.2.1" })).status).toBe(413);
    expect(
      (
        await handler(
          new Request("https://evil.example/v1/installations", {
            method: "POST",
          }),
          { ip: "192.0.2.1" },
        )
      ).status,
    ).toBe(421);
    expect(application.calls).toEqual([]);
  });

  test("strictly routes credential rotation and proof-bound token rebind", async () => {
    const application = new FakeApplication();
    const handler = createNotificationRequestHandler({
      application,
      serviceOrigin: "https://notify.example.com",
    });
    const context = { ip: "192.0.2.1" };
    const installationId = "11".repeat(16);
    expect(
      (
        await handler(
          request(
            `/v1/installations/${installationId}/credential`,
            { installationId, newCredential: "44".repeat(32) },
            undefined,
            "PUT",
          ),
          context,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await handler(
          request(
            `/v1/installations/${installationId}/push-token`,
            {
              installationId,
              accountLinkId: "55".repeat(16),
              provider: "expo",
              pushToken: "ExponentPushToken[replacement]",
              proof: {
                challenge: "66".repeat(32),
                message: "canonical-message",
                signature: `0x${"77".repeat(65)}`,
              },
            },
            undefined,
            "PUT",
          ),
          context,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await handler(
          request(
            `/v1/installations/${"99".repeat(16)}/credential`,
            { installationId, newCredential: "44".repeat(32) },
            undefined,
            "PUT",
          ),
          context,
        )
      ).status,
    ).toBe(400);
    expect(application.calls).toEqual(["rotate-credential", "rebind-token"]);
  });

  test("rejects forged endpoint shapes before application dispatch", async () => {
    const application = new FakeApplication();
    const handler = createNotificationRequestHandler({
      application,
      serviceOrigin: "https://notify.example.com",
    });
    const context = { ip: "192.0.2.1" };
    expect(
      (
        await handler(
          request("/v1/challenges", {
            installationId: "11".repeat(16),
            network: "Testnet",
            masterAccount: `0x${"22".repeat(20)}`,
            targetAccount: `0x${"33".repeat(20)}`,
            purpose: "notification-account-link",
            operationDigest: "44".repeat(32),
          }),
          context,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handler(
          request(
            `/v1/rules/${"55".repeat(16)}`,
            {
              ruleId: "56".repeat(16),
              scope: "price",
              network: "testnet",
              marketId: "perp:BTC",
              eventType: "price_above",
              threshold: "1",
            },
            undefined,
            "PUT",
          ),
          context,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handler(
          request("/v1/account-links/verify", {
            installationId: "11".repeat(16),
            accountLinkId: "55".repeat(16),
            challenge: "66".repeat(32),
            message: "canonical-message",
            signature: `0x${"77".repeat(65)}`,
            authority: "master",
          }),
          context,
        )
      ).status,
    ).toBe(400);
    expect(application.calls).toEqual([]);
  });

  test("fails closed when an application adapter returns extra sensitive fields", async () => {
    const application = new FakeApplication();
    (
      application as unknown as {
        registerInstallation: () => Promise<unknown>;
      }
    ).registerInstallation = async () => ({
      installationId: "11".repeat(16),
      state: "active",
      ciphertext: "must-not-escape",
      credential: "must-not-escape",
      signature: "must-not-escape",
    });
    const handler = createNotificationRequestHandler({
      application,
      serviceOrigin: "https://notify.example.com",
    });
    const response = await handler(
      request("/v1/installations", {
        installationId: "11".repeat(16),
        credential: "33".repeat(32),
        provider: "expo",
        pushToken: "ExponentPushToken[synthetic-token]",
      }),
      { ip: "192.0.2.1" },
    );
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ error: "internal_error" });
    expect(body).not.toContain("must-not-escape");
  });

  test("authenticates bounded mobile snapshot and opaque alert reads", async () => {
    const application = new FakeApplication();
    const handler = createNotificationRequestHandler({
      application,
      serviceOrigin: "https://notify.example.com",
    });
    const context = { ip: "192.0.2.1" };
    expect(
      (
        await handler(
          getRequest(`/v1/installations/${"11".repeat(16)}/snapshot`),
          context,
        )
      ).status,
    ).toBe(200);
    expect(
      (await handler(getRequest(`/v1/alerts/${"30".repeat(16)}`), context))
        .status,
    ).toBe(200);
    expect(application.calls).toEqual(["snapshot", "alert"]);
  });

  test("routes bearer-only price deletion and price-only token rotation", async () => {
    const application = new FakeApplication();
    const handler = createNotificationRequestHandler({
      application,
      serviceOrigin: "https://notify.example.com",
    });
    const context = { ip: "192.0.2.1" };
    const installationId = "11".repeat(16);
    const ruleId = "25".repeat(16);
    expect(
      (
        await handler(
          request(
            `/v1/rules/${ruleId}`,
            { installationId, ruleId },
            undefined,
            "DELETE",
          ),
          context,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await handler(
          request(
            `/v1/installations/${installationId}/push-token`,
            {
              installationId,
              provider: "expo",
              pushToken: "ExponentPushToken[price-only-replacement]",
            },
            undefined,
            "PUT",
          ),
          context,
        )
      ).status,
    ).toBe(200);
    expect(application.calls).toEqual(["delete-price-rule", "rebind-token"]);
  });

  test("does not dispatch malformed mobile read or delete paths", async () => {
    const application = new FakeApplication();
    const handler = createNotificationRequestHandler({
      application,
      serviceOrigin: "https://notify.example.com",
    });
    const context = { ip: "192.0.2.1" };
    expect(
      (
        await handler(
          getRequest(`/v1/installations/${"11".repeat(15)}/snapshot`),
          context,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await handler(
          request(
            `/v1/rules/${"25".repeat(16)}`,
            {
              installationId: "11".repeat(16),
              ruleId: "26".repeat(16),
            },
            undefined,
            "DELETE",
          ),
          context,
        )
      ).status,
    ).toBe(400);
    expect(application.calls).toEqual([]);
  });
});
