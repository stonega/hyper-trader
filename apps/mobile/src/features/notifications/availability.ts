/**
 * Release gate for user-managed notifications.
 *
 * Keep the runtime and safe notification-entry boundary mounted so existing
 * installations fail safely, but do not expose rule management until the
 * notification service and physical-device delivery evidence are ready.
 */
export const NOTIFICATION_SETTINGS_AVAILABLE: boolean = false;
