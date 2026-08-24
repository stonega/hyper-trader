import type { JSX, ReactNode } from "react";
import { View } from "react-native";

import { AppText as Text } from "../app-text";

const TONE_CLASSES = {
  danger: {
    dot: "bg-danger",
    title: "text-danger",
  },
  success: {
    dot: "bg-success",
    title: "text-success",
  },
  warning: {
    dot: "bg-warning",
    title: "text-warning",
  },
} as const;

export function CompactUpdateStatus({
  accessibilityRole = "text",
  description,
  testID,
  title,
  tone,
  trailing,
}: {
  readonly accessibilityRole?: "alert" | "text";
  readonly description: string;
  readonly testID?: string;
  readonly title: string;
  readonly tone: keyof typeof TONE_CLASSES;
  readonly trailing?: ReactNode;
}): JSX.Element {
  const classes = TONE_CLASSES[tone];

  return (
    <View className="shrink flex-row items-center gap-1.5" testID={testID}>
      <View className={`size-2 shrink-0 rounded-full ${classes.dot}`} />
      <Text
        accessibilityLabel={`${title}. ${description}`}
        accessibilityLiveRegion="polite"
        accessibilityRole={accessibilityRole}
        className={`min-w-0 shrink text-xs font-semibold ${classes.title}`}
        numberOfLines={1}
      >
        {title}
      </Text>
      {trailing}
    </View>
  );
}
