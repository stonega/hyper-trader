const KEY = "hypertrader.notification.installation.v1";
const INSTALLATION_ID = /^[0-9a-f]{32}$/;

export interface NotificationInstallationState {
  readonly installationId: string;
  readonly pendingRevocationOperationId: string | null;
}

export function createNotificationInstallationStateStore(storage: {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}) {
  const read = async (): Promise<NotificationInstallationState | null> => {
    const serialized = await storage.getItem(KEY);
    if (serialized === null) return null;
    try {
      const value = JSON.parse(serialized) as Record<string, unknown>;
      if (
        typeof value === "object" &&
        value !== null &&
        Object.keys(value).length === 2 &&
        value.version === 1 &&
        typeof value.installationId === "string" &&
        INSTALLATION_ID.test(value.installationId)
      ) {
        return {
          installationId: value.installationId,
          pendingRevocationOperationId: null,
        };
      }
      if (
        typeof value === "object" &&
        value !== null &&
        Object.keys(value).length === 3 &&
        value.version === 2 &&
        typeof value.installationId === "string" &&
        INSTALLATION_ID.test(value.installationId) &&
        (value.pendingRevocationOperationId === null ||
          (typeof value.pendingRevocationOperationId === "string" &&
            INSTALLATION_ID.test(value.pendingRevocationOperationId)))
      ) {
        return {
          installationId: value.installationId,
          pendingRevocationOperationId: value.pendingRevocationOperationId as
            | string
            | null,
        };
      }
    } catch {
      // The malformed record is cleared below.
    }
    await storage.removeItem(KEY);
    return null;
  };
  return {
    read,
    async write(installationId: string): Promise<void> {
      if (!INSTALLATION_ID.test(installationId)) {
        throw new TypeError("The notification installation ID is malformed.");
      }
      await storage.setItem(
        KEY,
        serialize({ installationId, pendingRevocationOperationId: null }),
      );
    },
    async setPendingRevocationOperation(operationId: string): Promise<void> {
      if (!INSTALLATION_ID.test(operationId)) {
        throw new TypeError(
          "The notification revocation operation ID is malformed.",
        );
      }
      const current = await read();
      if (current === null) {
        throw new Error("The notification installation is unavailable.");
      }
      await storage.setItem(
        KEY,
        serialize({
          installationId: current.installationId,
          pendingRevocationOperationId: operationId,
        }),
      );
    },
    async clear(): Promise<void> {
      await storage.removeItem(KEY);
    },
  };
}

function serialize(state: NotificationInstallationState): string {
  return JSON.stringify({ version: 2, ...state });
}
