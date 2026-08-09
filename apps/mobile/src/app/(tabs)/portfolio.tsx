import type { JSX } from "react";
import { ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ScreenHeading } from "../../components/screen-heading";
import { SetupResumeCard } from "../../components/setup-resume-card";
import { useTradingContext } from "../../core/context/provider";

export default function PortfolioScreen(): JSX.Element {
  const insets = useSafeAreaInsets();
  const { current } = useTradingContext();
  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-6 px-5 pb-10"
      contentContainerStyle={{ paddingTop: Math.max(insets.top, 20) }}
    >
      <ScreenHeading
        title="Portfolio"
        description="Account value, positions, orders, and balances will appear here after an account is explicitly connected."
        network={current.network}
      />
      <SetupResumeCard />
    </ScrollView>
  );
}
