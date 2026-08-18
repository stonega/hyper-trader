import { parseNotificationPayload } from "../../features/notifications/intent";

export function extractAlertIdFromNotificationTask(
  value: unknown,
): string | null {
  const input = record(value);
  if (!input) return null;
  const responseNotification = record(input.notification);
  const request = record(responseNotification?.request);
  const content = record(request?.content);
  const visible = parseNotificationPayload(content?.data);
  if (visible) return visible.alertId;

  const headlessData = record(input.data);
  const dataString = headlessData?.dataString;
  if (typeof dataString !== "string" || dataString.length > 2_048) return null;
  try {
    return parseNotificationPayload(JSON.parse(dataString))?.alertId ?? null;
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
