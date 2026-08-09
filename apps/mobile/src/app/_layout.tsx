import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { HeroUINativeProvider } from "heroui-native/provider";
import type { JSX } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { DraftRegistryProvider } from "../core/actions/draft-provider";
import { TradingContextProvider } from "../core/context/provider";
import { NativeLifecycleProvider } from "../core/lifecycle/provider";
import { NotificationIntentProvider } from "../core/notifications/intent-provider";
import { MobileQueryProvider } from "../core/query/provider";
import { SignerSessionProvider } from "../core/session/provider";
import { StreamRuntimeProvider } from "../core/streams/provider";
import { AccountDirectoryProvider } from "../features/accounts/account-directory-provider";
import { ActionRuntimeProvider } from "../features/actions/runtime-provider";
import { AppearancePreferenceProvider } from "../features/settings/appearance-provider";
import { ScopedTradingPreferencesProvider } from "../features/settings/preferences-provider";

import "../global.css";

export default function RootLayout(): JSX.Element {
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
                              <NotificationIntentProvider>
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
                                </Stack>
                              </NotificationIntentProvider>
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
