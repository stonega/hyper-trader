import { CONTRACT_LIMITS } from "@hyper-trader/notifications";

export interface NotificationServiceConfig {
  readonly serviceOrigin: string;
  readonly databaseUrl: string;
  readonly port: number;
  readonly providerWorkersEnabled: boolean;
  readonly upstreamUtilizationPercent: 70;
}

export function parseNotificationServiceConfig(
  environment: Readonly<Record<string, string | undefined>>,
): NotificationServiceConfig {
  const serviceOrigin = exactHttpsOrigin(
    required(
      environment.NOTIFICATION_SERVICE_ORIGIN,
      "NOTIFICATION_SERVICE_ORIGIN",
    ),
  );
  const databaseUrl = postgresUrl(
    required(
      environment.NOTIFICATION_DATABASE_URL,
      "NOTIFICATION_DATABASE_URL",
    ),
  );
  const portText = environment.NOTIFICATION_PORT ?? "8788";
  if (!/^[1-9][0-9]{0,4}$/.test(portText)) {
    throw new Error("notification port is invalid");
  }
  const port = Number(portText);
  if (port > 65_535) throw new Error("notification port is invalid");
  const workerFlag = environment.NOTIFICATION_ENABLE_PROVIDER_WORKERS;
  if (
    workerFlag !== undefined &&
    workerFlag !== "false" &&
    workerFlag !== "true"
  ) {
    throw new Error("notification provider worker flag is invalid");
  }
  return {
    serviceOrigin,
    databaseUrl,
    port,
    providerWorkersEnabled: workerFlag === "true",
    upstreamUtilizationPercent: CONTRACT_LIMITS.upstreamUtilizationPercent,
  };
}

function required(value: string | undefined, name: string): string {
  if (
    !value ||
    value.length > 2048 ||
    Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 32 || codePoint === 127;
    })
  ) {
    throw new Error(`${name} is missing or malformed`);
  }
  return value;
}

function exactHttpsOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("notification service must use an exact HTTPS origin");
  }
  if (
    url.protocol !== "https:" ||
    url.origin !== value ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("notification service must use an exact HTTPS origin");
  }
  return value;
}

function postgresUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("notification database URL is invalid");
  }
  if (
    (url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
    !url.hostname ||
    url.hash !== ""
  ) {
    throw new Error("notification database URL is invalid");
  }
  return value;
}
