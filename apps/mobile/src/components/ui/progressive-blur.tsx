import MaskedView from "@react-native-masked-view/masked-view";
import {
  type BlurMethod,
  type BlurTint,
  BlurView,
  type BlurViewProps,
} from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import type { JSX } from "react";
import {
  type ColorValue,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";

type GradientColors = readonly [ColorValue, ColorValue, ColorValue];
const BLUR_LAYER_IDS = [
  "blur-layer-1",
  "blur-layer-2",
  "blur-layer-3",
  "blur-layer-4",
  "blur-layer-5",
  "blur-layer-6",
] as const;

export interface ProgressiveBlurProps {
  readonly height: number;
  readonly fadeStart?: number;
  readonly edge?: "top" | "bottom";
  readonly intensity?: number;
  readonly layers?: number;
  readonly tint?: BlurTint;
  readonly overlayColors?: GradientColors | null;
  readonly blurTarget?: BlurViewProps["blurTarget"];
  readonly blurMethod?: BlurMethod;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Public-API layered backdrop blur adapted from beautiful-expo's MIT-licensed
 * progressive-blur primitive. It must render after the content it samples.
 */
export function ProgressiveBlur({
  blurMethod,
  blurTarget,
  edge = "top",
  fadeStart,
  height,
  intensity = 70,
  layers = 6,
  overlayColors,
  style,
  testID,
  tint = "systemUltraThinMaterial",
}: ProgressiveBlurProps): JSX.Element {
  const layerCount = clamp(Math.round(layers), 1, 6);
  const layerIntensity = clamp(intensity, 1, 100) / layerCount;
  const safeHeight = Math.max(height, 1);
  const resolvedFadeStart = clamp(fadeStart ?? height - 64, 0, safeHeight);
  const fadeDistance = Math.max(safeHeight - resolvedFadeStart, 0);
  const fadeEnd = Math.max(
    resolvedFadeStart,
    safeHeight - Math.min(2, fadeDistance * 0.08),
  );
  const resolvedBlurMethod =
    blurMethod ?? (blurTarget ? "dimezisBlurViewSdk31Plus" : undefined);
  const overlayStart = resolvedFadeStart / safeHeight;
  const overlayLocations =
    edge === "top"
      ? ([0, overlayStart, 1] as const)
      : ([0, 1 - overlayStart, 1] as const);
  const overlayGradient =
    edge === "top"
      ? overlayColors
      : overlayColors
        ? ([overlayColors[2], overlayColors[1], overlayColors[0]] as const)
        : null;

  return (
    <View
      pointerEvents="none"
      style={[styles.progressiveBlur, { height }, style]}
      testID={testID}
    >
      {fadeDistance === 0 ? (
        <BlurView
          blurMethod={resolvedBlurMethod}
          blurTarget={blurTarget}
          intensity={clamp(intensity, 1, 100)}
          style={StyleSheet.absoluteFill}
          tint={tint}
        />
      ) : (
        BLUR_LAYER_IDS.slice(0, layerCount).map((layerId, index) => {
          const bandStart =
            resolvedFadeStart +
            (fadeEnd - resolvedFadeStart) * (index / layerCount) * 0.55;
          const softEnd = bandStart + (fadeEnd - bandStart) * 0.72;
          const maskLocations =
            edge === "top"
              ? ([
                  0,
                  bandStart / safeHeight,
                  softEnd / safeHeight,
                  fadeEnd / safeHeight,
                  1,
                ] as const)
              : ([
                  0,
                  1 - fadeEnd / safeHeight,
                  1 - softEnd / safeHeight,
                  1 - bandStart / safeHeight,
                  1,
                ] as const);
          const maskColors =
            edge === "top"
              ? ([
                  "#000000",
                  "#000000",
                  "rgba(0, 0, 0, 0.18)",
                  "transparent",
                  "transparent",
                ] as const)
              : ([
                  "transparent",
                  "transparent",
                  "rgba(0, 0, 0, 0.18)",
                  "#000000",
                  "#000000",
                ] as const);

          return (
            <MaskedView
              key={layerId}
              maskElement={
                <LinearGradient
                  colors={maskColors}
                  locations={maskLocations}
                  style={StyleSheet.absoluteFill}
                />
              }
              pointerEvents="none"
              style={StyleSheet.absoluteFill}
            >
              <BlurView
                blurMethod={resolvedBlurMethod}
                blurTarget={blurTarget}
                intensity={layerIntensity}
                style={StyleSheet.absoluteFill}
                tint={tint}
              />
            </MaskedView>
          );
        })
      )}
      {overlayGradient ? (
        <LinearGradient
          colors={overlayGradient}
          locations={overlayLocations}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  progressiveBlur: {
    left: 0,
    position: "absolute",
    right: 0,
  },
});
