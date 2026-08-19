import { LinearGradient } from "expo-linear-gradient";
import type { JSX } from "react";
import { StyleSheet, View } from "react-native";

const WALLET_GRADIENTS = [
  ["#0EA5A8", "#3B82F6"],
  ["#246BFD", "#8B5CF6"],
  ["#6C5CE7", "#EC6FA9"],
  ["#D95D83", "#7A6FF0"],
  ["#F9735B", "#F4C95D"],
  ["#E67E22", "#E84393"],
  ["#16A085", "#5B8DEF"],
  ["#00A8A8", "#8AC926"],
] as const;

const GRADIENT_DIRECTIONS = [
  { end: { x: 1, y: 1 }, start: { x: 0, y: 0 } },
  { end: { x: 0, y: 1 }, start: { x: 1, y: 0 } },
  { end: { x: 1, y: 0.35 }, start: { x: 0, y: 0.65 } },
  { end: { x: 0.35, y: 1 }, start: { x: 0.65, y: 0 } },
] as const;

export function shortenWalletAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export const shortenApiWalletAddress = shortenWalletAddress;

function hashWalletAddress(address: string): number {
  let hash = 2_166_136_261;
  for (const character of address.toLowerCase()) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export function walletGradientForAddress(address: string): {
  readonly colors: (typeof WALLET_GRADIENTS)[number];
  readonly end: (typeof GRADIENT_DIRECTIONS)[number]["end"];
  readonly start: (typeof GRADIENT_DIRECTIONS)[number]["start"];
} {
  const hash = hashWalletAddress(address);
  const colors = WALLET_GRADIENTS[hash % WALLET_GRADIENTS.length];
  const direction =
    GRADIENT_DIRECTIONS[(hash >>> 8) % GRADIENT_DIRECTIONS.length];
  return { colors, end: direction.end, start: direction.start };
}

export function ApiWalletAvatar({
  address,
}: {
  readonly address: string | null;
}): JSX.Element {
  if (address === null) {
    return (
      <View
        accessibilityElementsHidden
        className="h-12 w-12 overflow-hidden rounded-2xl bg-surface-secondary"
        importantForAccessibility="no-hide-descendants"
        testID="api-wallet-avatar-placeholder"
      >
        <View className="absolute -right-2 -top-2 h-8 w-8 rounded-full bg-accent/15" />
        <View className="absolute -bottom-3 -left-2 h-8 w-8 rounded-full bg-foreground/5" />
      </View>
    );
  }

  const gradient = walletGradientForAddress(address);
  return (
    <View
      accessibilityElementsHidden
      className="h-12 w-12 overflow-hidden rounded-2xl"
      importantForAccessibility="no-hide-descendants"
      testID="api-wallet-avatar"
    >
      <LinearGradient
        colors={gradient.colors}
        end={gradient.end}
        start={gradient.start}
        style={StyleSheet.absoluteFill}
        testID="api-wallet-avatar-gradient"
      />
      <View className="absolute -right-2 -top-2 h-8 w-8 rounded-full bg-white/20" />
      <View className="absolute -bottom-3 -left-2 h-8 w-8 rounded-full bg-black/10" />
    </View>
  );
}
