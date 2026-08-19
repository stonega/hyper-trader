import { Tabs } from "heroui-native/tabs";
import type { JSX } from "react";

import { useReducedMotion } from "../use-reduced-motion";
import { COMPACT_SEGMENT_HIT_SLOP } from "./control-metrics";

interface UnderlineTabOption<Value extends string> {
  readonly label: string;
  readonly value: Value;
}

export function UnderlineTabs<Value extends string>({
  accessibilityLabel,
  compact = false,
  onValueChange,
  options,
  value,
}: {
  readonly accessibilityLabel: string;
  readonly compact?: boolean;
  readonly onValueChange: (value: Value) => void;
  readonly options: readonly UnderlineTabOption<Value>[];
  readonly value: Value;
}): JSX.Element {
  const reducedMotion = useReducedMotion();

  return (
    <Tabs
      animation={reducedMotion ? "disable-all" : undefined}
      className="w-full gap-0"
      onValueChange={(nextValue) => {
        const nextOption = options.find((option) => option.value === nextValue);
        if (nextOption) onValueChange(nextOption.value);
      }}
      value={value}
      variant="secondary"
    >
      <Tabs.List
        accessibilityLabel={accessibilityLabel}
        className="w-full self-stretch gap-0"
      >
        <Tabs.Indicator />
        {options.map((option) => (
          <Tabs.Trigger
            className={
              compact
                ? "h-10 min-h-10 min-w-0 flex-1 px-2 py-0"
                : "min-h-12 min-w-0 flex-1 px-3 py-0"
            }
            hitSlop={compact ? COMPACT_SEGMENT_HIT_SLOP : undefined}
            key={option.value}
            value={option.value}
          >
            {({ isSelected }) => (
              <Tabs.Label
                className={
                  isSelected
                    ? "text-sm font-semibold text-foreground"
                    : "text-sm font-medium text-muted"
                }
              >
                {option.label}
              </Tabs.Label>
            )}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
    </Tabs>
  );
}
