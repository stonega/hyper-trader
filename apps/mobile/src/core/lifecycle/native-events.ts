import type { AppLifecycleController, AppVisibility } from "./controller";

export interface RemovableSubscription {
  remove(): void;
}

export interface AppStateEventSource {
  readonly currentState: AppVisibility | null;
  addEventListener(
    event: "change",
    listener: (state: AppVisibility) => void,
  ): RemovableSubscription;
  addEventListener(
    event: "blur" | "focus",
    listener: () => void,
  ): RemovableSubscription;
}

export interface NetworkStateLike {
  readonly isConnected?: boolean;
  readonly isInternetReachable?: boolean;
}

export interface NetworkEventSource {
  getNetworkStateAsync(): Promise<NetworkStateLike>;
  addNetworkStateListener(
    listener: (state: NetworkStateLike) => void,
  ): RemovableSubscription;
}

export interface NativeLifecycleBinding {
  readonly initialNetworkReady: Promise<void>;
  dispose(): void;
}

export function isNetworkOnline(state: NetworkStateLike): boolean {
  if (state.isConnected === false || state.isInternetReachable === false) {
    return false;
  }
  return state.isInternetReachable === true || state.isConnected === true;
}

export function installNativeLifecycleBindings(options: {
  readonly appState: AppStateEventSource;
  readonly network: NetworkEventSource;
  readonly controller: AppLifecycleController;
  readonly platform: "android" | "ios";
}): NativeLifecycleBinding {
  let disposed = false;
  let networkEventEpoch = 0;
  const subscriptions: RemovableSubscription[] = [];

  if (options.appState.currentState !== null) {
    options.controller.onAppStateChange(options.appState.currentState);
  }
  subscriptions.push(
    options.appState.addEventListener("change", (state) =>
      options.controller.onAppStateChange(state),
    ),
    options.network.addNetworkStateListener((state) => {
      networkEventEpoch += 1;
      options.controller.onNetworkChange(isNetworkOnline(state));
    }),
  );
  if (options.platform === "android") {
    subscriptions.push(
      options.appState.addEventListener("blur", () =>
        options.controller.onAndroidBlur(),
      ),
      options.appState.addEventListener("focus", () =>
        options.controller.onAndroidFocus(),
      ),
    );
  }

  const capturedNetworkEpoch = networkEventEpoch;
  const initialNetworkReady = options.network
    .getNetworkStateAsync()
    .then((state) => {
      if (!disposed && capturedNetworkEpoch === networkEventEpoch) {
        options.controller.onNetworkChange(isNetworkOnline(state));
      }
    })
    .catch(() => {
      if (!disposed && capturedNetworkEpoch === networkEventEpoch) {
        options.controller.onNetworkChange(false);
      }
    });

  return {
    initialNetworkReady,
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      networkEventEpoch += 1;
      for (const subscription of subscriptions) {
        subscription.remove();
      }
    },
  };
}
