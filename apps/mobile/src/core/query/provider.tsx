import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  IsRestoringProvider,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  persistQueryClientRestore,
  persistQueryClientSave,
} from "@tanstack/react-query-persist-client";
import type { JSX, PropsWithChildren } from "react";
import { useEffect, useState } from "react";

import { warmResumeMarkers } from "../performance/warm-resume";
import { createSafePublicCachePersister } from "../storage/public-cache";
import { createMobileQueryClient } from "./client";
import {
  createPublicCacheDehydrateOptions,
  PUBLIC_CACHE_BUSTER,
  PUBLIC_CACHE_MAX_AGE_MS,
  shouldPersistPublicCacheEvent,
} from "./persistence";

const mobileQueryClient = createMobileQueryClient();
const publicCachePersister = createSafePublicCachePersister(AsyncStorage);
const persistOptions = {
  buster: PUBLIC_CACHE_BUSTER,
  dehydrateOptions: createPublicCacheDehydrateOptions(),
  maxAge: PUBLIC_CACHE_MAX_AGE_MS,
  persister: publicCachePersister,
  queryClient: mobileQueryClient,
};

export function MobileQueryProvider({
  children,
}: PropsWithChildren): JSX.Element {
  const [isRestoring, setIsRestoring] = useState(true);

  useEffect(() => {
    let active = true;
    void persistQueryClientRestore(persistOptions)
      .then(() => {
        warmResumeMarkers.markPublicCacheReady();
      })
      .catch(async () => {
        await publicCachePersister.removeClient();
        warmResumeMarkers.markPublicCacheReady();
      })
      .finally(() => {
        if (active) setIsRestoring(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (isRestoring) return;
    return mobileQueryClient.getQueryCache().subscribe((event) => {
      if (!shouldPersistPublicCacheEvent(event)) return;
      void persistQueryClientSave(persistOptions).catch(() => undefined);
    });
  }, [isRestoring]);

  return (
    <QueryClientProvider client={mobileQueryClient}>
      <IsRestoringProvider value={isRestoring}>{children}</IsRestoringProvider>
    </QueryClientProvider>
  );
}
