import type { Tabs } from "expo-router";
import { useThemeColor } from "heroui-native/hooks";
import type { ComponentProps, JSX } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useUniwind } from "uniwind";

import { AppText as Text } from "../app-text";
import { ProgressiveBlur } from "../ui/progressive-blur";

export const FLOATING_TAB_BAR_HEIGHT = 58;
const FLOATING_TAB_BAR_SPILL = 16;
const FLOATING_TAB_BAR_SIDE_INSET = 12;
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
  return FLOATING_TAB_BAR_HEIGHT + Math.max(bottomSafeArea - 16, 12);
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
  const [surface, foreground, muted, accent, separator] =
    useThemeColor(THEME_COLOR_NAMES);
  const dark = theme === "dark";
  const edgeOffset = Math.max(insets.bottom - 16, 12);
  const contentInset = floatingTabBarInset(insets.bottom);
  const backdropHeight = contentInset + FLOATING_TAB_BAR_SPILL;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.root, { height: contentInset }]}
      testID="floating-tab-bar"
    >
      <ProgressiveBlur
        edge="bottom"
        height={backdropHeight}
        intensity={70}
        layers={6}
        overlayColors={[surface, surface, "transparent"]}
        style={styles.backdrop}
        testID="floating-tab-bar-blur"
        tint={
          dark ? "systemUltraThinMaterialDark" : "systemUltraThinMaterialLight"
        }
      />

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
      >
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            styles.capsuleFill,
            { backgroundColor: surface, opacity: dark ? 0.82 : 0.88 },
          ]}
        />

        {state.routes.map((route, index) => {
          const descriptor = descriptors[route.key];
          const options = descriptor.options;
          const focused = state.index === index;
          const label = labelFor(options, route.name);
          const color = focused ? accent : muted;

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
              onLongPress={onLongPress}
              onPress={onPress}
              style={styles.item}
              testID={options.tabBarButtonTestID}
            >
              {focused ? (
                <View
                  pointerEvents="none"
                  style={[
                    styles.selection,
                    {
                      backgroundColor: accent,
                      opacity: dark ? 0.2 : 0.13,
                    },
                  ]}
                />
              ) : null}
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
  backdrop: {
    bottom: 0,
  },
  capsule: {
    alignItems: "center",
    borderRadius: FLOATING_TAB_BAR_HEIGHT / 2,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 12,
    flexDirection: "row",
    height: FLOATING_TAB_BAR_HEIGHT,
    left: FLOATING_TAB_BAR_SIDE_INSET,
    paddingHorizontal: 5,
    position: "absolute",
    right: FLOATING_TAB_BAR_SIDE_INSET,
    shadowColor: "#000000",
    shadowOffset: { height: 8, width: 0 },
    shadowRadius: 18,
  },
  capsuleFill: {
    borderRadius: FLOATING_TAB_BAR_HEIGHT / 2,
  },
  item: {
    alignItems: "center",
    flex: 1,
    gap: 1,
    height: FLOATING_TAB_BAR_HEIGHT,
    justifyContent: "center",
    minWidth: 48,
    position: "relative",
  },
  root: {
    backgroundColor: "transparent",
    overflow: "visible",
    zIndex: 20,
  },
  selection: {
    borderRadius: 22,
    bottom: 5,
    left: 4,
    position: "absolute",
    right: 4,
    top: 5,
  },
});
