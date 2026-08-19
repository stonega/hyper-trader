import type { HyperliquidNetwork } from "@hyper-trader/hyperliquid/public";
import { Chip } from "heroui-native/chip";
import type { JSX, ReactNode } from "react";
import { View } from "react-native";

import { AppText as Text } from "./app-text";

export function ScreenHeading({
  title,
  description,
  network,
  accountLabel = "no account · read only",
  titleAccessory,
  rightAccessory,
  showContext = true,
}: {
  readonly title: string;
  readonly description?: string;
  readonly network: HyperliquidNetwork;
  readonly accountLabel?: string;
  readonly titleAccessory?: ReactNode;
  readonly rightAccessory?: ReactNode;
  readonly showContext?: boolean;
}): JSX.Element {
  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-between gap-1">
        <View className="min-w-0 flex-1 flex-row items-center gap-2">
          <Text
            accessibilityRole="header"
            className="text-4xl font-semibold tracking-tight text-foreground"
            numberOfLines={1}
          >
            {title}
          </Text>
          {titleAccessory}
        </View>
        {rightAccessory ??
          (showContext ? (
            <Chip
              accessibilityLabel={`${network} network, ${accountLabel}`}
              size="sm"
              variant="soft"
              color="default"
            >
              {network} · {accountLabel}
            </Chip>
          ) : null)}
      </View>
      {description ? (
        <Text className="text-base leading-6 text-muted">{description}</Text>
      ) : null}
    </View>
  );
}
