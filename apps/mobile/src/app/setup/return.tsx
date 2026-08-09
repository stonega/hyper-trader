import { useLocalSearchParams, useRouter } from "expo-router";
import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import type { JSX } from "react";
import { ScrollView, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useReducedMotion } from "../../components/use-reduced-motion";

export default function WalletReturnScreen(): JSX.Element {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const parameters = useLocalSearchParams<{
    attemptId?: string;
    connectorSessionId?: string;
    invalid?: string;
  }>();
  const parsed =
    parameters.invalid !== "1" &&
    typeof parameters.attemptId === "string" &&
    typeof parameters.connectorSessionId === "string";

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="justify-center gap-5 px-5"
      contentContainerStyle={{
        flexGrow: 1,
        paddingTop: Math.max(insets.top, 24),
        paddingBottom: Math.max(insets.bottom, 24),
      }}
    >
      <Text
        accessibilityRole="header"
        className="text-4xl font-semibold tracking-tight text-foreground"
      >
        Wallet return received
      </Text>
      <Card variant="default" className="gap-4">
        <Card.Body className="gap-3">
          <Card.Title>
            {parsed ? "Return is untrusted" : "Return could not be parsed"}
          </Card.Title>
          <Card.Description>
            A link cannot activate trading. This build keeps the return inert; a
            reviewed build must match one live ten-minute attempt and then
            verify the exact registration from Hyperliquid.
          </Card.Description>
        </Card.Body>
        <Card.Footer className="flex-col gap-3">
          <Button
            animation={reducedMotion ? "disable-all" : undefined}
            className="min-h-12 w-full"
            onPress={() => router.replace("/setup")}
            variant="secondary"
          >
            Return to setup
          </Button>
          <Button
            animation={reducedMotion ? "disable-all" : undefined}
            className="min-h-12 w-full"
            onPress={() => router.replace("/(tabs)/trade")}
            variant="tertiary"
          >
            Continue read-only
          </Button>
        </Card.Footer>
      </Card>
    </ScrollView>
  );
}
