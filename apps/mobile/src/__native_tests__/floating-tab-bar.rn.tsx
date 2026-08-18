import { expect, jest, test } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Text } from "react-native";

import {
  FloatingTabBar,
  floatingTabBarInset,
} from "../components/navigation/floating-tab-bar";

jest.mock("@react-native-masked-view/masked-view", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { View } =
    jest.requireActual<typeof import("react-native")>("react-native");
  return {
    __esModule: true,
    default: ({ children }: { readonly children?: ReactNode }) =>
      React.createElement(View, null, children),
  };
});

jest.mock("expo-blur", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { View } =
    jest.requireActual<typeof import("react-native")>("react-native");
  return {
    BlurView: ({ children }: { readonly children?: ReactNode }) =>
      React.createElement(View, null, children),
  };
});

jest.mock("expo-linear-gradient", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { View } =
    jest.requireActual<typeof import("react-native")>("react-native");
  return {
    LinearGradient: () => React.createElement(View),
  };
});

const ROUTES = ["markets", "trade", "portfolio", "settings"] as const;

test("floating tab bar preserves route events, labels, and safe-area height", () => {
  const emit = jest.fn((event: { readonly type: string }) => ({
    ...event,
    defaultPrevented: false,
  }));
  const navigate = jest.fn();
  const routes = ROUTES.map((name) => ({ key: `${name}-key`, name }));
  const descriptors = Object.fromEntries(
    routes.map((route) => [
      route.key,
      {
        options: {
          tabBarAccessibilityLabel: `${route.name} tab`,
          tabBarButtonTestID: `tab-${route.name}`,
          tabBarIcon: ({ focused }: { readonly focused: boolean }) => (
            <Text>{focused ? "selected" : "idle"}</Text>
          ),
          title: route.name[0]?.toUpperCase() + route.name.slice(1),
        },
      },
    ]),
  );

  render(
    <FloatingTabBar
      descriptors={descriptors as never}
      insets={{ bottom: 34, left: 0, right: 0, top: 0 }}
      navigation={{ emit, navigate } as never}
      state={{ index: 1, routes } as never}
    />,
  );

  expect(floatingTabBarInset(34)).toBe(76);
  expect(screen.getByTestId("floating-tab-bar-blur")).toBeTruthy();
  expect(screen.getByTestId("tab-trade").props.accessibilityState).toEqual({
    selected: true,
  });

  fireEvent.press(screen.getByTestId("tab-markets"));
  expect(emit).toHaveBeenCalledWith({
    canPreventDefault: true,
    target: "markets-key",
    type: "tabPress",
  });
  expect(navigate).toHaveBeenCalledWith("markets", undefined);

  fireEvent.press(screen.getByTestId("tab-trade"));
  expect(navigate).toHaveBeenCalledTimes(1);

  fireEvent(screen.getByTestId("tab-settings"), "longPress");
  expect(emit).toHaveBeenCalledWith({
    target: "settings-key",
    type: "tabLongPress",
  });
});
