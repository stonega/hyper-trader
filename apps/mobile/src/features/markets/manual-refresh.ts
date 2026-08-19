export interface ManualRefreshGate {
  current: boolean;
}

export async function runManualRefresh(
  gate: ManualRefreshGate,
  refresh: () => Promise<unknown>,
  setRefreshing: (refreshing: boolean) => void,
): Promise<void> {
  if (gate.current) return;
  gate.current = true;
  setRefreshing(true);
  try {
    await refresh();
  } finally {
    gate.current = false;
    setRefreshing(false);
  }
}
