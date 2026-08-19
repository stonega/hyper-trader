import { describe, expect, test } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import { ScreenHeading } from "../components/screen-heading";

describe("native screen heading accessibility", () => {
  test("announces the exact network and account context independently of color", () => {
    render(
      <ScreenHeading
        accountLabel="fixture account"
        description="Review the current account before acting."
        network="testnet"
        title="Trade"
      />,
    );

    expect(screen.getByRole("header", { name: "Trade" })).toBeTruthy();
    expect(
      screen.getByLabelText("testnet network, fixture account"),
    ).toHaveTextContent("testnet · fixture account");
    expect(
      screen.getByText("Review the current account before acting."),
    ).toBeTruthy();
  });

  test("places a supplied account control on the heading row", () => {
    render(
      <ScreenHeading
        description="Find a market."
        network="testnet"
        rightAccessory={<Text>Wallet avatar</Text>}
        showContext={false}
        titleAccessory={<Text>BTC-USDC</Text>}
        title="Markets"
      />,
    );

    expect(screen.getByRole("header", { name: "Markets" })).toBeTruthy();
    expect(screen.getByText("BTC-USDC")).toBeTruthy();
    expect(screen.getByText("Wallet avatar")).toBeTruthy();
  });
});
