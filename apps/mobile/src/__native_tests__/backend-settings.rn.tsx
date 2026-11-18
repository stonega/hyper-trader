import { expect, jest, test } from "@jest/globals";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { useEffect } from "react";
import { Alert, Text } from "react-native";

import { BACKEND_PREFERENCE_KEY } from "../core/backend/preference";
import {
  BackendPreferenceProvider,
  type BackendPreferenceValue,
  useBackendPreference,
} from "../core/backend/provider";
import { MobileQueryProvider } from "../core/query/provider";
import { BackendSection } from "../features/settings/backend-section";

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
jest.mock("../components/use-reduced-motion", () => ({
  useReducedMotion: () => true,
}));
jest.mock("../core/performance/warm-resume", () => ({
  warmResumeMarkers: { markPublicCacheReady: jest.fn() },
}));

const defaultOrigin = "https://default.example.com";
const customOrigin = "https://custom.example.com";

function memoryStorage(initial: string | null = null) {
  const values = new Map<string, string>();
  if (initial !== null) values.set(BACKEND_PREFERENCE_KEY, initial);
  return {
    values,
    getItem: jest.fn(async (key: string) => values.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      values.delete(key);
    }),
  };
}

let preference: BackendPreferenceValue;
function Probe({ mounted }: { readonly mounted?: () => void }) {
  preference = useBackendPreference();
  useEffect(() => {
    mounted?.();
  }, [mounted]);
  return <Text testID="active-backend">{preference.origin}</Text>;
}

test("restores the selected server before mounting any data consumers", async () => {
  let resolve: (value: string | null) => void = () => undefined;
  const mounted = jest.fn();
  const storage = memoryStorage();
  storage.getItem.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  render(
    <BackendPreferenceProvider storage={storage} defaultOrigin={defaultOrigin}>
      <Probe mounted={mounted} />
    </BackendPreferenceProvider>,
  );
  expect(screen.queryByTestId("active-backend")).toBeNull();
  expect(mounted).not.toHaveBeenCalled();
  await act(async () => {
    resolve(JSON.stringify({ version: 1, origin: customOrigin }));
  });
  expect(screen.getByTestId("active-backend").props.children).toBe(
    customOrigin,
  );
  expect(mounted).toHaveBeenCalledTimes(1);
});

test("requires confirmation, persists a normalized URL, restores it, and resets to the build default", async () => {
  const storage = memoryStorage();
  const beforeApply = jest.fn(() => true);
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  const first = render(
    <BackendPreferenceProvider storage={storage} defaultOrigin={defaultOrigin}>
      <Probe />
      <BackendSection beforeApply={beforeApply} />
    </BackendPreferenceProvider>,
  );
  const input = await screen.findByLabelText("Backend URL");
  fireEvent.changeText(input, " HTTPS://Custom.Example.com/ ");
  fireEvent.press(screen.getByRole("button", { name: "Save backend" }));
  expect(alert.mock.calls[0]?.[1]).toContain(customOrigin);
  expect(alert.mock.calls[0]?.[1]).toContain("portfolio account addresses");
  expect(storage.setItem).not.toHaveBeenCalled();
  expect(beforeApply).not.toHaveBeenCalled();
  await act(async () => {
    alert.mock.calls[0]?.[2]
      ?.find((b) => b.text === "Use backend")
      ?.onPress?.();
  });
  await waitFor(() =>
    expect(screen.getByTestId("active-backend").props.children).toBe(
      customOrigin,
    ),
  );
  expect(beforeApply).toHaveBeenCalledTimes(1);
  expect(
    JSON.parse(storage.values.get(BACKEND_PREFERENCE_KEY) ?? "null"),
  ).toEqual({ version: 1, origin: customOrigin });
  first.unmount();
  render(
    <BackendPreferenceProvider storage={storage} defaultOrigin={defaultOrigin}>
      <Probe />
      <BackendSection beforeApply={beforeApply} />
    </BackendPreferenceProvider>,
  );
  expect((await screen.findByLabelText("Backend URL")).props.value).toBe(
    customOrigin,
  );
  fireEvent.press(screen.getByRole("button", { name: "Use default" }));
  await act(async () => {
    alert.mock.calls
      .at(-1)?.[2]
      ?.find((b) => b.text === "Restore default")
      ?.onPress?.();
  });
  await waitFor(() =>
    expect(screen.getByTestId("active-backend").props.children).toBe(
      defaultOrigin,
    ),
  );
  expect(storage.values.has(BACKEND_PREFERENCE_KEY)).toBe(false);
});

test("rejects an insecure URL before confirmation or persistence", async () => {
  const storage = memoryStorage();
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  render(
    <BackendPreferenceProvider storage={storage} defaultOrigin={defaultOrigin}>
      <BackendSection beforeApply={() => true} />
    </BackendPreferenceProvider>,
  );
  fireEvent.changeText(
    await screen.findByLabelText("Backend URL"),
    "http://custom.example.com",
  );
  fireEvent.press(screen.getByRole("button", { name: "Save backend" }));
  expect(screen.getByText(/Enter an HTTPS server URL/)).toBeTruthy();
  expect(alert).not.toHaveBeenCalled();
  expect(storage.setItem).not.toHaveBeenCalled();
});

test("keeps the prior selection when persistence fails", async () => {
  const storage = memoryStorage();
  storage.setItem.mockRejectedValueOnce(new Error("disk unavailable"));
  const beforeApply = jest.fn(() => true);
  const mounted = jest.fn();
  render(
    <BackendPreferenceProvider storage={storage} defaultOrigin={defaultOrigin}>
      <Probe mounted={mounted} />
    </BackendPreferenceProvider>,
  );
  await screen.findByTestId("active-backend");
  await act(async () => {
    expect(await preference.setOrigin(customOrigin, beforeApply)).toBe(false);
  });
  expect(preference.origin).toBe(defaultOrigin);
  expect(preference.status).toBe("error");
  expect(beforeApply).not.toHaveBeenCalled();
  expect(mounted).toHaveBeenCalledTimes(1);
});

test("rechecks the action gate after saving and rolls storage back when a switch is denied", async () => {
  const storage = memoryStorage();
  render(
    <BackendPreferenceProvider storage={storage} defaultOrigin={defaultOrigin}>
      <Probe />
    </BackendPreferenceProvider>,
  );
  await screen.findByTestId("active-backend");
  await act(async () => {
    expect(await preference.setOrigin(customOrigin, () => false)).toBe(false);
  });
  expect(preference.origin).toBe(defaultOrigin);
  expect(storage.values.has(BACKEND_PREFERENCE_KEY)).toBe(false);
});

test("refuses a concurrent write while keeping the active server stable", async () => {
  const storage = memoryStorage();
  let release: () => void = () => undefined;
  storage.setItem.mockImplementationOnce(
    () =>
      new Promise<void>((r) => {
        release = r;
      }),
  );
  render(
    <BackendPreferenceProvider storage={storage} defaultOrigin={defaultOrigin}>
      <Probe />
    </BackendPreferenceProvider>,
  );
  await screen.findByTestId("active-backend");
  let first: Promise<boolean> = Promise.resolve(false);
  await act(async () => {
    first = preference.setOrigin(customOrigin);
    expect(await preference.setOrigin("https://another.example.com")).toBe(
      false,
    );
  });
  expect(preference.origin).toBe(defaultOrigin);
  await act(async () => {
    release();
    expect(await first).toBe(true);
  });
  expect(preference.origin).toBe(customOrigin);
});

test("replaces the query client, cancels previous reads, and evicts private data when the backend changes", async () => {
  const clients: QueryClient[] = [];
  let aborted = false;
  function QueryProbe() {
    const client = useQueryClient();
    useEffect(() => {
      clients.push(client);
    }, [client]);
    return <Probe />;
  }
  render(
    <BackendPreferenceProvider
      storage={memoryStorage()}
      defaultOrigin={defaultOrigin}
    >
      <MobileQueryProvider>
        <QueryProbe />
      </MobileQueryProvider>
    </BackendPreferenceProvider>,
  );
  await waitFor(() => expect(clients.length).toBe(1));
  const oldClient = clients[0];
  if (!oldClient) throw new Error("missing query client");
  oldClient.setQueryData(["private", "account"], { balance: "123" });
  void oldClient
    .fetchQuery({
      queryKey: ["private", "pending"],
      queryFn: ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("aborted"));
          });
        }),
    })
    .catch(() => undefined);
  await act(async () => {
    expect(await preference.setOrigin(customOrigin)).toBe(true);
  });
  await waitFor(() => expect(clients.length).toBe(2));
  expect(clients[1]).not.toBe(oldClient);
  expect(clients[1]?.getQueryData(["private", "account"])).toBeUndefined();
  expect(oldClient.getQueryCache().getAll()).toHaveLength(0);
  expect(aborted).toBe(true);
});
