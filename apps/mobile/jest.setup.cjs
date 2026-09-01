jest.mock("react-native-reanimated", () => {
  const React = require("react");
  const { View } = require("react-native");
  const transition = {};
  transition.duration = () => transition;
  transition.reduceMotion = () => transition;
  return {
    __esModule: true,
    default: { View },
    Easing: {
      cubic: (value) => value * value * value,
      out: (easing) => easing,
    },
    FadeIn: transition,
    FadeOut: transition,
    ReduceMotion: { System: "system" },
    runOnJS: (callback) => callback,
    useAnimatedStyle: (updater) => updater(),
    useSharedValue: (value) => React.useRef({ value }).current,
    withTiming: jest.fn((value) => value),
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

jest.mock("@gorhom/bottom-sheet", () => {
  const { ScrollView } = require("react-native");
  return { BottomSheetScrollView: ScrollView };
});

jest.mock("uniwind", () => ({
  useUniwind: () => ({ theme: "light", hasAdaptiveThemes: true }),
}));
