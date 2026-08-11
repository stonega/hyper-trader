import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import {
  createExpoNotificationAdapter,
  type ExpoNotificationAdapter,
  type ExpoPermissionSnapshot,
} from "./expo-adapter";

export const NOTIFICATION_CHANNEL_ID = "trading-alerts";

export function expoProjectId(): string | null {
  const configured = Constants.expoConfig?.extra?.eas?.projectId;
  const projectId = Constants.easConfig?.projectId ?? configured;
  return typeof projectId === "string" && projectId.trim() !== ""
    ? projectId
    : null;
}

export function createRuntimeExpoNotificationAdapter(): ExpoNotificationAdapter | null {
  const projectId = expoProjectId();
  if (
    projectId === null ||
    (Platform.OS !== "ios" && Platform.OS !== "android")
  ) {
    return null;
  }
  return createExpoNotificationAdapter({
    platform: Platform.OS,
    projectId,
    notifications: {
      async setChannel() {
        await Notifications.setNotificationChannelAsync(
          NOTIFICATION_CHANNEL_ID,
          {
            name: "Trading alerts",
            importance: Notifications.AndroidImportance.HIGH,
            lockscreenVisibility:
              Notifications.AndroidNotificationVisibility.PRIVATE,
            vibrationPattern: [0, 200],
          },
        );
      },
      async getPermissions() {
        return permissionSnapshot(await Notifications.getPermissionsAsync());
      },
      async requestPermissions() {
        return permissionSnapshot(
          await Notifications.requestPermissionsAsync({
            ios: { allowAlert: true, allowBadge: true, allowSound: false },
          }),
        );
      },
      async getPushToken(requestedProjectId) {
        const token = await Notifications.getExpoPushTokenAsync({
          projectId: requestedProjectId,
        });
        return token.data;
      },
    },
  });
}

export function installForegroundNotificationPolicy(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

function permissionSnapshot(
  value: Notifications.NotificationPermissionsStatus,
): ExpoPermissionSnapshot {
  return {
    granted: value.granted,
    canAskAgain: value.canAskAgain,
    status:
      value.status === Notifications.PermissionStatus.GRANTED
        ? "granted"
        : value.status === Notifications.PermissionStatus.DENIED
          ? "denied"
          : "undetermined",
    ...(value.ios?.status === undefined
      ? {}
      : { iosStatus: iosAuthorizationStatus(value.ios.status) }),
  };
}

function iosAuthorizationStatus(
  value: Notifications.IosAuthorizationStatus,
): NonNullable<ExpoPermissionSnapshot["iosStatus"]> {
  if (value === Notifications.IosAuthorizationStatus.AUTHORIZED) {
    return "authorized";
  }
  if (value === Notifications.IosAuthorizationStatus.PROVISIONAL) {
    return "provisional";
  }
  if (value === Notifications.IosAuthorizationStatus.EPHEMERAL) {
    return "ephemeral";
  }
  if (value === Notifications.IosAuthorizationStatus.DENIED) return "denied";
  return "not_determined";
}
