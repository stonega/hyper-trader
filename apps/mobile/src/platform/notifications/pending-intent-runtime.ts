import AsyncStorage from "@react-native-async-storage/async-storage";

import { createPendingNotificationIntentStore } from "../../features/notifications/pending-intent";

export const pendingNotificationIntentStore =
  createPendingNotificationIntentStore(AsyncStorage);
