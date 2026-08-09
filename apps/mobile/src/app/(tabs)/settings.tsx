import { Card } from "heroui-native/card";
import type { JSX } from "react";
import { ScrollView, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ScreenHeading } from "../../components/screen-heading";
import { SetupResumeCard } from "../../components/setup-resume-card";
import { useTradingContext } from "../../core/context/provider";

export default function SettingsScreen(): JSX.Element {
  const insets = useSafeAreaInsets();
  const { current } = useTradingContext();
  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-6 px-5 pb-10"
      contentContainerStyle={{ paddingTop: Math.max(insets.top, 20) }}
    >
      <ScreenHeading
        title="Settings"
        description="Account, security, network, notification, and appearance controls will remain explicit and independently scoped."
        network={current.network}
      />
      <SetupResumeCard />
      <Card variant="secondary">
        <Card.Body className="gap-2">
          <Card.Title>Credential boundary</Card.Title>
          <Card.Description>
            Hyper Trader never handles a master seed or master private key.
          </Card.Description>
          <Text className="text-sm leading-5 text-muted">
            A later dedicated API-wallet key will be protected on device,
            separately bound to its approved account and network.
          </Text>
        </Card.Body>
      </Card>
    </ScrollView>
  );
}
