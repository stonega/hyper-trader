import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import type { JSX } from "react";
import { useRef } from "react";
import { Alert } from "react-native";

import { useOnboardingPreference } from "../features/onboarding/provider";
import { useReducedMotion } from "./use-reduced-motion";

export function SetupResumeCard(): JSX.Element {
  const onboarding = useOnboardingPreference();
  const reducedMotion = useReducedMotion();
  const resume = onboarding.hasSetupIntent;
  const requesting = useRef(false);

  const requestSetup = async () => {
    if (requesting.current) {
      return;
    }
    requesting.current = true;
    try {
      const saved = await onboarding.requestSetup();
      Alert.alert(
        saved ? "Trading setup saved" : "Could not save setup intent",
        saved
          ? "No wallet authority or key was created. The dedicated API-wallet approval flow will continue here when its reviewed security implementation is available."
          : "Read-only browsing is still available. Try saving the setup intent again.",
      );
    } finally {
      requesting.current = false;
    }
  };

  return (
    <Card variant="tertiary" className="gap-4">
      <Card.Body className="gap-2">
        <Card.Title>
          {resume ? "Continue trading setup" : "Trading is locked"}
        </Card.Title>
        <Card.Description>
          Hyper Trader never handles your master seed or master private key.
          After external approval, a dedicated API-wallet key will be protected
          on this device.
        </Card.Description>
        {onboarding.status === "error" ? (
          <Card.Description accessibilityRole="alert">
            Setup preference storage is unavailable. No authority was changed.
          </Card.Description>
        ) : null}
      </Card.Body>
      <Card.Footer>
        <Button
          accessibilityLabel={
            resume ? "Continue trading setup" : "Set up trading"
          }
          accessibilityHint="Saves an untrusted setup intent only; it does not connect or approve a wallet."
          animation={reducedMotion ? "disable-all" : undefined}
          className="min-h-11 w-full"
          isDisabled={onboarding.status === "loading"}
          onPress={() => void requestSetup()}
          variant="secondary"
        >
          {onboarding.status === "loading"
            ? "Saving setup…"
            : resume
              ? "Continue setup"
              : "Set up trading"}
        </Button>
      </Card.Footer>
    </Card>
  );
}
