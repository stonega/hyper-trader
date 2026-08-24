import type { JSX } from "react";
import { type StyleProp, View, type ViewStyle } from "react-native";

import { LoadingSkeletons } from "./loading-skeletons";

const CARD_LOADING_ITEM = ["card"] as const;

export function CardLoadingSkeleton({
  accessibilityLabel,
  style,
}: {
  readonly accessibilityLabel: string;
  readonly style?: StyleProp<ViewStyle>;
}): JSX.Element {
  return (
    <View className="min-w-0" style={style}>
      <LoadingSkeletons
        accessibilityLabel={accessibilityLabel}
        className=""
        items={CARD_LOADING_ITEM}
      />
    </View>
  );
}
