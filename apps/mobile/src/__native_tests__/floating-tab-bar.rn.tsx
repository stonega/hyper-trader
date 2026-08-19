import { expect, jest, test } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Text } from "react-native";
import { withTiming } from "react-native-reanimated";

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

jest.mock("../components/use-reduced-motion", () => ({
  useReducedMotion: () => false,
}));

const ROUTES = ["markets", "trade", "portfolio", "settings"] as const;

test("floating tab bar overlays the full-height scene without a backdrop", () => {
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

  const tabBar = (index: number) => (
    <FloatingTabBar
      descriptors={descriptors as never}
      insets={{ bottom: 34, left: 0, right: 0, top: 0 }}
      navigation={{ emit, navigate } as never}
      state={{ index, routes } as never}
    />
  );
  const { rerender } = render(tabBar(1));

  expect(floatingTabBarInset(34)).toBe(90);
  expect(screen.getByTestId("floating-tab-bar-capsule")).toHaveStyle({
    alignSelf: "center",
    bottom: 32,
    width: "auto",
  });
  expect(screen.getByTestId("floating-tab-bar")).toHaveStyle({
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
  });
  expect(screen.queryByTestId("floating-tab-bar-blur")).toBeNull();
  expect(screen.getByTestId("floating-tab-selection")).toBeTruthy();
  expect(screen.getByTestId("tab-trade").props.accessibilityState).toEqual({
    selected: true,
  });
  expect(screen.getByTestId("tab-trade")).toHaveStyle({
    flexGrow: 0,
    minWidth: 48,
    paddingHorizontal: 20,
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

  fireEvent(screen.getByTestId("tab-trade"), "layout", {
    nativeEvent: { layout: { height: 58, width: 80, x: 80, y: 0 } },
  });
  fireEvent(screen.getByTestId("tab-portfolio"), "layout", {
    nativeEvent: { layout: { height: 58, width: 96, x: 160, y: 0 } },
  });
  rerender(tabBar(2));

  expect(jest.mocked(withTiming)).toHaveBeenCalledWith(
    164,
    expect.objectContaining({ duration: 220, reduceMotion: "system" }),
  );
  expect(jest.mocked(withTiming)).toHaveBeenCalledWith(
    88,
    expect.objectContaining({ duration: 220, reduceMotion: "system" }),
  );
});
