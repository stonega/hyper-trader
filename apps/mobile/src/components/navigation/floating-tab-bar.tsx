import type { Tabs } from "expo-router";
import { useThemeColor } from "heroui-native/hooks";
import {
  type ComponentProps,
  type JSX,
  useCallback,
  useEffect,
  useRef,
} from "react";
import {
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useUniwind } from "uniwind";

import { AppText as Text } from "../app-text";
import { useReducedMotion } from "../use-reduced-motion";

export const FLOATING_TAB_BAR_HEIGHT = 58;
const FLOATING_TAB_BAR_LIFT = 14;
const FLOATING_TAB_BAR_SIDE_INSET = 12;
const FLOATING_TAB_ITEM_HORIZONTAL_PADDING = 20;
const TAB_SELECTION_DURATION_MS = 220;
const TAB_SELECTION_HORIZONTAL_INSET = 4;
const THEME_COLOR_NAMES = [
  "surface",
  "foreground",
  "muted",
  "accent",
  "separator",
] as const;

type ExpoTabsProps = ComponentProps<typeof Tabs>;
type ExpoTabBarRenderer = NonNullable<ExpoTabsProps["tabBar"]>;
type ExpoTabBarProps = Parameters<ExpoTabBarRenderer>[0];

export type FloatingTabBarProps = ExpoTabBarProps;

export function floatingTabBarInset(bottomSafeArea: number): number {
  return (
    FLOATING_TAB_BAR_HEIGHT +
    Math.max(bottomSafeArea - 16, 12) +
    FLOATING_TAB_BAR_LIFT
  );
}

function labelFor(
  options: ExpoTabBarProps["descriptors"][string]["options"],
  routeName: string,
): string {
  if (typeof options.tabBarLabel === "string") return options.tabBarLabel;
  return options.title ?? routeName;
}

export function FloatingTabBar({
  descriptors,
  insets,
  navigation,
  state,
}: FloatingTabBarProps): JSX.Element {
  const { theme } = useUniwind();
  const reducedMotion = useReducedMotion();
  const [surface, foreground, muted, accent, separator] =
    useThemeColor(THEME_COLOR_NAMES);
  const itemLayouts = useRef(new Map<string, { x: number; width: number }>());
  const selectionX = useSharedValue(0);
  const selectionWidth = useSharedValue(0);
  const selectionOpacity = useSharedValue(0);
  const selectionReady = useSharedValue(false);
  const dark = theme === "dark";
  const contentInset = floatingTabBarInset(insets.bottom);
  const edgeOffset = contentInset - FLOATING_TAB_BAR_HEIGHT;
  const focusedRouteKey = state.routes[state.index]?.key ?? null;
  const selectionStyle = useAnimatedStyle(() => ({
    opacity: selectionOpacity.value,
    transform: [{ translateX: selectionX.value }],
    width: selectionWidth.value,
  }));
  const positionSelection = useCallback(
    (routeKey: string, animate: boolean) => {
      const layout = itemLayouts.current.get(routeKey);
      if (!layout) return;
      const x = layout.x + TAB_SELECTION_HORIZONTAL_INSET;
      const width = Math.max(
        layout.width - TAB_SELECTION_HORIZONTAL_INSET * 2,
        0,
      );
      const opacity = dark ? 0.2 : 0.13;
      if (!selectionReady.value || !animate || reducedMotion) {
        selectionX.value = x;
        selectionWidth.value = width;
        selectionOpacity.value = opacity;
        selectionReady.value = true;
        return;
      }
      const timing = {
        duration: TAB_SELECTION_DURATION_MS,
        easing: Easing.out(Easing.cubic),
        reduceMotion: ReduceMotion.System,
      } as const;
      selectionX.value = withTiming(x, timing);
      selectionWidth.value = withTiming(width, timing);
      selectionOpacity.value = withTiming(opacity, timing);
    },
    [
      dark,
      reducedMotion,
      selectionOpacity,
      selectionReady,
      selectionWidth,
      selectionX,
    ],
  );

  useEffect(() => {
    if (focusedRouteKey) {
      positionSelection(focusedRouteKey, true);
    }
  }, [focusedRouteKey, positionSelection]);

  return (
    <View
      pointerEvents="box-none"
      style={[styles.root, { height: contentInset }]}
      testID="floating-tab-bar"
    >
      <View
        accessibilityRole="tablist"
        style={[
          styles.capsule,
          {
            borderColor: separator,
            bottom: edgeOffset,
            shadowOpacity: dark ? 0.32 : 0.16,
          },
        ]}
        testID="floating-tab-bar-capsule"
      >
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            styles.capsuleFill,
            { backgroundColor: surface, opacity: dark ? 0.82 : 0.88 },
          ]}
        />

        <Animated.View
          pointerEvents="none"
          style={[
            styles.selection,
            { backgroundColor: accent },
            selectionStyle,
          ]}
          testID="floating-tab-selection"
        />

        {state.routes.map((route, index) => {
          const descriptor = descriptors[route.key];
          const options = descriptor.options;
          const focused = state.index === index;
          const label = labelFor(options, route.name);
          const color = focused ? accent : muted;
          const onLayout = ({ nativeEvent }: LayoutChangeEvent) => {
            const { x, width } = nativeEvent.layout;
            itemLayouts.current.set(route.key, { x, width });
            if (focused) {
              positionSelection(route.key, false);
            }
          };

          const onPress = () => {
            const event = navigation.emit({
              canPreventDefault: true,
              target: route.key,
              type: "tabPress",
            });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };

          const onLongPress = () => {
            navigation.emit({
              target: route.key,
              type: "tabLongPress",
            });
          };

          return (
            <Pressable
              accessibilityLabel={
                options.tabBarAccessibilityLabel ?? `${label} tab`
              }
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              key={route.key}
              onLayout={onLayout}
              onLongPress={onLongPress}
              onPress={onPress}
              style={styles.item}
              testID={options.tabBarButtonTestID}
            >
              {options.tabBarIcon?.({ color, focused, size: 22 })}
              <Text
                className="text-xs font-medium"
                numberOfLines={1}
                style={{
                  color: focused ? accent : foreground,
                  opacity: focused ? 1 : 0.64,
                }}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  capsule: {
    alignSelf: "center",
    alignItems: "center",
    borderRadius: FLOATING_TAB_BAR_HEIGHT / 2,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 12,
    flexDirection: "row",
    height: FLOATING_TAB_BAR_HEIGHT,
    maxWidth: "100%",
    paddingHorizontal: 5,
    position: "absolute",
    shadowColor: "#000000",
    shadowOffset: { height: 8, width: 0 },
    shadowRadius: 18,
    width: "auto",
  },
  capsuleFill: {
    borderRadius: FLOATING_TAB_BAR_HEIGHT / 2,
  },
  item: {
    alignItems: "center",
    flexGrow: 0,
    gap: 1,
    height: FLOATING_TAB_BAR_HEIGHT,
    justifyContent: "center",
    minWidth: 48,
    paddingHorizontal: FLOATING_TAB_ITEM_HORIZONTAL_PADDING,
    position: "relative",
  },
  root: {
    alignItems: "center",
    backgroundColor: "transparent",
    bottom: 0,
    left: 0,
    overflow: "visible",
    paddingHorizontal: FLOATING_TAB_BAR_SIDE_INSET,
    position: "absolute",
    right: 0,
    zIndex: 20,
  },
  selection: {
    borderRadius: 22,
    bottom: 5,
    left: 0,
    position: "absolute",
    top: 5,
  },
});
