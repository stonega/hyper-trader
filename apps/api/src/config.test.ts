import { describe, expect, test } from "bun:test";

import { parseNotificationServiceConfig } from "./config";

describe("notification service deployment configuration", () => {
  test("accepts a fixed HTTPS origin and an explicit disabled worker gate", () => {
    expect(
      parseNotificationServiceConfig({
        NOTIFICATION_SERVICE_ORIGIN: "https://notify.example.com",
        NOTIFICATION_DATABASE_URL:
          "postgres://notification.internal/hyper_trader",
        NOTIFICATION_PORT: "8788",
        NOTIFICATION_ENABLE_PROVIDER_WORKERS: "false",
      }),
    ).toEqual({
      serviceOrigin: "https://notify.example.com",
      databaseUrl: "postgres://notification.internal/hyper_trader",
      port: 8788,
      providerWorkersEnabled: false,
      upstreamUtilizationPercent: 70,
    });
  });

  test("accepts an explicit worker request without bypassing database gates", () => {
    expect(
      parseNotificationServiceConfig({
        NOTIFICATION_SERVICE_ORIGIN: "https://notify.example.com",
        NOTIFICATION_DATABASE_URL:
          "postgres://notification.internal/hyper_trader",
        NOTIFICATION_ENABLE_PROVIDER_WORKERS: "true",
      }).providerWorkersEnabled,
    ).toBe(true);
  });

  test("fails closed on insecure origins, invalid ports, and malformed flags", () => {
    const base = {
      NOTIFICATION_SERVICE_ORIGIN: "https://notify.example.com",
      NOTIFICATION_DATABASE_URL:
        "postgres://notification.internal/hyper_trader",
    };
    expect(() =>
      parseNotificationServiceConfig({
        ...base,
        NOTIFICATION_SERVICE_ORIGIN: "http://notify.example.com",
      }),
    ).toThrow("HTTPS origin");
    expect(() =>
      parseNotificationServiceConfig({ ...base, NOTIFICATION_PORT: "0" }),
    ).toThrow("port");
    expect(() =>
      parseNotificationServiceConfig({
        ...base,
        NOTIFICATION_ENABLE_PROVIDER_WORKERS: "yes",
      }),
    ).toThrow("flag");
  });
});
