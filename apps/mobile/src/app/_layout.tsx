import { BarlowSemiCondensed_400Regular } from "@expo-google-fonts/barlow-semi-condensed/400Regular";
import { BarlowSemiCondensed_500Medium } from "@expo-google-fonts/barlow-semi-condensed/500Medium";
import { BarlowSemiCondensed_600SemiBold } from "@expo-google-fonts/barlow-semi-condensed/600SemiBold";
import { BarlowSemiCondensed_700Bold } from "@expo-google-fonts/barlow-semi-condensed/700Bold";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { HeroUINativeProvider } from "heroui-native/provider";
import type { JSX } from "react";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { DraftRegistryProvider } from "../core/actions/draft-provider";
import { TradingContextProvider } from "../core/context/provider";
import { NativeLifecycleProvider } from "../core/lifecycle/provider";
import { MobileQueryProvider } from "../core/query/provider";
import { StreamRuntimeProvider } from "../core/streams/provider";
import { AccountDirectoryProvider } from "../features/accounts/account-directory-provider";
import { ActiveAccountContextRestorer } from "../features/accounts/active-account-context-restorer";
import { ActionFlowSheet } from "../features/actions/action-flow-sheet";
import {
  TradingActionRuntimeProvider,
  TradingSignerSessionProvider,
} from "../features/actions/development-trading-runtime";
import { NotificationRuntimeProvider } from "../features/notifications/provider";
import { PortfolioStartupLoader } from "../features/portfolio/portfolio-startup-loader";
import { AppearancePreferenceProvider } from "../features/settings/appearance-provider";
import { ScopedTradingPreferencesProvider } from "../features/settings/preferences-provider";

import "../global.css";

void SplashScreen.preventAutoHideAsync();

export default function RootLayout(): JSX.Element {
  const [fontsLoaded, fontError] = useFonts({
    BarlowSemiCondensed_400Regular,
    BarlowSemiCondensed_500Medium,
    BarlowSemiCondensed_600SemiBold,
    BarlowSemiCondensed_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      void SplashScreen.hideAsync();
    }
  }, [fontError, fontsLoaded]);

  // Mount behind the native splash so cache restoration and market requests
  // can run in parallel with local font loading on a cold start.
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <HeroUINativeProvider>
        <AppearancePreferenceProvider>
          <SafeAreaProvider>
            <MobileQueryProvider>
              <AccountDirectoryProvider>
                <TradingSignerSessionProvider>
                  <StreamRuntimeProvider>
                    <DraftRegistryProvider>
                      <TradingContextProvider>
                        <ActiveAccountContextRestorer />
                        <PortfolioStartupLoader />
                        <ScopedTradingPreferencesProvider>
                          <TradingActionRuntimeProvider>
                            <NativeLifecycleProvider>
                              <NotificationRuntimeProvider>
                                <StatusBar style="auto" />
                                <Stack screenOptions={{ headerShown: false }}>
                                  <Stack.Screen
                                    name="notification-settings"
                                    options={{
                                      animation: "none",
                                      gestureEnabled: false,
                                    }}
                                  />
                                  <Stack.Screen
                                    name="notification"
                                    options={{
                                      animation: "none",
                                      gestureEnabled: false,
                                    }}
                                  />
                                </Stack>
                                <ActionFlowSheet />
                              </NotificationRuntimeProvider>
                            </NativeLifecycleProvider>
                          </TradingActionRuntimeProvider>
                        </ScopedTradingPreferencesProvider>
                      </TradingContextProvider>
                    </DraftRegistryProvider>
                  </StreamRuntimeProvider>
                </TradingSignerSessionProvider>
              </AccountDirectoryProvider>
            </MobileQueryProvider>
          </SafeAreaProvider>
        </AppearancePreferenceProvider>
      </HeroUINativeProvider>
    </GestureHandlerRootView>
  );
}
