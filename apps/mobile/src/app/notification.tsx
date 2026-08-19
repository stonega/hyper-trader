import type { MobileAlertResponse } from "@hyper-trader/notifications/mobile";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import type { JSX } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, ScrollView, View } from "react-native";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText as Text } from "../components/app-text";
import { useReducedMotion } from "../components/use-reduced-motion";
import { useTradingContext } from "../core/context/provider";
import { useAccountDirectory } from "../features/accounts/account-directory-provider";
import { refreshAuthoritativeNotificationTarget } from "../features/notifications/authoritative-refresh";
import { createNotificationEntryCoordinator } from "../features/notifications/intent";
import { useNotificationRuntime } from "../features/notifications/provider";

type Phase =
  | "resolving"
  | "confirming_context"
  | "refreshing"
  | "ready"
  | "duplicate"
  | "unavailable";

export default function NotificationEntryScreen(): JSX.Element {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const params = useLocalSearchParams<{ alertId?: string; invalid?: string }>();
  const notifications = useNotificationRuntime();
  const tradingContext = useTradingContext();
  const directory = useAccountDirectory();
  const [phase, setPhase] = useState<Phase>("resolving");
  const [alert, setAlert] = useState<MobileAlertResponse | null>(null);
  const [message, setMessage] = useState("Opening notification…");
  const confirmation = useRef<((accepted: boolean) => void) | null>(null);
  const currentContext = useRef(tradingContext.current);
  const accounts = useRef(directory.accounts);
  currentContext.current = tradingContext.current;
  accounts.current = directory.accounts;
  const busy = phase === "resolving" || phase === "refreshing";
  const fetchAlert = notifications.fetchAlert;
  const claimAlert = notifications.claimAlert;
  const commitAlert = notifications.commitAlert;
  const releaseAlert = notifications.releaseAlert;
  const switchContext = tradingContext.switchContext;
  const selectAccount = directory.select;

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => busy,
    );
    return () => subscription.remove();
  }, [busy]);

  const targetExists = useCallback((candidate: MobileAlertResponse) => {
    if (candidate.rule?.scope === "price") return true;
    if (!candidate.account) return false;
    return accounts.current.some(
      (saved) =>
        saved.network === candidate.network &&
        saved.masterAccount === candidate.account?.masterAccount &&
        saved.target.address === candidate.account.targetAccount,
    );
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const coordinator = createNotificationEntryCoordinator({
      dedupe: {
        claim: claimAlert,
        commit: commitAlert,
        release: releaseAlert,
      },
      service: { fetchAlert },
      context: {
        current: () => currentContext.current,
        targetExists,
        confirmSwitch: async (candidate) => {
          setAlert(candidate);
          setPhase("confirming_context");
          setMessage(
            `Switch to ${candidate.network}${candidate.account ? ` account …${candidate.account.targetAccount.slice(-6)}` : " market data"} to open this alert?`,
          );
          return new Promise<boolean>((resolve) => {
            confirmation.current = resolve;
          });
        },
        activate: async (candidate) => {
          const switched = await switchContext({
            network: candidate.network,
            masterAccount: candidate.account?.masterAccount ?? null,
            targetAccount: candidate.account?.targetAccount ?? null,
            signer: null,
          });
          if (!switched) return false;
          if (!candidate.account) return selectAccount(null);
          const saved = accounts.current.find(
            (account) =>
              account.network === candidate.network &&
              account.masterAccount === candidate.account?.masterAccount &&
              account.target.address === candidate.account.targetAccount,
          );
          return saved ? selectAccount(saved.id) : false;
        },
      },
      authoritative: {
        refresh: async (candidate, signal) => {
          setPhase("refreshing");
          setMessage("Updating current data…");
          return refreshAuthoritativeNotificationTarget(candidate, { signal });
        },
      },
    });
    const alertId = typeof params.alertId === "string" ? params.alertId : "";
    void coordinator.open(alertId, controller.signal).then((result) => {
      confirmation.current = null;
      if (controller.signal.aborted) return;
      if (result.state === "ready") {
        setAlert(result.alert);
        setPhase("ready");
        setMessage("Opening…");
        router.replace(
          result.alert.routeHint === "trade"
            ? "/(tabs)/trade"
            : "/(tabs)/portfolio",
        );
        return;
      }
      if (result.state === "duplicate") {
        setPhase("duplicate");
        setMessage("This alert entry was already handled on this device.");
        return;
      }
      setPhase("unavailable");
      setMessage(
        result.state === "declined"
          ? "The context change was declined. Your active context is unchanged."
          : result.state === "context_change_failed"
            ? "This saved account could not be opened."
            : result.message,
      );
    });
    return () => {
      controller.abort();
      confirmation.current?.(false);
      confirmation.current = null;
    };
  }, [
    fetchAlert,
    claimAlert,
    commitAlert,
    params.alertId,
    releaseAlert,
    router,
    selectAccount,
    switchContext,
    targetExists,
  ]);

  const answerContext = (accepted: boolean) => {
    setPhase("resolving");
    setMessage(
      accepted
        ? "Changing to the confirmed context."
        : "Keeping the current context.",
    );
    confirmation.current?.(accepted);
    confirmation.current = null;
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="justify-center px-5"
      contentContainerStyle={{
        flexGrow: 1,
        paddingTop: Math.max(insets.top, 20),
        paddingBottom: Math.max(insets.bottom, 20),
      }}
      showsVerticalScrollIndicator={false}
    >
      <Animated.View
        entering={FadeIn.duration(160).reduceMotion(
          reducedMotion ? ReduceMotion.Always : ReduceMotion.Never,
        )}
      >
        <Card variant="secondary">
          <Card.Body className="gap-4">
            <Card.Title>Notification</Card.Title>
            <Text
              accessibilityLiveRegion="polite"
              accessibilityRole="alert"
              className="text-sm leading-5 text-muted"
            >
              {message}
            </Text>
            {alert ? (
              <Text className="text-sm leading-5 text-muted">
                {alert.category} · {alert.network}
              </Text>
            ) : null}
            {phase === "confirming_context" ? (
              <View className="gap-3">
                <Button
                  animation={reducedMotion ? "disable-all" : undefined}
                  className="min-h-12 w-full"
                  onPress={() => answerContext(true)}
                  variant="primary"
                >
                  Switch and open
                </Button>
                <Button
                  animation={reducedMotion ? "disable-all" : undefined}
                  className="min-h-12 w-full"
                  onPress={() => answerContext(false)}
                  variant="outline"
                >
                  Decline
                </Button>
              </View>
            ) : null}
            {!busy && phase !== "confirming_context" && phase !== "ready" ? (
              <Button
                animation={reducedMotion ? "disable-all" : undefined}
                className="min-h-12 w-full"
                onPress={() => router.back()}
                variant="outline"
              >
                Close
              </Button>
            ) : null}
          </Card.Body>
        </Card>
      </Animated.View>
    </ScrollView>
  );
}
