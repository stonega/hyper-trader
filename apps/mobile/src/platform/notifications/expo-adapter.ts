export type NotificationPermissionState =
  | "undetermined"
  | "denied"
  | "authorized"
  | "provisional"
  | "ephemeral"
  | "unavailable";

export interface ExpoPermissionSnapshot {
  readonly granted: boolean;
  readonly canAskAgain: boolean;
  readonly status: "undetermined" | "denied" | "granted";
  readonly iosStatus?:
    | "not_determined"
    | "denied"
    | "authorized"
    | "provisional"
    | "ephemeral";
}

export interface ExpoNotificationPort {
  setChannel(): Promise<void>;
  getPermissions(): Promise<ExpoPermissionSnapshot>;
  requestPermissions(): Promise<ExpoPermissionSnapshot>;
  getPushToken(projectId: string): Promise<string>;
}

export interface ExpoNotificationAdapter {
  permission(): Promise<NotificationPermissionState>;
  requestAccessAndToken(): Promise<{
    readonly permission: NotificationPermissionState;
    readonly pushToken: string | null;
  }>;
  reacquireToken(): Promise<string>;
}

export function classifyExpoPermission(
  permission: ExpoPermissionSnapshot,
): NotificationPermissionState {
  if (permission.iosStatus === "provisional") return "provisional";
  if (permission.iosStatus === "ephemeral") return "ephemeral";
  if (permission.granted || permission.iosStatus === "authorized") {
    return "authorized";
  }
  if (
    permission.status === "denied" ||
    permission.iosStatus === "denied" ||
    !permission.canAskAgain
  ) {
    return "denied";
  }
  return "undetermined";
}

export function createExpoNotificationAdapter(options: {
  readonly platform: "ios" | "android";
  readonly projectId: string;
  readonly notifications: ExpoNotificationPort;
}): ExpoNotificationAdapter {
  if (options.projectId.trim() === "") {
    throw new TypeError(
      "An Expo project ID is required for push registration.",
    );
  }
  let channelReady: Promise<void> | null = null;
  const preparePlatform = async () => {
    if (options.platform !== "android") return;
    channelReady ??= options.notifications.setChannel().catch((error) => {
      channelReady = null;
      throw error;
    });
    await channelReady;
  };
  return {
    async permission() {
      return classifyExpoPermission(
        await options.notifications.getPermissions(),
      );
    },
    async requestAccessAndToken() {
      await preparePlatform();
      let permission = await options.notifications.getPermissions();
      let state = classifyExpoPermission(permission);
      if (state === "undetermined" && permission.canAskAgain) {
        permission = await options.notifications.requestPermissions();
        state = classifyExpoPermission(permission);
      }
      if (
        state !== "authorized" &&
        state !== "provisional" &&
        state !== "ephemeral"
      ) {
        return { permission: state, pushToken: null };
      }
      return {
        permission: state,
        pushToken: await options.notifications.getPushToken(options.projectId),
      };
    },
    async reacquireToken() {
      await preparePlatform();
      return options.notifications.getPushToken(options.projectId);
    },
  };
}
