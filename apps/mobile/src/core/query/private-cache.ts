import type { QueryClient } from "@tanstack/react-query";

import type { TradingContextCore } from "../context/supervisor";
import { isPrivateQueryKey, isPrivateQueryOwnedBy } from "./keys";

export async function cancelIncompatiblePrivateQueries(
  client: QueryClient,
  destination: TradingContextCore,
): Promise<void> {
  await client.cancelQueries({
    predicate: ({ queryKey }) =>
      isPrivateQueryKey(queryKey) &&
      !isPrivateQueryOwnedBy(queryKey, destination),
  });
}

export function removeIncompatiblePrivateQueries(
  client: QueryClient,
  destination: TradingContextCore,
): void {
  client.removeQueries({
    predicate: ({ queryKey }) =>
      isPrivateQueryKey(queryKey) &&
      !isPrivateQueryOwnedBy(queryKey, destination),
  });
}
