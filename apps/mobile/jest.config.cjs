module.exports = {
  preset: "jest-expo",
  clearMocks: true,
  watchman: false,
  setupFilesAfterEnv: ["<rootDir>/jest.setup.cjs"],
  testMatch: ["<rootDir>/src/__native_tests__/**/*.rn.tsx"],
  moduleNameMapper: {
    "^heroui-native/.+$":
      "<rootDir>/src/__native_tests__/heroui-native.rn-mock.tsx",
    "\\.css$": "<rootDir>/src/__native_tests__/style.rn-mock.cjs",
  },
};
