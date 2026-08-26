import { Button } from "heroui-native/button";
import { InputGroup } from "heroui-native/input-group";
import type { JSX } from "react";
import type { TextInputProps } from "react-native";

import { useReducedMotion } from "./use-reduced-motion";

export function PriceInputWithMid({
  accessibilityHint,
  accessibilityLabel,
  isDisabled = false,
  midButtonAccessibilityLabel,
  midPrice,
  onChangeText,
  returnKeyType,
  value,
}: {
  readonly accessibilityHint: string;
  readonly accessibilityLabel?: string;
  readonly isDisabled?: boolean;
  readonly midButtonAccessibilityLabel: string;
  readonly midPrice: string | null;
  readonly onChangeText: (value: string) => void;
  readonly returnKeyType?: TextInputProps["returnKeyType"];
  readonly value: string;
}): JSX.Element {
  const reducedMotion = useReducedMotion();
  return (
    <InputGroup
      animation={reducedMotion ? "disable-all" : undefined}
      isDisabled={isDisabled}
    >
      <InputGroup.Input
        accessibilityHint={accessibilityHint}
        accessibilityLabel={accessibilityLabel}
        className="font-mono"
        keyboardType="decimal-pad"
        onChangeText={onChangeText}
        placeholder="0"
        returnKeyType={returnKeyType}
        value={value}
      />
      <InputGroup.Suffix className="px-1">
        <Button
          accessibilityHint="Fills the price with the current market midpoint."
          accessibilityLabel={midButtonAccessibilityLabel}
          animation={reducedMotion ? "disable-all" : undefined}
          className="h-10 min-h-10 min-w-0 px-3"
          hitSlop={4}
          isDisabled={isDisabled || midPrice === null}
          onPress={() => {
            if (midPrice !== null) onChangeText(midPrice);
          }}
          size="sm"
          variant="ghost"
        >
          <Button.Label>Mid</Button.Label>
        </Button>
      </InputGroup.Suffix>
    </InputGroup>
  );
}
