export type NotificationSettingsPhase =
  | "overview"
  | "editing"
  | "requesting_permission"
  | "registering_token"
  | "proving_account"
  | "syncing_rule"
  | "revoking"
  | "failure";

export function notificationSettingsConsumesBack(
  phase: NotificationSettingsPhase,
): boolean {
  return (
    phase === "requesting_permission" ||
    phase === "registering_token" ||
    phase === "proving_account" ||
    phase === "syncing_rule" ||
    phase === "revoking"
  );
}
