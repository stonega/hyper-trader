import { focusManager, onlineManager } from "@tanstack/react-query";
import * as Network from "expo-network";
import type { JSX, PropsWithChildren } from "react";
import { useEffect } from "react";
import { AppState, Platform } from "react-native";

import { warmResumeMarkers } from "../performance/warm-resume";
import { useSignerSession } from "../session/provider";
import { useStreamRuntime } from "../streams/provider";
import { createAppLifecycleController } from "./controller";
import {
  type AppStateEventSource,
  installNativeLifecycleBindings,
  type NetworkEventSource,
} from "./native-events";

function normalizeAppState(value: string) {
  return value === "active" || value === "inactive" || value === "background"
    ? value
    : null;
}

const appStateSource: AppStateEventSource = {
  get currentState() {
    return normalizeAppState(AppState.currentState);
  },
  addEventListener: ((
    event: "change" | "blur" | "focus",
    listener: unknown,
  ) => {
    if (event === "change") {
      return AppState.addEventListener("change", (state) => {
        const normalized = normalizeAppState(state);
        if (normalized) {
          (listener as (value: typeof normalized) => void)(normalized);
        }
      });
    }
    return AppState.addEventListener(event, listener as () => void);
  }) as AppStateEventSource["addEventListener"],
};

const networkSource: NetworkEventSource = {
  getNetworkStateAsync: Network.getNetworkStateAsync,
  addNetworkStateListener: Network.addNetworkStateListener,
};

export function NativeLifecycleProvider({
  children,
}: PropsWithChildren): JSX.Element {
  const signerSession = useSignerSession();
  const streams = useStreamRuntime();

  useEffect(() => {
    onlineManager.setOnline(false);
    streams.setOnline(false);
    const controller = createAppLifecycleController({
      initialOnline: false,
      setFocused(focused) {
        focusManager.setFocused(focused);
        if (focused) {
          warmResumeMarkers.markResumeStarted();
        }
      },
      setOnline(online) {
        onlineManager.setOnline(online);
        streams.setOnline(online);
      },
      lockSignerSession: signerSession.lock,
      startStreams: () => streams.setForeground(true),
      stopStreams(reason) {
        if (reason !== "offline") {
          streams.setForeground(false);
        }
      },
    });
    const binding = installNativeLifecycleBindings({
      appState: appStateSource,
      network: networkSource,
      controller,
      platform: Platform.OS === "android" ? "android" : "ios",
    });
    return () => {
      binding.dispose();
      streams.setForeground(false);
    };
  }, [signerSession.lock, streams]);

  return <>{children}</>;
}
