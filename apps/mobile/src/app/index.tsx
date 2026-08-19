import { Redirect } from "expo-router";
import type { JSX } from "react";

import { TRADE_ROUTE } from "../navigation/routes";

export default function LaunchScreen(): JSX.Element {
  return <Redirect href={TRADE_ROUTE} />;
}
