import type { PropsWithChildren, ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

type CommonProps = PropsWithChildren<{
  readonly accessibilityHint?: string;
  readonly accessibilityLabel?: string;
  readonly accessibilityRole?: "alert" | "button" | "header" | "text";
  readonly isDisabled?: boolean;
  readonly onPress?: () => void;
}>;

function Container({ children }: PropsWithChildren): ReactNode {
  return <View>{children}</View>;
}

function Copy({
  accessibilityHint,
  accessibilityLabel,
  accessibilityRole,
  children,
}: CommonProps): ReactNode {
  return (
    <Text
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
    >
      {children}
    </Text>
  );
}

export function Button({
  children,
  isDisabled,
  onPress,
  ...props
}: CommonProps): ReactNode {
  return (
    <Pressable
      {...props}
      accessibilityRole="button"
      disabled={isDisabled}
      onPress={onPress}
    >
      <Text>{children}</Text>
    </Pressable>
  );
}

export function Chip({ children, ...props }: CommonProps): ReactNode {
  return <Text {...props}>{children}</Text>;
}

export const Card = Object.assign(Container, {
  Header: Container,
  Body: Container,
  Footer: Container,
  Title: Copy,
  Description: Copy,
});

export function Skeleton({ accessibilityLabel }: CommonProps): ReactNode {
  return <View accessibilityLabel={accessibilityLabel} />;
}

const THEME_COLORS: Record<string, string> = {
  accent: "#009b86",
  background: "#f7f7f7",
  foreground: "#29292d",
  surface: "#ffffff",
};

export function useThemeColor(
  color: string | readonly string[],
): string | string[] {
  if (Array.isArray(color)) {
    return color.map((name) => THEME_COLORS[name] ?? "#000000");
  }
  return THEME_COLORS[color as string] ?? "#000000";
}
