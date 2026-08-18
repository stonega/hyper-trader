export type AppVisibility = "active" | "inactive" | "background";

export type SessionLockReason =
  | "app_inactive"
  | "app_background"
  | "android_blur";

export type StreamStopReason = SessionLockReason | "offline";

export interface AppLifecycleControllerOptions {
  readonly setFocused: (focused: boolean) => void;
  readonly setOnline?: (online: boolean) => void;
  readonly lockSignerSession?: (reason: SessionLockReason) => void;
  readonly startStreams?: () => void;
  readonly stopStreams?: (reason: StreamStopReason) => void;
  readonly initialOnline?: boolean;
}

export interface AppLifecycleController {
  onAppStateChange(state: AppVisibility): void;
  onNetworkChange(online: boolean): void;
  onAndroidBlur(): void;
  onAndroidFocus(): void;
  isForeground(): boolean;
  isOnline(): boolean;
}

export function createAppLifecycleController(
  options: AppLifecycleControllerOptions,
): AppLifecycleController {
  let visibility: AppVisibility | null = null;
  let online = options.initialOnline ?? true;
  let blurred = false;
  let streamsRunning = false;

  const mayRunStreams = () => visibility === "active" && online && !blurred;

  const startStreamsIfAllowed = () => {
    if (!mayRunStreams() || streamsRunning) {
      return;
    }
    streamsRunning = true;
    options.startStreams?.();
  };

  const stopStreams = (reason: StreamStopReason) => {
    streamsRunning = false;
    options.stopStreams?.(reason);
  };

  return {
    onAppStateChange(next) {
      if (visibility === next) {
        return;
      }
      visibility = next;
      if (next === "active") {
        blurred = false;
        options.setFocused(true);
        startStreamsIfAllowed();
        return;
      }
      options.setFocused(false);
      const reason = next === "inactive" ? "app_inactive" : "app_background";
      options.lockSignerSession?.(reason);
      stopStreams(reason);
    },
    onNetworkChange(next) {
      if (online === next) {
        return;
      }
      online = next;
      options.setOnline?.(next);
      if (!next) {
        stopStreams("offline");
        return;
      }
      startStreamsIfAllowed();
    },
    onAndroidBlur() {
      if (blurred) {
        return;
      }
      blurred = true;
      options.setFocused(false);
      options.lockSignerSession?.("android_blur");
      stopStreams("android_blur");
    },
    onAndroidFocus() {
      if (!blurred) {
        return;
      }
      blurred = false;
      if (visibility === "active") {
        options.setFocused(true);
        startStreamsIfAllowed();
      }
    },
    isForeground: mayRunStreams,
    isOnline: () => online,
  };
}
