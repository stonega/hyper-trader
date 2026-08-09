import type { HyperliquidNetwork } from "@hyper-trader/hyperliquid/public";
import { Chip } from "heroui-native/chip";
import type { JSX } from "react";
import { Text, View } from "react-native";

export function ScreenHeading({
  title,
  description,
  network,
}: {
  readonly title: string;
  readonly description: string;
  readonly network: HyperliquidNetwork;
}): JSX.Element {
  return (
    <View className="gap-3">
      <View className="flex-row items-start justify-between gap-4">
        <Text
          accessibilityRole="header"
          className="flex-1 text-4xl font-semibold tracking-tight text-foreground"
        >
          {title}
        </Text>
        <Chip
          accessibilityLabel={`${network} network, no account, read only`}
          size="sm"
          variant="soft"
          color="default"
        >
          {network} · no account
        </Chip>
      </View>
      <Text className="text-base leading-6 text-muted">{description}</Text>
    </View>
  );
}
