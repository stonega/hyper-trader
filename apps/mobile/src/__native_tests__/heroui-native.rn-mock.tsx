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
  readonly accessibilityRole?:
    | "adjustable"
    | "alert"
    | "button"
    | "header"
    | "radio"
    | "text";
  readonly isDisabled?: boolean;
  readonly onPress?: () => void;
  readonly testID?: string;
}>;

interface DialogContextValue {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
}

const DialogContext = createContext<DialogContextValue | null>(null);

interface SearchFieldContextValue {
  readonly onChange: (value: string) => void;
  readonly value: string;
}

const SearchFieldContext = createContext<SearchFieldContextValue | null>(null);

function Container({ children, testID }: CommonProps): ReactNode {
  return <View testID={testID}>{children}</View>;
}

function BottomSheetContent({
  accessibilityLabel,
  children,
  enableDynamicSizing,
  snapPoints,
  testID,
}: CommonProps & {
  readonly enableDynamicSizing?: boolean;
  readonly snapPoints?: readonly (number | string)[];
}): ReactNode {
  const props = {
    accessibilityLabel,
    enableDynamicSizing,
    snapPoints,
    testID,
  } as unknown as ComponentProps<typeof View>;
  return <View {...props}>{children}</View>;
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

function ChipRoot({ children, ...props }: CommonProps): ReactNode {
  return <Text {...props}>{children}</Text>;
}

export const Chip = Object.assign(ChipRoot, {
  Label: Copy,
});

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
  Content: BottomSheetContent,
  Close: DialogClose,
  Title: Copy,
  Description: Copy,
});

export function Skeleton({ accessibilityLabel }: CommonProps): ReactNode {
  return <View accessibilityLabel={accessibilityLabel} />;
}

export function Spinner({ accessibilityLabel }: CommonProps): ReactNode {
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="progressbar"
    />
  );
}

function SliderRoot({
  accessibilityLabel,
  children,
  isDisabled,
  maxValue,
  minValue,
  onChange,
  step,
  value,
}: CommonProps & {
  readonly maxValue?: number;
  readonly minValue?: number;
  readonly onChange?: (value: number | number[]) => void;
  readonly step?: number;
  readonly value?: number | number[];
}): ReactNode {
  const props = {
    accessibilityLabel,
    accessibilityRole: "adjustable",
    accessibilityState: { disabled: isDisabled },
    maxValue,
    minValue,
    onChange,
    step,
    value,
  } as unknown as ComponentProps<typeof View>;
  return <View {...props}>{children}</View>;
}

export const Slider = Object.assign(SliderRoot, {
  Track: Container,
  Fill: Container,
  Thumb: Container,
  Output: Container,
});

export const TextField = Container;
export const Description = Copy;
export const FieldError = Copy;
export const Label = Copy;

interface RadioGroupContextValue {
  readonly onValueChange: (value: string) => void;
  readonly value: string;
}

const RadioGroupContext = createContext<RadioGroupContextValue | null>(null);

function RadioGroupRoot({
  children,
  onValueChange,
  value,
}: PropsWithChildren<RadioGroupContextValue>): ReactNode {
  return (
    <RadioGroupContext.Provider value={{ onValueChange, value }}>
      <View>{children}</View>
    </RadioGroupContext.Provider>
  );
}

function RadioGroupItem({
  children,
  isDisabled,
  value,
  ...props
}: CommonProps & { readonly value: string }): ReactNode {
  const group = useContext(RadioGroupContext);
  if (!group) {
    throw new Error("RadioGroup.Item must be rendered within RadioGroup.");
  }
  const isSelected = group.value === value;

  return (
    <Pressable
      {...props}
      accessibilityRole="radio"
      accessibilityState={{ checked: isSelected, disabled: !!isDisabled }}
      disabled={isDisabled}
      onPress={() => group.onValueChange(value)}
    >
      {children}
    </Pressable>
  );
}

export const RadioGroup = Object.assign(RadioGroupRoot, {
  Item: RadioGroupItem,
});

export function Radio(): ReactNode {
  return null;
}

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

function SearchFieldRoot({
  children,
  onChange,
  value,
}: PropsWithChildren<SearchFieldContextValue>): ReactNode {
  return (
    <SearchFieldContext.Provider value={{ onChange, value }}>
      <View>{children}</View>
    </SearchFieldContext.Provider>
  );
}

function SearchFieldInput(props: ComponentProps<typeof TextInput>): ReactNode {
  const searchField = useContext(SearchFieldContext);
  return (
    <TextInput
      {...props}
      onChangeText={searchField?.onChange}
      value={searchField?.value}
    />
  );
}

function SearchFieldSearchIcon({
  iconProps,
}: {
  readonly iconProps?: { readonly color?: string; readonly size?: number };
}): ReactNode {
  return (
    <Text
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ color: iconProps?.color }}
      testID="search-field-search-icon"
    >
      search
    </Text>
  );
}

export const SearchField = Object.assign(SearchFieldRoot, {
  Group: Container,
  Input: SearchFieldInput,
  SearchIcon: SearchFieldSearchIcon,
});

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
