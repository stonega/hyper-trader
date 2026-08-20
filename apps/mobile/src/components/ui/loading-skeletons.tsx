import { Skeleton } from "heroui-native/skeleton";
import type { JSX } from "react";
import { View } from "react-native";

import { useReducedMotion } from "../use-reduced-motion";

export function LoadingSkeletons({
  accessibilityLabel,
  className = "gap-3",
  items,
}: {
  readonly accessibilityLabel: string;
  readonly className?: string;
  readonly items: readonly string[];
}): JSX.Element {
  const reducedMotion = useReducedMotion();

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      className={className}
      pointerEvents="none"
    >
      {items.map((key) => (
        <Skeleton
          animation={reducedMotion ? "disable-all" : undefined}
          className="h-40 w-full rounded-2xl"
          key={key}
          variant={reducedMotion ? "none" : "shimmer"}
        />
      ))}
    </View>
  );
}
