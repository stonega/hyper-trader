import Octicons from "@expo/vector-icons/Octicons";
import * as Clipboard from "expo-clipboard";
import { Button } from "heroui-native/button";
import { useThemeColor } from "heroui-native/hooks";
import type { JSX } from "react";
import { useState } from "react";
import { Linking, View } from "react-native";

import { AppText as Text } from "../../components/app-text";
import { useReducedMotion } from "../../components/use-reduced-motion";
import { SettingsSection } from "./settings-section";

const TELEGRAM_GROUP_URL = "https://t.me/+3okq17iiGak4NWFl";
const GITHUB_REPOSITORY_URL = "https://github.com/stonega/hyper-trader";
const DONATION_WALLET_ADDRESS = "0x065699fda5db01cdbffd1625aeed8e6f5ba7efdf";

export function AboutCard(): JSX.Element {
  const reducedMotion = useReducedMotion();
  const accent = useThemeColor("accent");
  const [notice, setNotice] = useState<string | null>(null);

  const openExternalLink = async (url: string, label: string) => {
    try {
      await Linking.openURL(url);
      setNotice(null);
    } catch {
      setNotice(
        `${label} could not be opened. Check your connection and try again.`,
      );
    }
  };

  const copyDonationAddress = async () => {
    try {
      await Clipboard.setStringAsync(DONATION_WALLET_ADDRESS);
      setNotice("Donation address copied.");
    } catch {
      setNotice("Donation address could not be copied. Select it manually.");
    }
  };

  return (
    <SettingsSection
      title="About"
      description="Community, source code, and ways to support Hyper Trader."
    >
      <View className="flex-row gap-2">
        <Button
          accessibilityHint="Opens the Hyper Trader Telegram group."
          animation={reducedMotion ? "disable-all" : undefined}
          className="min-h-12 flex-1"
          onPress={() => void openExternalLink(TELEGRAM_GROUP_URL, "Telegram")}
          variant="secondary"
        >
          Telegram
        </Button>
        <Button
          accessibilityHint="Opens the Hyper Trader source code on GitHub."
          animation={reducedMotion ? "disable-all" : undefined}
          className="min-h-12 flex-1"
          onPress={() => void openExternalLink(GITHUB_REPOSITORY_URL, "GitHub")}
          variant="outline"
        >
          GitHub
        </Button>
      </View>

      <View className="gap-3 rounded-2xl bg-surface-secondary p-4">
        <View className="gap-1">
          <View className="flex-row items-center gap-2">
            <Octicons
              accessibilityElementsHidden
              color={accent}
              importantForAccessibility="no-hide-descendants"
              name="star"
              size={18}
            />
            <Text className="text-sm font-medium text-foreground">
              Donation wallet
            </Text>
          </View>
          <Text
            accessibilityLabel={`Donation wallet address ${DONATION_WALLET_ADDRESS}`}
            className="font-mono text-xs leading-5 text-muted"
            selectable
          >
            {DONATION_WALLET_ADDRESS}
          </Text>
        </View>
        <Button
          accessibilityHint="Copies the donation wallet address."
          animation={reducedMotion ? "disable-all" : undefined}
          className="min-h-11 w-full"
          onPress={() => void copyDonationAddress()}
          variant="ghost"
        >
          Copy address
        </Button>
      </View>

      {notice ? (
        <Text
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          className="text-sm leading-5 text-muted"
        >
          {notice}
        </Text>
      ) : null}
    </SettingsSection>
  );
}
