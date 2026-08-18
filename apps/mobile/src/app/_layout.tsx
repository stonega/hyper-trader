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
import { SignerSessionProvider } from "../core/session/provider";
import { StreamRuntimeProvider } from "../core/streams/provider";
import { AccountDirectoryProvider } from "../features/accounts/account-directory-provider";
import { ActionRuntimeProvider } from "../features/actions/runtime-provider";
import { NotificationRuntimeProvider } from "../features/notifications/provider";
import { AppearancePreferenceProvider } from "../features/settings/appearance-provider";
import { ScopedTradingPreferencesProvider } from "../features/settings/preferences-provider";

import "../global.css";

void SplashScreen.preventAutoHideAsync();

export default function RootLayout(): JSX.Element | null {
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

  if (!fontsLoaded && !fontError) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <HeroUINativeProvider>
        <AppearancePreferenceProvider>
          <SafeAreaProvider>
            <MobileQueryProvider>
              <AccountDirectoryProvider>
                <SignerSessionProvider>
                  <StreamRuntimeProvider>
                    <DraftRegistryProvider>
                      <TradingContextProvider>
                        <ScopedTradingPreferencesProvider>
                          <ActionRuntimeProvider>
                            <NativeLifecycleProvider>
                              <NotificationRuntimeProvider>
                                <StatusBar style="auto" />
                                <Stack screenOptions={{ headerShown: false }}>
                                  <Stack.Screen
                                    name="action-review"
                                    options={{
                                      animation: "none",
                                      gestureEnabled: false,
                                      presentation: "modal",
                                    }}
                                  />
                                  <Stack.Screen
                                    name="action-result"
                                    options={{
                                      animation: "none",
                                      gestureEnabled: false,
                                      presentation: "modal",
                                    }}
                                  />
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
                              </NotificationRuntimeProvider>
                            </NativeLifecycleProvider>
                          </ActionRuntimeProvider>
                        </ScopedTradingPreferencesProvider>
                      </TradingContextProvider>
                    </DraftRegistryProvider>
                  </StreamRuntimeProvider>
                </SignerSessionProvider>
              </AccountDirectoryProvider>
            </MobileQueryProvider>
          </SafeAreaProvider>
        </AppearancePreferenceProvider>
      </HeroUINativeProvider>
    </GestureHandlerRootView>
  );
}
