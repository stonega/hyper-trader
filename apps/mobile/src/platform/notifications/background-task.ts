import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";

import { extractAlertIdFromNotificationTask } from "./background-payload";
import { pendingNotificationIntentStore } from "./pending-intent-runtime";

export const BACKGROUND_NOTIFICATION_TASK =
  "hypertrader-background-notification-v1";

if (!TaskManager.isTaskDefined(BACKGROUND_NOTIFICATION_TASK)) {
  TaskManager.defineTask<Notifications.NotificationTaskPayload>(
    BACKGROUND_NOTIFICATION_TASK,
    async ({ data, error }) => {
      if (error) return Notifications.BackgroundNotificationTaskResult.Failed;
      const alertId = extractAlertIdFromNotificationTask(data);
      if (alertId === null) {
        return Notifications.BackgroundNotificationTaskResult.NoData;
      }
      try {
        await pendingNotificationIntentStore.save(alertId);
        return Notifications.BackgroundNotificationTaskResult.NewData;
      } catch {
        return Notifications.BackgroundNotificationTaskResult.Failed;
      }
    },
  );
}

export async function registerBackgroundNotificationTask(): Promise<void> {
  const registered = await TaskManager.isTaskRegisteredAsync(
    BACKGROUND_NOTIFICATION_TASK,
  );
  if (!registered) {
    await Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK);
  }
}
