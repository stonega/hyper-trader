import type {
  CreateRuleRequest,
  MobileAlertResponse,
  MobileInstallationSnapshotResponse,
} from "@hyper-trader/notifications/mobile";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import {
  createContext,
  type JSX,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { registerBackgroundNotificationTask } from "../../platform/notifications/background-task";
import {
  createNotificationCredentialVault,
  type NotificationSecureStorePort,
} from "../../platform/notifications/credential-vault";
import type { NotificationPermissionState } from "../../platform/notifications/expo-adapter";
import {
  createRuntimeExpoNotificationAdapter,
  installForegroundNotificationPolicy,
} from "../../platform/notifications/expo-runtime";
import { pendingNotificationIntentStore } from "../../platform/notifications/pending-intent-runtime";
import { createNotificationInstallationStateStore } from "./installation-state";
import { parseNotificationPayload } from "./intent";
import { createNotificationLocalStateRepository } from "./local-state";
import type { NotificationSettingsPhase } from "./model";
import { randomNotificationHex } from "./random-id";
import {
  createNotificationServiceClient,
  type NotificationServiceClient,
  NotificationServiceError,
} from "./service-client";

export interface NotificationRuntimeValue {
  readonly status: "loading" | "unavailable" | "ready" | "error";
  readonly phase: NotificationSettingsPhase;
  readonly permission: NotificationPermissionState;
  readonly snapshot: MobileInstallationSnapshotResponse | null;
  readonly revocationPending: boolean;
  readonly message: string;
  enablePriceAlert(rule: CreateRuleRequest): Promise<boolean>;
  deletePriceAlert(ruleId: string): Promise<boolean>;
  refresh(): Promise<boolean>;
  revokeDevice(): Promise<"inactive" | "draining" | "failed">;
  fetchAlert(
    alertId: string,
    signal?: AbortSignal,
  ): Promise<MobileAlertResponse>;
  claimAlert(alertId: string): Promise<boolean>;
  commitAlert(alertId: string): Promise<void>;
  releaseAlert(alertId: string): Promise<void>;
}

const NotificationRuntimeContext =
  createContext<NotificationRuntimeValue | null>(null);

const installationState =
  createNotificationInstallationStateStore(AsyncStorage);
const localRules = createNotificationLocalStateRepository(AsyncStorage);
const inFlightAlertIds = new Set<string>();
const secureStore: NotificationSecureStorePort = {
  whenPasscodeSetThisDeviceOnly: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
  setItem: SecureStore.setItemAsync,
  getItem: SecureStore.getItemAsync,
  deleteItem: SecureStore.deleteItemAsync,
};
const credentialVault = createNotificationCredentialVault({
  store: secureStore,
});

export function NotificationRuntimeProvider({
  children,
}: PropsWithChildren): JSX.Element {
  const router = useRouter();
  const service = useMemo(createConfiguredService, []);
  const expo = useMemo(createRuntimeExpoNotificationAdapter, []);
  const [status, setStatus] =
    useState<NotificationRuntimeValue["status"]>("loading");
  const [phase, setPhase] = useState<NotificationSettingsPhase>("overview");
  const [permission, setPermission] =
    useState<NotificationPermissionState>("undetermined");
  const [snapshot, setSnapshot] =
    useState<MobileInstallationSnapshotResponse | null>(null);
  const [pendingRevocationOperationId, setPendingRevocationOperationId] =
    useState<string | null>(null);
  const [message, setMessage] = useState("Loading notification settings.");
  const installationRef = useRef<string | null>(null);
  const credentialRef = useRef<string | null>(null);
  const pendingRevocationOperationRef = useRef<string | null>(null);
  const snapshotRef = useRef<MobileInstallationSnapshotResponse | null>(null);
  const mutation = useRef(Promise.resolve());
  const refreshInFlight = useRef<Promise<boolean> | null>(null);
  snapshotRef.current = snapshot;

  const serialize = useCallback(<T,>(work: () => Promise<T>): Promise<T> => {
    const next = mutation.current.then(work, work);
    mutation.current = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }, []);

  const loadAuthority = useCallback(async () => {
    const installation = await installationState.read();
    if (installation === null) {
      installationRef.current = null;
      credentialRef.current = null;
      pendingRevocationOperationRef.current = null;
      setPendingRevocationOperationId(null);
      return null;
    }
    const credential = await credentialVault.read(installation.installationId);
    if (credential === null) {
      await installationState.clear();
      installationRef.current = null;
      credentialRef.current = null;
      pendingRevocationOperationRef.current = null;
      setPendingRevocationOperationId(null);
      return null;
    }
    installationRef.current = installation.installationId;
    credentialRef.current = credential;
    pendingRevocationOperationRef.current =
      installation.pendingRevocationOperationId;
    setPendingRevocationOperationId(installation.pendingRevocationOperationId);
    return { installationId: installation.installationId, credential };
  }, []);

  const performRefresh = useCallback(async () => {
    if (service === null) {
      setStatus("unavailable");
      setMessage(
        "Push service configuration is absent. Alerts remain off on this build.",
      );
      return false;
    }
    try {
      const authority =
        installationRef.current && credentialRef.current
          ? {
              installationId: installationRef.current,
              credential: credentialRef.current,
            }
          : await loadAuthority();
      if (authority === null) {
        setSnapshot(null);
        setStatus(expo === null ? "unavailable" : "ready");
        setMessage(
          expo === null
            ? "An Expo project ID is absent. Push alerts remain off on this build."
            : "Alerts are off. Add a price alert to request notification access.",
        );
        return true;
      }
      const local = await localRules.hydrate();
      if (local.status === "ready") {
        const replayedRuleIds: string[] = [];
        for (const rule of local.pendingPriceMutations) {
          try {
            await service.putRule({ rule }, authority.credential);
            replayedRuleIds.push(rule.ruleId);
          } catch {
            break;
          }
        }
        if (replayedRuleIds.length > 0) {
          await localRules.removePendingPriceRules(replayedRuleIds);
        }
      }
      const next = await service.readSnapshot(
        authority.installationId,
        authority.credential,
      );
      setSnapshot(next);
      setStatus("ready");
      setMessage(
        next.deliveryHealth === "healthy"
          ? "Notification delivery is healthy."
          : next.deliveryHealth === "pending"
            ? "Some notification deliveries are still pending."
            : "Notification delivery needs attention.",
      );
      return true;
    } catch {
      setStatus("error");
      setMessage(
        pendingRevocationOperationRef.current === null
          ? "Notification state could not be verified. No local state is being presented as current."
          : "Device revocation is unresolved. Retry uses the same saved operation until the service verifies inactive.",
      );
      return false;
    }
  }, [expo, loadAuthority, service]);

  const refresh = useCallback(() => {
    if (refreshInFlight.current) return refreshInFlight.current;
    const current = performRefresh().finally(() => {
      if (refreshInFlight.current === current) refreshInFlight.current = null;
    });
    refreshInFlight.current = current;
    return current;
  }, [performRefresh]);

  useEffect(() => {
    installForegroundNotificationPolicy();
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (expo === null) {
      setPermission("unavailable");
      return;
    }
    void expo.permission().then(setPermission, () => {
      setPermission("unavailable");
    });
  }, [expo]);

  useEffect(() => {
    const openResponse = async (
      response: Notifications.NotificationResponse,
    ) => {
      const parsed = parseNotificationPayload(
        response.notification.request.content.data,
      );
      if (!parsed) return;
      router.push({
        pathname: "/notification",
        params: { alertId: parsed.alertId },
      });
    };
    const responseSubscription =
      Notifications.addNotificationResponseReceivedListener((response) => {
        void openResponse(response);
      });
    void Notifications.getLastNotificationResponseAsync().then(
      async (response) => {
        if (response) {
          await openResponse(response);
          await Notifications.clearLastNotificationResponseAsync();
        } else {
          const alertId = await pendingNotificationIntentStore.consume();
          if (alertId) {
            router.push({ pathname: "/notification", params: { alertId } });
          }
        }
      },
    );
    return () => responseSubscription.remove();
  }, [router]);

  useEffect(() => {
    if (expo === null || service === null) return;
    const subscription = Notifications.addPushTokenListener(() => {
      void serialize(async () => {
        const installationId = installationRef.current;
        const credential = credentialRef.current;
        if (!installationId || !credential) return;
        if ((snapshotRef.current?.accountLinks.length ?? 0) > 0) {
          setMessage(
            "The device token changed. Fresh master-wallet proof is required before account alerts can resume.",
          );
          return;
        }
        try {
          const pushToken = await expo.reacquireToken();
          await service.rebindPushToken(
            { installationId, provider: "expo", pushToken },
            credential,
          );
          await refresh();
        } catch {
          setMessage(
            "The device token changed but could not be registered. Alerts may not arrive until retry succeeds.",
          );
        }
      });
    });
    return () => subscription.remove();
  }, [expo, refresh, serialize, service]);

  const enablePriceAlert = useCallback(
    async (rule: CreateRuleRequest) =>
      serialize(async () => {
        if (rule.scope !== "price") {
          setMessage(
            "Account alert changes require fresh master-wallet proof.",
          );
          return false;
        }
        if (service === null || expo === null) {
          setStatus("unavailable");
          setMessage(
            "This build is missing verified push-service or Expo project configuration.",
          );
          return false;
        }
        if (pendingRevocationOperationRef.current !== null) {
          setStatus("error");
          setMessage(
            "Device revocation is still unresolved. New alerts remain blocked.",
          );
          return false;
        }
        setPhase("requesting_permission");
        try {
          const access = await expo.requestAccessAndToken();
          setPermission(access.permission);
          if (access.pushToken === null) {
            setPhase("overview");
            setMessage(
              access.permission === "denied"
                ? "Notifications are denied in system settings. No alert was created."
                : "Notification access was not granted. No alert was created.",
            );
            return false;
          }
          await registerBackgroundNotificationTask();
          const loadedAuthority =
            installationRef.current && credentialRef.current
              ? {
                  installationId: installationRef.current,
                  credential: credentialRef.current,
                }
              : await loadAuthority();
          let installationId = loadedAuthority?.installationId ?? null;
          let credential = loadedAuthority?.credential ?? null;
          let needsRegistration = false;
          if (!installationId || !credential) {
            setPhase("registering_token");
            installationId = await randomNotificationHex(16);
            credential = await randomNotificationHex(32);
            try {
              await installationState.write(installationId);
              await credentialVault.write({ installationId, credential });
            } catch {
              await installationState.clear().catch(() => undefined);
              await credentialVault
                .remove(installationId)
                .catch(() => undefined);
              throw new Error("installation authority could not be stored");
            }
            installationRef.current = installationId;
            credentialRef.current = credential;
            pendingRevocationOperationRef.current = null;
            setPendingRevocationOperationId(null);
            needsRegistration = true;
          } else {
            try {
              await service.readSnapshot(installationId, credential);
            } catch (error) {
              if (
                error instanceof NotificationServiceError &&
                error.code === "not_found"
              ) {
                needsRegistration = true;
              } else {
                throw error;
              }
            }
          }
          if (needsRegistration) {
            setPhase("registering_token");
            try {
              await service.registerInstallation({
                installationId,
                credential,
                provider: "expo",
                pushToken: access.pushToken,
              });
            } catch {
              throw new Error(
                "installation registration is incomplete and can be retried",
              );
            }
          }
          setPhase("syncing_rule");
          try {
            await service.putRule({ rule }, credential);
          } catch {
            await localRules.queuePriceRule(rule);
            setPhase("overview");
            setStatus("error");
            setMessage(
              "The price alert edit is queued on this device, but the service has not verified it as active.",
            );
            return false;
          }
          await refresh();
          setPhase("overview");
          setMessage("The price alert is active for this installation.");
          return true;
        } catch {
          setPhase("failure");
          setStatus("error");
          setMessage(
            "The alert could not be verified with the service. No success is being claimed.",
          );
          return false;
        }
      }),
    [expo, loadAuthority, refresh, serialize, service],
  );

  const deletePriceAlert = useCallback(
    async (ruleId: string) =>
      serialize(async () => {
        const installationId = installationRef.current;
        const credential = credentialRef.current;
        if (!service || !installationId || !credential) return false;
        setPhase("syncing_rule");
        try {
          await service.deletePriceRule({ installationId, ruleId }, credential);
          await refresh();
          setPhase("overview");
          setMessage("The price alert was deleted from the service.");
          return true;
        } catch {
          setPhase("failure");
          setMessage(
            "The service did not verify that the price alert was deleted.",
          );
          return false;
        }
      }),
    [refresh, serialize, service],
  );

  const revokeDevice = useCallback(
    async () =>
      serialize(async () => {
        const installationId = installationRef.current;
        const credential = credentialRef.current;
        if (!service || !installationId || !credential)
          return "failed" as const;
        setPhase("revoking");
        try {
          let operationId = pendingRevocationOperationRef.current;
          if (operationId === null) {
            operationId = await randomNotificationHex(16);
            await installationState.setPendingRevocationOperation(operationId);
            pendingRevocationOperationRef.current = operationId;
            setPendingRevocationOperationId(operationId);
          }
          const result = await service.revokeInstallation(
            {
              installationId,
              operationId,
            },
            credential,
          );
          if (result.state === "draining") {
            setMessage(
              "Device revocation is draining provider work. The installation is not yet claimed inactive.",
            );
            return "draining" as const;
          }
          await credentialVault.remove(installationId);
          await installationState.clear();
          installationRef.current = null;
          credentialRef.current = null;
          pendingRevocationOperationRef.current = null;
          setPendingRevocationOperationId(null);
          setSnapshot(null);
          setPhase("overview");
          setMessage("This notification installation is inactive.");
          return "inactive" as const;
        } catch {
          setPhase("failure");
          setMessage("The service did not verify device revocation.");
          return "failed" as const;
        }
      }),
    [serialize, service],
  );

  const fetchAlert = useCallback(
    async (alertId: string, signal?: AbortSignal) => {
      const installationId = installationRef.current;
      const credential = credentialRef.current;
      if (!service || !installationId || !credential) {
        throw new Error("notification installation authority unavailable");
      }
      return service.readAlert(alertId, credential, signal);
    },
    [service],
  );

  const claimAlert = useCallback(async (alertId: string) => {
    if (inFlightAlertIds.has(alertId)) return false;
    inFlightAlertIds.add(alertId);
    const local = await localRules.hydrate();
    if (
      local.status !== "ready" ||
      (await localRules.hasHandledAlert(alertId))
    ) {
      inFlightAlertIds.delete(alertId);
      return false;
    }
    return true;
  }, []);

  const commitAlert = useCallback(async (alertId: string) => {
    try {
      const local = await localRules.hydrate();
      if (local.status !== "ready") {
        throw new Error("notification local state is unavailable");
      }
      await localRules.markAlertHandled(alertId);
    } finally {
      inFlightAlertIds.delete(alertId);
    }
  }, []);

  const releaseAlert = useCallback(async (alertId: string) => {
    inFlightAlertIds.delete(alertId);
  }, []);

  const value = useMemo<NotificationRuntimeValue>(
    () => ({
      status,
      phase,
      permission,
      snapshot,
      revocationPending: pendingRevocationOperationId !== null,
      message,
      enablePriceAlert,
      deletePriceAlert,
      refresh,
      revokeDevice,
      fetchAlert,
      claimAlert,
      commitAlert,
      releaseAlert,
    }),
    [
      deletePriceAlert,
      enablePriceAlert,
      fetchAlert,
      message,
      claimAlert,
      commitAlert,
      permission,
      pendingRevocationOperationId,
      phase,
      refresh,
      releaseAlert,
      revokeDevice,
      snapshot,
      status,
    ],
  );
  return (
    <NotificationRuntimeContext.Provider value={value}>
      {children}
    </NotificationRuntimeContext.Provider>
  );
}

export function useNotificationRuntime(): NotificationRuntimeValue {
  const value = useContext(NotificationRuntimeContext);
  if (!value) {
    throw new Error(
      "useNotificationRuntime must be used inside NotificationRuntimeProvider.",
    );
  }
  return value;
}

function createConfiguredService(): NotificationServiceClient | null {
  const origin =
    process.env.EXPO_PUBLIC_NOTIFICATION_SERVICE_ORIGIN ??
    Constants.expoConfig?.extra?.notificationServiceOrigin;
  if (typeof origin !== "string") return null;
  try {
    return createNotificationServiceClient({ origin, fetch: globalThis.fetch });
  } catch {
    return null;
  }
}
