import { describe, expect, spyOn, test } from "bun:test";
import type {
  MarketCatalog,
  PerpMarket,
} from "@hyper-trader/hyperliquid/public";

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
import {
  createMarketCatalogRequestHandler,
  createNotificationRequestHandler,
  startNotificationServer,
} from "./server";

const NATIVE_MARKET: PerpMarket = {
  family: "perp",
  canonicalId: "perp:0:0",
  displaySymbol: "BTC",
  coin: "BTC",
  dexIndex: 0,
  dexName: "",
  dexFullName: null,
  universeIndex: 0,
  orderAssetId: 0,
  sizeDecimals: 5,
  pricePrecision: { maxSignificantFigures: 5, maxDecimalPlaces: 1 },
  maxLeverage: 50,
  onlyIsolated: false,
  marginMode: null,
  marginTableId: null,
  lifecycle: "active",
  orderAvailability: "enabled",
  validationReasons: [],
  markPx: "100000",
};

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
  test("serves bounded read surfaces and rejects notification routes from the standalone handler", async () => {
    const handler = createMarketCatalogRequestHandler({
      serviceOrigin: "https://notify.example.com",
      marketCatalog: {
        readPublished: async (network) => ({
          network,
          generation: 4,
          publishedAtMs: 1_800_000_000_000,
          catalog: {
            markets: [NATIVE_MARKET],
            quarantined: [],
            sourceErrors: [],
          },
        }),
      },
    });

    expect(
      (
        await handler(
          new Request("https://notify.example.com/v1/market-catalog/testnet"),
        )
      ).status,
    ).toBe(200);
    expect(
      (await handler(new Request("https://notify.example.com/health"))).status,
    ).toBe(200);
    expect(
      (
        await handler(
          new Request("https://notify.example.com/v1/installations", {
            method: "POST",
          }),
        )
      ).status,
    ).toBe(405);
    expect(
      (await handler(new Request("https://notify.example.com/v1/alerts/abc")))
        .status,
    ).toBe(404);
  });

  test("serves the public privacy policy from both backend handlers", async () => {
    const serviceOrigin = "https://notify.example.com";
    const standalone = createMarketCatalogRequestHandler({
      serviceOrigin,
      marketCatalog: { readPublished: async () => null },
    });
    const notifications = createNotificationRequestHandler({
      application: new FakeApplication(),
      serviceOrigin,
    });

    const responses = [
      await standalone(new Request(`${serviceOrigin}/privacy`)),
      await notifications(new Request(`${serviceOrigin}/privacy`), {
        ip: "192.0.2.1",
      }),
    ];

    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(
        "text/html; charset=utf-8",
      );
      expect(response.headers.get("content-security-policy")).toContain(
        "frame-ancestors 'none'",
      );
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      const html = await response.text();
      expect(html).toContain("<title>Privacy Policy | Hyper Trader</title>");
      expect(html).toContain("<h1>Privacy policy</h1>");
      expect(html).toContain("Data retention and deletion");
      expect(html).toContain("Developer:</strong> Stonegate");
      expect(html).toContain(`${serviceOrigin}/privacy`);
    }

    const head = await standalone(
      new Request(`${serviceOrigin}/privacy`, { method: "HEAD" }),
    );
    expect(head.status).toBe(200);
    expect(head.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await head.text()).toBe("");
  });

  test("serves a generation-pinned public market catalog without bearer auth", async () => {
    const application = new FakeApplication();
    const marketCatalog: MarketCatalog = {
      markets: [NATIVE_MARKET],
      quarantined: [],
      sourceErrors: [],
    };
    const handler = createNotificationRequestHandler({
      application,
      serviceOrigin: "https://notify.example.com",
      marketCatalog: {
        readPublished: async (network) => ({
          network,
          generation: 7,
          publishedAtMs: 1_800_000_000_000,
          catalog: marketCatalog,
        }),
      },
    });

    const response = await handler(
      new Request("https://notify.example.com/v1/market-catalog/testnet"),
      { ip: "192.0.2.1" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"market-catalog-testnet-7"');
    expect(response.headers.get("cache-control")).toContain("stale-if-error");
    expect(await response.json()).toEqual({
      schemaVersion: 1,
      network: "testnet",
      generation: 7,
      publishedAtMs: 1_800_000_000_000,
      markets: [NATIVE_MARKET],
      quarantined: [],
      sourceErrors: [],
    });
    expect(application.calls).toEqual([]);

    const notModified = await handler(
      new Request("https://notify.example.com/v1/market-catalog/testnet", {
        headers: { "if-none-match": '"market-catalog-testnet-7"' },
      }),
      { ip: "192.0.2.1" },
    );
    expect(notModified.status).toBe(304);
  });

  test("serves a lightweight generation-bound market page before the full catalog", async () => {
    let generation = 7;
    const eth: PerpMarket = {
      ...NATIVE_MARKET,
      canonicalId: "perp:0:1",
      coin: "ETH",
      displaySymbol: "ETH",
      universeIndex: 1,
      orderAssetId: 1,
      dayNtlVlm: "200",
      markPx: "4000",
    };
    const btc: PerpMarket = {
      ...NATIVE_MARKET,
      dayNtlVlm: "100",
    };
    const hip3: PerpMarket = {
      ...NATIVE_MARKET,
      canonicalId: "perp:3:0",
      coin: "xyz:XYZ",
      displaySymbol: "XYZ",
      dexIndex: 3,
      dexName: "xyz",
      dexFullName: "XYZ Markets",
      orderAssetId: 130_000,
      dayNtlVlm: "50",
    };
    const handler = createMarketCatalogRequestHandler({
      serviceOrigin: "https://notify.example.com",
      marketCatalog: {
        readPublished: async (network) => ({
          network,
          generation,
          publishedAtMs: 1_800_000_000_000,
          catalog: {
            markets: [btc, eth, hip3],
            quarantined: [],
            sourceErrors: [],
          },
        }),
      },
    });

    const first = await handler(
      new Request(
        "https://notify.example.com/v1/market-summaries/testnet?limit=1&includeHip3=true",
      ),
    );
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      schemaVersion: 1,
      network: "testnet",
      generation: 7,
      publishedAtMs: 1_800_000_000_000,
      items: [
        {
          family: "perp",
          canonicalId: "perp:0:1",
          displaySymbol: "ETH",
          coin: "ETH",
          lifecycle: "active",
          orderAvailability: "enabled",
          pricePrecision: {
            maxSignificantFigures: 5,
            maxDecimalPlaces: 1,
          },
          dayNtlVlm: "200",
          markPx: "4000",
          dexIndex: 0,
          dexName: "",
          dexFullName: null,
          maxLeverage: 50,
        },
      ],
      total: 3,
      nextCursor: "g7o1",
      quarantinedCount: 0,
      sourceErrorCount: 0,
    });

    const second = await handler(
      new Request(
        "https://notify.example.com/v1/market-summaries/testnet?limit=1&cursor=g7o1",
      ),
    );
    expect(second.status).toBe(200);
    expect(
      ((await second.json()) as { items: { canonicalId: string }[] }).items[0]
        ?.canonicalId,
    ).toBe("perp:0:0");

    const filtered = await handler(
      new Request(
        "https://notify.example.com/v1/market-summaries/testnet?query=btc&family=perp",
      ),
    );
    expect(filtered.status).toBe(200);
    expect(((await filtered.json()) as { total: number }).total).toBe(1);

    const strict = await handler(
      new Request(
        "https://notify.example.com/v1/market-summaries/testnet?includeHip3=false",
      ),
    );
    expect(strict.status).toBe(200);
    const strictPage = (await strict.json()) as {
      items: { canonicalId: string }[];
      total: number;
    };
    expect(strictPage.total).toBe(2);
    expect(strictPage.items.map(({ canonicalId }) => canonicalId)).toEqual([
      eth.canonicalId,
      btc.canonicalId,
    ]);

    generation = 8;
    expect(
      (
        await handler(
          new Request(
            "https://notify.example.com/v1/market-summaries/testnet?cursor=g7o1",
          ),
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await handler(
          new Request(
            "https://notify.example.com/v1/market-summaries/testnet?unknown=true",
          ),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handler(
          new Request(
            "https://notify.example.com/v1/market-summaries/testnet?cursor=untrusted",
          ),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handler(
          new Request(
            "https://notify.example.com/v1/market-summaries/testnet?includeHip3=maybe",
          ),
        )
      ).status,
    ).toBe(400);
  });

  test("serves bounded no-store Portfolio aggregates without placing an address in the URL", async () => {
    const user = `0x${"1".repeat(40)}`;
    const calls: string[] = [];
    const handler = createMarketCatalogRequestHandler({
      serviceOrigin: "https://notify.example.com",
      marketCatalog: { readPublished: async () => null },
      portfolioSnapshots: {
        async readLive(input) {
          calls.push(`live:${input.network}:${input.user}`);
          return {
            schemaVersion: 1,
            network: input.network,
            user: input.user,
            generatedAtMs: 1_800_000_000_000,
            dexes: [],
            spot: { balances: [] },
            sourceGaps: [],
          };
        },
        async readHistory(input) {
          calls.push(`history:${input.network}:${input.user}`);
          return {
            schemaVersion: 1,
            network: input.network,
            user: input.user,
            generatedAtMs: 1_800_000_000_000,
            fills: [],
            funding: [],
            periods: [],
            sourceGaps: [],
          };
        },
      },
    });

    const response = await handler(
      new Request("https://notify.example.com/v1/portfolio-snapshots/live", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ network: "testnet", user }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(calls).toEqual([`live:testnet:${user}`]);
    expect(JSON.stringify(await response.json())).not.toContain("privateKey");
  });

  test("reports an unpublished or empty catalog as temporarily unavailable", async () => {
    const handler = createNotificationRequestHandler({
      application: new FakeApplication(),
      serviceOrigin: "https://notify.example.com",
      marketCatalog: { readPublished: async () => null },
    });
    const response = await handler(
      new Request("https://notify.example.com/v1/market-catalog/mainnet"),
      { ip: "192.0.2.1" },
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("30");

    const emptyHandler = createNotificationRequestHandler({
      application: new FakeApplication(),
      serviceOrigin: "https://notify.example.com",
      marketCatalog: {
        readPublished: async (network) => ({
          network,
          generation: 8,
          publishedAtMs: 1_800_000_000_000,
          catalog: { markets: [], quarantined: [], sourceErrors: [] },
        }),
      },
    });
    const emptyResponse = await emptyHandler(
      new Request("https://notify.example.com/v1/market-catalog/mainnet"),
      { ip: "192.0.2.1" },
    );
    expect(emptyResponse.status).toBe(503);
    expect(emptyResponse.headers.get("retry-after")).toBe("30");
  });

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

describe("notification server listener boundary", () => {
  test("passes externally supplied certificate and key material to Bun.serve", () => {
    const tls = {
      cert: "synthetic-certificate-material",
      key: "synthetic-private-key-material",
    };
    const expectedServer = {} as Bun.Server<undefined>;
    let received: Bun.Serve.Options<undefined> | undefined;
    const serve = spyOn(Bun, "serve");
    serve.mockImplementation(((options: Bun.Serve.Options<undefined>) => {
      received = options;
      return expectedServer;
    }) as typeof Bun.serve);

    let server: Bun.Server<undefined>;
    try {
      server = startNotificationServer({
        application: new FakeApplication(),
        serviceOrigin: "https://notify.example.com",
        port: 8788,
        serverBoundary: { transport: "direct-tls", tls },
      });
    } finally {
      serve.mockRestore();
    }

    expect(server).toBe(expectedServer);
    expect(received).toMatchObject({
      port: 8788,
      tls,
    });
  });

  test("rejects missing or mismatched HTTPS listener topology before serving", () => {
    const serve = spyOn(Bun, "serve");
    const base = {
      application: new FakeApplication(),
      serviceOrigin: "https://notify.example.com",
      port: 8788,
    };

    try {
      expect(() =>
        startNotificationServer(
          base as Parameters<typeof startNotificationServer>[0],
        ),
      ).toThrow("requires a direct TLS server boundary");
      expect(() =>
        startNotificationServer({
          ...base,
          serverBoundary: {
            transport: "trusted-forwarded-origin",
            tls: {
              cert: "synthetic-certificate-material",
              key: "synthetic-private-key-material",
            },
          },
        } as unknown as Parameters<typeof startNotificationServer>[0]),
      ).toThrow("requires a direct TLS server boundary");
      expect(() =>
        startNotificationServer({
          ...base,
          serverBoundary: {
            transport: "direct-tls",
            tls: { cert: "synthetic-certificate-material" },
          },
        } as unknown as Parameters<typeof startNotificationServer>[0]),
      ).toThrow("certificate and key material");
      expect(serve).not.toHaveBeenCalled();
    } finally {
      serve.mockRestore();
    }
  });
});
