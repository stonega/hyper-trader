import type { ComponentProps, JSX } from "react";
import { KeyboardAvoidingView, Platform } from "react-native";

export function KeyboardAwareView({
  children,
  ...props
}: Omit<ComponentProps<typeof KeyboardAvoidingView>, "behavior">): JSX.Element {
  return (
    <KeyboardAvoidingView
      {...props}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {children}
    </KeyboardAvoidingView>
  );
}
