import { forwardRef } from "react";
import {
  Text as ReactNativeText,
  type Text as ReactNativeTextInstance,
  type TextProps,
} from "react-native";

import { appTextClassName } from "./app-text-class-name";

export const AppText = forwardRef<ReactNativeTextInstance, TextProps>(
  function AppText({ className, ...props }, ref) {
    return (
      <ReactNativeText
        {...props}
        className={appTextClassName(className)}
        ref={ref}
      />
    );
  },
);
