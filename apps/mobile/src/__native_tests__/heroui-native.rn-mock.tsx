import {
  type ComponentProps,
  createContext,
  type PropsWithChildren,
  type ReactNode,
  useContext,
} from "react";
import { Pressable, Text, TextInput, View } from "react-native";

type CommonProps = PropsWithChildren<{
  readonly accessibilityHint?: string;
  readonly accessibilityLabel?: string;
  readonly accessibilityRole?: "alert" | "button" | "header" | "text";
  readonly isDisabled?: boolean;
  readonly onPress?: () => void;
  readonly testID?: string;
}>;

interface DialogContextValue {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
}

const DialogContext = createContext<DialogContextValue | null>(null);

function Container({ children, testID }: CommonProps): ReactNode {
  return <View testID={testID}>{children}</View>;
}

function Copy({
  accessibilityHint,
  accessibilityLabel,
  accessibilityRole,
  children,
}: CommonProps): ReactNode {
  return (
    <Text
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
    >
      {children}
    </Text>
  );
}

function ButtonRoot({
  children,
  isDisabled,
  onPress,
  ...props
}: CommonProps): ReactNode {
  return (
    <Pressable
      {...props}
      accessibilityRole="button"
      disabled={isDisabled}
      onPress={onPress}
    >
      {typeof children === "string" || typeof children === "number" ? (
        <Text>{children}</Text>
      ) : (
        children
      )}
    </Pressable>
  );
}

export const Button = Object.assign(ButtonRoot, {
  Label: Copy,
});

export function Chip({ children, ...props }: CommonProps): ReactNode {
  return <Text {...props}>{children}</Text>;
}

export const Card = Object.assign(Container, {
  Header: Container,
  Body: Container,
  Footer: Container,
  Title: Copy,
  Description: Copy,
});

function DialogClose({
  children,
  isDisabled,
  onPress,
  testID,
}: CommonProps): ReactNode {
  const dialog = useContext(DialogContext);
  return (
    <Pressable
      accessibilityLabel="Close"
      accessibilityRole="button"
      disabled={isDisabled}
      onPress={() => {
        onPress?.();
        dialog?.onOpenChange(false);
      }}
      testID={testID}
    >
      {children}
    </Pressable>
  );
}

function DialogRoot({
  children,
  isOpen = false,
  onOpenChange = () => undefined,
}: PropsWithChildren<{
  readonly isOpen?: boolean;
  readonly onOpenChange?: (isOpen: boolean) => void;
}>): ReactNode {
  return (
    <DialogContext.Provider value={{ isOpen, onOpenChange }}>
      <View>{children}</View>
    </DialogContext.Provider>
  );
}

function DialogPortal({ children, testID }: CommonProps): ReactNode {
  const dialog = useContext(DialogContext);
  return dialog?.isOpen ? <View testID={testID}>{children}</View> : null;
}

export const Dialog = Object.assign(DialogRoot, {
  Trigger: Container,
  Portal: DialogPortal,
  Overlay: Container,
  Content: Container,
  Close: DialogClose,
  Title: Copy,
  Description: Copy,
});

export const BottomSheet = Object.assign(DialogRoot, {
  Trigger: Container,
  Portal: DialogPortal,
  Overlay: Container,
  Content: Container,
  Close: DialogClose,
  Title: Copy,
  Description: Copy,
});

export function Skeleton({ accessibilityLabel }: CommonProps): ReactNode {
  return <View accessibilityLabel={accessibilityLabel} />;
}

export const TextField = Container;
export const Description = Copy;
export const FieldError = Copy;
export const Label = Copy;

interface TabsContextValue {
  readonly onValueChange: (value: string) => void;
  readonly value: string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function TabsRoot({
  children,
  onValueChange,
  value,
}: PropsWithChildren<TabsContextValue>): ReactNode {
  return (
    <TabsContext.Provider value={{ onValueChange, value }}>
      <View>{children}</View>
    </TabsContext.Provider>
  );
}

function TabsList({ children, ...props }: CommonProps): ReactNode {
  return (
    <View {...props} accessibilityRole="tablist">
      {children}
    </View>
  );
}

interface TabsTriggerRenderProps {
  readonly isDisabled: boolean;
  readonly isSelected: boolean;
  readonly value: string;
}

function TabsTrigger({
  children,
  isDisabled,
  value,
  ...props
}: {
  readonly accessibilityLabel?: string;
  readonly children?:
    | ReactNode
    | ((props: TabsTriggerRenderProps) => ReactNode);
  readonly isDisabled?: boolean;
  readonly value: string;
}): ReactNode {
  const tabs = useContext(TabsContext);
  if (!tabs) throw new Error("Tabs.Trigger must be rendered within Tabs.");
  const isSelected = tabs.value === value;
  const content =
    typeof children === "function"
      ? children({ isDisabled: !!isDisabled, isSelected, value })
      : children;

  return (
    <Pressable
      {...props}
      accessibilityRole="tab"
      accessibilityState={{ disabled: !!isDisabled, selected: isSelected }}
      disabled={isDisabled}
      onPress={() => tabs.onValueChange(value)}
    >
      {content}
    </Pressable>
  );
}

export const Tabs = Object.assign(TabsRoot, {
  List: TabsList,
  Indicator: () => null,
  Trigger: TabsTrigger,
  Label: Copy,
});

export function Input(props: ComponentProps<typeof TextInput>): ReactNode {
  return <TextInput {...props} />;
}

export const InputGroup = Object.assign(Container, {
  Input,
  Prefix: Container,
  Suffix: Container,
});

const THEME_COLORS: Record<string, string> = {
  accent: "#009b86",
  background: "#f7f7f7",
  foreground: "#29292d",
  surface: "#ffffff",
};

export function useThemeColor(
  color: string | readonly string[],
): string | string[] {
  if (Array.isArray(color)) {
    return color.map((name) => THEME_COLORS[name] ?? "#000000");
  }
  return THEME_COLORS[color as string] ?? "#000000";
}
