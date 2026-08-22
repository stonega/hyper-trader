import { SQL } from "bun";

import { parseNotificationServiceConfig } from "../config";
import { migrateNotifications } from "../db/migrations";
import { composeMarketCatalogServiceRuntime } from "./catalog-service-runtime";
import { PostgresMarketCatalogStore } from "./market-catalog-store";

const config = parseNotificationServiceConfig(process.env);
const ownerId = catalogOwnerId(
  process.env.NOTIFICATION_INSTANCE_ID ?? `catalog:${process.pid}`,
);
const [cert, key, passphrase] = await Promise.all([
  readRequiredTlsFile(
    process.env.NOTIFICATION_TLS_CERT_FILE,
    "NOTIFICATION_TLS_CERT_FILE",
  ),
  readRequiredTlsFile(
    process.env.NOTIFICATION_TLS_KEY_FILE,
    "NOTIFICATION_TLS_KEY_FILE",
  ),
  readOptionalTlsFile(process.env.NOTIFICATION_TLS_PASSPHRASE_FILE),
]);

const sql = new SQL(config.databaseUrl, { max: 6 });
const controller = new AbortController();
const stop = () => controller.abort(new Error("service stopping"));
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

try {
  await migrateNotifications(sql);
  const store = new PostgresMarketCatalogStore(sql);
  const runtime = composeMarketCatalogServiceRuntime({
    serviceOrigin: config.serviceOrigin,
    port: config.port,
    ownerId,
    store,
    serverBoundary: {
      transport: "direct-tls",
      tls: { cert, key, ...(passphrase === undefined ? {} : { passphrase }) },
    },
  });
  await runtime.run(controller.signal);
} finally {
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
  await sql.close();
}

async function readRequiredTlsFile(
  path: string | undefined,
  name: string,
): Promise<string> {
  if (!path || path.includes("\0")) throw new Error(`${name} is missing`);
  const value = await boundedFile(path);
  if (value.length === 0) throw new Error(`${name} is empty`);
  return value;
}

async function readOptionalTlsFile(
  path: string | undefined,
): Promise<string | undefined> {
  if (path === undefined) return undefined;
  if (path.length === 0 || path.includes("\0")) {
    throw new Error("NOTIFICATION_TLS_PASSPHRASE_FILE is malformed");
  }
  const value = await boundedFile(path);
  if (value.length === 0) {
    throw new Error("NOTIFICATION_TLS_PASSPHRASE_FILE is empty");
  }
  return value.trimEnd();
}

async function boundedFile(path: string): Promise<string> {
  const file = Bun.file(path);
  if (!(await file.exists()) || file.size > 1024 * 1024) {
    throw new Error("TLS material file is unavailable or too large");
  }
  return file.text();
}

function catalogOwnerId(value: string): string {
  if (!/^[a-z0-9:_-]{1,128}$/.test(value)) {
    throw new Error("NOTIFICATION_INSTANCE_ID is invalid");
  }
  return value;
}
