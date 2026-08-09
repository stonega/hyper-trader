import { Tabs } from "expo-router";
import type { JSX } from "react";

import { MarketPreferencesProvider } from "../../features/markets/preferences-provider";
import { OnboardingPreferenceProvider } from "../../features/onboarding/provider";
import { INITIAL_TAB_ROUTE } from "../../features/onboarding/routes";

export default function TabLayout(): JSX.Element {
  return (
    <OnboardingPreferenceProvider>
      <MarketPreferencesProvider>
        <Tabs
          initialRouteName={INITIAL_TAB_ROUTE}
          screenOptions={{
            headerShown: false,
            tabBarHideOnKeyboard: true,
            tabBarShowLabel: true,
            tabBarStyle: { minHeight: 64, paddingTop: 8 },
          }}
        >
          <Tabs.Screen
            name="markets"
            options={{
              title: "Markets",
              tabBarAccessibilityLabel: "Markets tab",
              tabBarButtonTestID: "tab-markets",
            }}
          />
          <Tabs.Screen
            name="trade"
            options={{
              title: "Trade",
              tabBarAccessibilityLabel: "Trade tab, default",
              tabBarButtonTestID: "tab-trade",
            }}
          />
          <Tabs.Screen
            name="portfolio"
            options={{
              title: "Portfolio",
              tabBarAccessibilityLabel: "Portfolio tab",
              tabBarButtonTestID: "tab-portfolio",
            }}
          />
          <Tabs.Screen
            name="settings"
            options={{
              title: "Settings",
              tabBarAccessibilityLabel: "Settings tab",
              tabBarButtonTestID: "tab-settings",
            }}
          />
        </Tabs>
      </MarketPreferencesProvider>
    </OnboardingPreferenceProvider>
  );
}
