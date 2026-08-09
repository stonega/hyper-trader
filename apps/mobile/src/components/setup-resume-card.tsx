import { useRouter } from "expo-router";
import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import type { JSX } from "react";
import { useEffect, useRef } from "react";

import { useOnboardingPreference } from "../features/onboarding/provider";
import { SETUP_ROUTE } from "../features/onboarding/routes";
import { useReducedMotion } from "./use-reduced-motion";

export function SetupResumeCard(): JSX.Element {
  const onboarding = useOnboardingPreference();
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const resume = onboarding.hasSetupIntent;
  const requesting = useRef(false);
  const operation = useRef(0);

  useEffect(
    () => () => {
      operation.current += 1;
    },
    [],
  );

  const requestSetup = async () => {
    if (requesting.current) {
      return;
    }
    requesting.current = true;
    const currentOperation = ++operation.current;
    try {
      const saved = await onboarding.requestSetup();
      if (currentOperation !== operation.current) return;
      if (saved) router.push(SETUP_ROUTE);
    } finally {
      if (currentOperation === operation.current) requesting.current = false;
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
          Continue the dedicated testnet flow to review exact account binding,
          external approval, device protection, and the temporary session.
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
          accessibilityHint="Saves a resumable setup intent and opens the dedicated testnet setup flow."
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
