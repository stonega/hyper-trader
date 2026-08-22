import Ionicons from "@expo/vector-icons/Ionicons";
import { Button } from "heroui-native/button";
import { useThemeColor } from "heroui-native/hooks";
import type { JSX } from "react";

import { COMPACT_SEGMENT_HIT_SLOP } from "../../components/ui/control-metrics";
import { useReducedMotion } from "../../components/use-reduced-motion";

export type MarketCatalogMode = "strict" | "all";

function modeLabel(mode: MarketCatalogMode): "Strict" | "All" {
  return mode === "strict" ? "Strict" : "All";
}

export function MarketCatalogModeToggle({
  mode,
  onChange,
}: {
  readonly mode: MarketCatalogMode;
  readonly onChange: (mode: MarketCatalogMode) => void;
}): JSX.Element {
  const reducedMotion = useReducedMotion();
  const accent = useThemeColor("accent");
  const nextMode = mode === "strict" ? "all" : "strict";

  return (
    <Button
      accessibilityHint={`Switches to ${modeLabel(nextMode)} market mode.`}
      accessibilityLabel={`${modeLabel(mode)} market mode`}
      animation={reducedMotion ? "disable-all" : undefined}
      className="h-10 min-h-10 min-w-0 max-w-40 gap-1 px-3"
      hitSlop={COMPACT_SEGMENT_HIT_SLOP}
      onPress={() => onChange(nextMode)}
      size="sm"
      testID="market-catalog-mode-toggle"
      variant="secondary"
    >
      <Button.Label>{modeLabel(mode)}</Button.Label>
      <Ionicons
        accessibilityElementsHidden
        color={accent}
        importantForAccessibility="no-hide-descendants"
        name="swap-horizontal"
        size={16}
      />
    </Button>
  );
}
