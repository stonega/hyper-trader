import type { HyperliquidNetwork } from "@hyper-trader/hyperliquid/public";
import { useRouter } from "expo-router";
import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import type { JSX } from "react";

import { SETUP_ROUTE } from "../navigation/routes";
import { useReducedMotion } from "./use-reduced-motion";

export function SetupResumeCard({
  network,
}: {
  readonly network: HyperliquidNetwork;
}): JSX.Element {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const networkLabel = network === "mainnet" ? "Mainnet" : "Testnet";

  return (
    <Card variant="tertiary" className="gap-4">
      <Card.Body className="gap-2">
        <Card.Title>Set up trading</Card.Title>
        <Card.Description>
          Add a {networkLabel} API wallet when you’re ready to place orders.
        </Card.Description>
      </Card.Body>
      <Card.Footer>
        <Button
          accessibilityHint={`Opens ${networkLabel} account setup.`}
          animation={reducedMotion ? "disable-all" : undefined}
          className="min-h-11 w-full"
          onPress={() => router.push(SETUP_ROUTE)}
          variant="secondary"
        >
          Set up trading
        </Button>
      </Card.Footer>
    </Card>
  );
}
