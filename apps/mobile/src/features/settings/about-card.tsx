import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import Octicons from "@expo/vector-icons/Octicons";
import * as Clipboard from "expo-clipboard";
import { Button } from "heroui-native/button";
import { useThemeColor } from "heroui-native/hooks";
import type { JSX } from "react";
import { useEffect, useState } from "react";
import { Linking, View } from "react-native";

import { AppText as Text } from "../../components/app-text";
import { useReducedMotion } from "../../components/use-reduced-motion";
import { SettingsSection } from "./settings-section";

const TELEGRAM_GROUP_URL = "https://t.me/+3okq17iiGak4NWFl";
const GITHUB_REPOSITORY_URL = "https://github.com/stonega/hyper-trader";
const DONATION_WALLET_ADDRESS = "0x065699fda5db01cdbffd1625aeed8e6f5ba7efdf";

export function AboutCard(): JSX.Element {
  const reducedMotion = useReducedMotion();
  const [heartColor, socialIconColor] = useThemeColor([
    "danger",
    "default-foreground",
  ]);
  const [copyConfirmation, setCopyConfirmation] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (copyConfirmation === 0) {
      return;
    }

    const timeout = setTimeout(() => setCopyConfirmation(0), 2_000);
    return () => clearTimeout(timeout);
  }, [copyConfirmation]);

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
      setNotice(null);
      setCopyConfirmation((confirmation) => confirmation + 1);
    } catch {
      setCopyConfirmation(0);
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
          accessibilityLabel="Telegram"
          animation={reducedMotion ? "disable-all" : undefined}
          className="min-h-12 flex-1"
          onPress={() => void openExternalLink(TELEGRAM_GROUP_URL, "Telegram")}
          variant="outline"
        >
          <FontAwesome6
            accessibilityElementsHidden
            color={socialIconColor}
            iconStyle="brand"
            importantForAccessibility="no-hide-descendants"
            name="telegram"
            size={18}
          />
          <Button.Label>Telegram</Button.Label>
        </Button>
        <Button
          accessibilityHint="Opens the Hyper Trader source code on GitHub."
          accessibilityLabel="GitHub"
          animation={reducedMotion ? "disable-all" : undefined}
          className="min-h-12 flex-1"
          onPress={() => void openExternalLink(GITHUB_REPOSITORY_URL, "GitHub")}
          variant="outline"
        >
          <FontAwesome6
            accessibilityElementsHidden
            color={socialIconColor}
            iconStyle="brand"
            importantForAccessibility="no-hide-descendants"
            name="github"
            size={18}
          />
          <Button.Label>GitHub</Button.Label>
        </Button>
      </View>

      <View className="gap-3 rounded-2xl bg-surface-secondary p-4">
        <View className="flex-row items-center gap-2" testID="support-work-row">
          <View className="min-w-0 flex-1 flex-row items-center gap-2">
            <Octicons
              accessibilityElementsHidden
              color={heartColor}
              importantForAccessibility="no-hide-descendants"
              name="heart-fill"
              size={18}
            />
            <Text className="text-sm font-medium text-foreground">
              Support our work
            </Text>
          </View>
          <Button
            accessibilityHint="Copies the donation wallet address."
            animation={reducedMotion ? "disable-all" : undefined}
            className="min-h-11 shrink-0"
            onPress={() => void copyDonationAddress()}
            size="sm"
            variant="ghost"
          >
            {copyConfirmation > 0 ? "Thank you!" : "Copy"}
          </Button>
        </View>
        <Button
          accessibilityHint="Copies this donation wallet address."
          accessibilityLabel={`Copy donation wallet address ${DONATION_WALLET_ADDRESS}`}
          animation={reducedMotion ? "disable-all" : undefined}
          className="min-h-12 w-full px-3"
          onPress={() => void copyDonationAddress()}
          variant="outline"
        >
          <Button.Label className="min-w-0 flex-1">
            <Text className="text-center font-mono text-xs leading-5">
              {DONATION_WALLET_ADDRESS}
            </Text>
          </Button.Label>
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

      <Text className="text-sm leading-5 text-muted">
        Hyper Trader is an unofficial, independent community project. It is not
        affiliated with or endorsed by Hyperliquid.
      </Text>
    </SettingsSection>
  );
}
