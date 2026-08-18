import { type ExpoWebGLRenderingContext, GLView } from "expo-gl";
import { useThemeColor } from "heroui-native/hooks";
import type { JSX } from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { processColor, StyleSheet, View } from "react-native";
import { useUniwind } from "uniwind";

import {
  type RgbColor,
  type RibbonShaderPalette,
  startIridescentRibbonShader,
} from "./iridescent-ribbon-shader";

const THEME_COLOR_NAMES = ["surface", "accent", "foreground"] as const;
const ONBOARDING_BACKGROUND_COLOR = "#153026";
const ONBOARDING_BACKGROUND_RGB = [
  21 / 255,
  48 / 255,
  38 / 255,
] as const satisfies RgbColor;

const LIGHT_FALLBACK = {
  surface: [1, 1, 1],
  accent: [0, 0.62, 0.54],
  foreground: [0.2, 0.2, 0.22],
} as const satisfies Record<string, RgbColor>;

const DARK_FALLBACK = {
  surface: [0.19, 0.19, 0.21],
  accent: [0.19, 0.84, 0.72],
  foreground: [0.97, 0.97, 0.98],
} as const satisfies Record<string, RgbColor>;

function resolveRgb(color: string, fallback: RgbColor): RgbColor {
  const processed = processColor(color);
  if (typeof processed !== "number") return fallback;
  const argb = processed >>> 0;
  return [
    ((argb >>> 16) & 255) / 255,
    ((argb >>> 8) & 255) / 255,
    (argb & 255) / 255,
  ];
}

function RibbonGlSurface({
  backgroundColor,
  palette,
  reducedMotion,
}: {
  readonly backgroundColor: string;
  readonly palette: RibbonShaderPalette;
  readonly reducedMotion: boolean;
}): JSX.Element {
  const stopShader = useRef<() => void>(() => undefined);

  useEffect(
    () => () => {
      stopShader.current();
    },
    [],
  );

  const handleContextCreate = useCallback(
    (gl: ExpoWebGLRenderingContext): void => {
      stopShader.current();
      stopShader.current = startIridescentRibbonShader(
        gl,
        palette,
        reducedMotion,
      );
    },
    [palette, reducedMotion],
  );

  return (
    <GLView
      msaaSamples={0}
      onContextCreate={handleContextCreate}
      style={[StyleSheet.absoluteFill, { backgroundColor }]}
    />
  );
}

export function IridescentRibbonBackground({
  reducedMotion,
}: {
  readonly reducedMotion: boolean;
}): JSX.Element {
  const { theme } = useUniwind();
  const [surface, accent, foreground] = useThemeColor(THEME_COLOR_NAMES);
  const fallback = theme === "dark" ? DARK_FALLBACK : LIGHT_FALLBACK;
  const palette = useMemo<RibbonShaderPalette>(
    () => ({
      background: ONBOARDING_BACKGROUND_RGB,
      surface: resolveRgb(surface, fallback.surface),
      accent: resolveRgb(accent, fallback.accent),
      foreground: resolveRgb(foreground, fallback.foreground),
      dark: theme === "dark",
    }),
    [accent, fallback, foreground, surface, theme],
  );

  return (
    <View
      accessibilityElementsHidden
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: ONBOARDING_BACKGROUND_COLOR },
      ]}
      testID="welcome-ribbon-background"
    >
      <RibbonGlSurface
        backgroundColor={ONBOARDING_BACKGROUND_COLOR}
        key={`${theme}:${surface}:${accent}:${foreground}:${reducedMotion}`}
        palette={palette}
        reducedMotion={reducedMotion}
      />
    </View>
  );
}
