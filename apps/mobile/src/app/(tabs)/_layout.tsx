import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router";
import type { ComponentProps, JSX } from "react";
import type { ColorValue } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  FloatingTabBar,
  floatingTabBarInset,
} from "../../components/navigation/floating-tab-bar";
import { MarketPreferencesProvider } from "../../features/markets/preferences-provider";
import { OnboardingPreferenceProvider } from "../../features/onboarding/provider";
import { INITIAL_TAB_ROUTE } from "../../features/onboarding/routes";

type IoniconName = ComponentProps<typeof Ionicons>["name"];

function TabIcon({
  color,
  focused,
  focusedName,
  name,
  size,
}: {
  readonly color: ColorValue;
  readonly focused: boolean;
  readonly focusedName: IoniconName;
  readonly name: IoniconName;
  readonly size: number;
}): JSX.Element {
  return (
    <Ionicons
      accessibilityElementsHidden
      color={color}
      importantForAccessibility="no-hide-descendants"
      name={focused ? focusedName : name}
      size={size}
    />
  );
}

export default function TabLayout(): JSX.Element {
  const insets = useSafeAreaInsets();
  const tabBarHeight = floatingTabBarInset(insets.bottom);

  return (
    <OnboardingPreferenceProvider>
      <MarketPreferencesProvider>
        <Tabs
          initialRouteName={INITIAL_TAB_ROUTE}
          screenOptions={{
            headerShown: false,
            tabBarHideOnKeyboard: true,
            tabBarShowLabel: true,
            tabBarStyle: {
              backgroundColor: "transparent",
              borderTopWidth: 0,
              elevation: 0,
              height: tabBarHeight,
            },
          }}
          tabBar={(props) => <FloatingTabBar {...props} />}
        >
          <Tabs.Screen
            name="markets"
            options={{
              title: "Markets",
              tabBarAccessibilityLabel: "Markets tab",
              tabBarButtonTestID: "tab-markets",
              tabBarIcon: ({ color, focused, size }) => (
                <TabIcon
                  color={color}
                  focused={focused}
                  focusedName="search"
                  name="search-outline"
                  size={size}
                />
              ),
            }}
          />
          <Tabs.Screen
            name="trade"
            options={{
              title: "Trade",
              tabBarAccessibilityLabel: "Trade tab, default",
              tabBarButtonTestID: "tab-trade",
              tabBarIcon: ({ color, focused, size }) => (
                <TabIcon
                  color={color}
                  focused={focused}
                  focusedName="home"
                  name="home-outline"
                  size={size}
                />
              ),
            }}
          />
          <Tabs.Screen
            name="portfolio"
            options={{
              title: "Portfolio",
              tabBarAccessibilityLabel: "Portfolio tab",
              tabBarButtonTestID: "tab-portfolio",
              tabBarIcon: ({ color, focused, size }) => (
                <TabIcon
                  color={color}
                  focused={focused}
                  focusedName="wallet"
                  name="wallet-outline"
                  size={size}
                />
              ),
            }}
          />
          <Tabs.Screen
            name="settings"
            options={{
              title: "Settings",
              tabBarAccessibilityLabel: "Settings tab",
              tabBarButtonTestID: "tab-settings",
              tabBarIcon: ({ color, focused, size }) => (
                <TabIcon
                  color={color}
                  focused={focused}
                  focusedName="settings"
                  name="settings-outline"
                  size={size}
                />
              ),
            }}
          />
        </Tabs>
      </MarketPreferencesProvider>
    </OnboardingPreferenceProvider>
  );
}
