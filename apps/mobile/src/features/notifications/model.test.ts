import { describe, expect, test } from "bun:test";

import {
  type NotificationSettingsPhase,
  notificationSettingsConsumesBack,
} from "./model";

describe("mobile notification model", () => {
  test("consumes Back only across native or server commits", () => {
    const blocked: readonly NotificationSettingsPhase[] = [
      "requesting_permission",
      "registering_token",
      "proving_account",
      "syncing_rule",
      "revoking",
    ];
    const navigable: readonly NotificationSettingsPhase[] = [
      "overview",
      "editing",
      "failure",
    ];
    for (const phase of blocked) {
      expect(notificationSettingsConsumesBack(phase)).toBe(true);
    }
    for (const phase of navigable) {
      expect(notificationSettingsConsumesBack(phase)).toBe(false);
    }
  });
});
