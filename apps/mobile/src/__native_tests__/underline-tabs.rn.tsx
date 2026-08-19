import { describe, expect, jest, test } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { useState } from "react";

import { UnderlineTabs } from "../components/ui/underline-tabs";

jest.mock("../components/use-reduced-motion", () => ({
  useReducedMotion: () => false,
}));

const OPTIONS = [
  { label: "Book", value: "book" },
  { label: "Trades", value: "trades" },
] as const;

function TabsHarness(): React.JSX.Element {
  const [value, setValue] = useState<"book" | "trades">("book");
  return (
    <UnderlineTabs
      accessibilityLabel="Market activity view"
      onValueChange={setValue}
      options={OPTIONS}
      value={value}
    />
  );
}

describe("underline tabs", () => {
  test("exposes tab semantics and updates the selected tab", () => {
    render(<TabsHarness />);

    expect(
      screen.getByRole("tab", { name: "Book" }).props.accessibilityState,
    ).toEqual({ disabled: false, selected: true });
    expect(
      screen.getByRole("tab", { name: "Trades" }).props.accessibilityState,
    ).toEqual({ disabled: false, selected: false });

    fireEvent.press(screen.getByRole("tab", { name: "Trades" }));

    expect(
      screen.getByRole("tab", { name: "Book" }).props.accessibilityState,
    ).toEqual({ disabled: false, selected: false });
    expect(
      screen.getByRole("tab", { name: "Trades" }).props.accessibilityState,
    ).toEqual({ disabled: false, selected: true });
  });
});
