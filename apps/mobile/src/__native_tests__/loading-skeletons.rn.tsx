import { expect, jest, test } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";

import { LoadingSkeletons } from "../components/ui/loading-skeletons";

jest.mock("../components/use-reduced-motion", () => ({
  useReducedMotion: () => false,
}));

test("loading skeletons do not intercept navigation touches", () => {
  render(
    <LoadingSkeletons
      accessibilityLabel="Loading screen data"
      items={["first", "second"]}
    />,
  );

  expect(screen.getByLabelText("Loading screen data").props.pointerEvents).toBe(
    "none",
  );
});
