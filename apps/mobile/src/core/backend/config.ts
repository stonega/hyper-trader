import Constants from "expo-constants";

export function configuredBackendOrigin(): string | null {
  const origin =
    process.env.EXPO_PUBLIC_BACKEND_ORIGIN ??
    process.env.EXPO_PUBLIC_NOTIFICATION_SERVICE_ORIGIN ??
    Constants.expoConfig?.extra?.backendOrigin ??
    Constants.expoConfig?.extra?.notificationServiceOrigin;
  // Keep invalid configured values explicit so clients fail closed rather than
  // enabling the unconfigured development bootstrap.
  return typeof origin === "string" && origin.length > 0 ? origin : null;
}
