import { useSyncExternalStore } from "react";
import { AccessibilityInfo } from "react-native";

let reducedMotion = true;
let nativeSubscription: { remove(): void } | null = null;
const listeners = new Set<() => void>();

function updateReducedMotion(enabled: boolean): void {
  if (reducedMotion === enabled) {
    return;
  }
  reducedMotion = enabled;
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    nativeSubscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      updateReducedMotion,
    );
    void AccessibilityInfo.isReduceMotionEnabled()
      .then(updateReducedMotion)
      .catch(() => undefined);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      nativeSubscription?.remove();
      nativeSubscription = null;
    }
  };
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => reducedMotion,
    () => true,
  );
}
