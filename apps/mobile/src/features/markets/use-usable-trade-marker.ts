import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";

import { scheduleAfterIdleFrame } from "../../core/performance/idle-frame";
import { warmResumeMarkers } from "../../core/performance/warm-resume";

export function useUsableTradeMarker(ready: boolean): void {
  const focused = useRef(false);
  const readyRef = useRef(ready);
  const generation = useRef(0);
  const markedGeneration = useRef(-1);

  readyRef.current = ready;

  const scheduleMark = useCallback(() => {
    const scheduledGeneration = generation.current;
    if (
      !focused.current ||
      !readyRef.current ||
      markedGeneration.current === scheduledGeneration
    ) {
      return () => {};
    }
    return scheduleAfterIdleFrame(() => {
      if (
        focused.current &&
        readyRef.current &&
        generation.current === scheduledGeneration &&
        markedGeneration.current !== scheduledGeneration
      ) {
        markedGeneration.current = scheduledGeneration;
        warmResumeMarkers.markUsableTrade();
      }
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      const cancel = scheduleMark();
      return () => {
        focused.current = false;
        cancel();
      };
    }, [scheduleMark]),
  );

  useEffect(() => {
    if (ready) {
      return scheduleMark();
    }
    return undefined;
  }, [ready, scheduleMark]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && focused.current) {
        generation.current += 1;
        scheduleMark();
      }
    });
    return () => subscription.remove();
  }, [scheduleMark]);
}
