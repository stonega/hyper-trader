import AsyncStorage from "@react-native-async-storage/async-storage";
import { Redirect } from "expo-router";
import type { JSX } from "react";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { readFirstUseOnboardingStatus } from "../features/onboarding/first-use";
import { ONBOARDING_ROUTE, TRADE_ROUTE } from "../navigation/routes";

export default function LaunchScreen(): JSX.Element {
  const [destination, setDestination] = useState<
    typeof ONBOARDING_ROUTE | typeof TRADE_ROUTE | null
  >(null);

  useEffect(() => {
    let active = true;
    void readFirstUseOnboardingStatus(AsyncStorage)
      .then((status) => {
        if (!active) return;
        setDestination(status === "complete" ? TRADE_ROUTE : ONBOARDING_ROUTE);
      })
      .catch(() => {
        if (active) setDestination(ONBOARDING_ROUTE);
      });
    return () => {
      active = false;
    };
  }, []);

  if (destination === null) {
    return <View className="flex-1 bg-background" />;
  }

  return <Redirect href={destination} />;
}
