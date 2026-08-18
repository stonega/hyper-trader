jest.mock("react-native-reanimated", () => {
  const { View } = require("react-native");
  const transition = {};
  transition.duration = () => transition;
  transition.reduceMotion = () => transition;
  return {
    __esModule: true,
    default: { View },
    FadeIn: transition,
    FadeOut: transition,
    ReduceMotion: { System: "system" },
  };
});

jest.mock("react-native-safe-area-context", () => ({
  SafeAreaProvider: ({ children }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock("expo-gl", () => {
  const React = require("react");
  const { View } = require("react-native");
  return {
    GLView: ({ onContextCreate: _onContextCreate, ...props }) =>
      React.createElement(View, props),
  };
});

jest.mock("uniwind", () => ({
  useUniwind: () => ({ theme: "light", hasAdaptiveThemes: true }),
}));
