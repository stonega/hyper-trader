const STORAGE_KEY = "hypertrader.notification.pending.v1";
const ALERT_ID = /^[0-9a-f]{32}$/;

export interface PendingNotificationIntentStore {
  save(alertId: string): Promise<void>;
  consume(): Promise<string | null>;
}

export function createPendingNotificationIntentStore(storage: {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}): PendingNotificationIntentStore {
  let serial = Promise.resolve();
  const write = <T>(work: () => Promise<T>): Promise<T> => {
    const next = serial.then(work, work);
    serial = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
  return {
    async save(alertId) {
      if (!ALERT_ID.test(alertId)) {
        throw new TypeError("The pending notification alert ID is malformed.");
      }
      await write(() => storage.setItem(STORAGE_KEY, alertId));
    },
    async consume() {
      return write(async () => {
        const alertId = await storage.getItem(STORAGE_KEY);
        if (alertId === null) return null;
        await storage.removeItem(STORAGE_KEY);
        return ALERT_ID.test(alertId) ? alertId : null;
      });
    },
  };
}
