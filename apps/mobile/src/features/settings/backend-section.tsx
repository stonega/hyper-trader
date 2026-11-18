import { Button } from "heroui-native/button";
import { FieldError } from "heroui-native/field-error";
import { Input } from "heroui-native/input";
import { Label } from "heroui-native/label";
import { TextField } from "heroui-native/text-field";
import type { JSX } from "react";
import { useState } from "react";
import { Alert, View } from "react-native";

import { AppText as Text } from "../../components/app-text";
import { useReducedMotion } from "../../components/use-reduced-motion";
import { normalizeBackendOrigin } from "../../core/backend/preference";
import { useBackendPreference } from "../../core/backend/provider";
import { SettingsSection } from "./settings-section";

export function BackendSection({
  beforeApply,
}: {
  readonly beforeApply: () => boolean;
}): JSX.Element {
  const backend = useBackendPreference();
  const reducedMotion = useReducedMotion();
  const [draft, setDraft] = useState(backend.origin ?? "");
  const [error, setError] = useState<string | null>(null);

  const requestChange = (reset: boolean) => {
    let origin: string | null;
    try {
      origin = reset ? backend.defaultOrigin : normalizeBackendOrigin(draft);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Enter a valid HTTPS server URL.",
      );
      return;
    }
    Alert.alert(
      reset ? "Restore default backend?" : "Use this backend?",
      `${origin ?? "Unconfigured"}\n\nThis server will receive your portfolio account addresses. Market data will reload and open order drafts will be cleared.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: reset ? "Restore default" : "Use backend",
          onPress: () => {
            void backend
              .setOrigin(reset ? null : origin, beforeApply)
              .then((saved) => {
                if (!saved)
                  setError(
                    "Backend could not be changed. Your previous server remains selected.",
                  );
              });
          },
        },
      ],
    );
  };

  return (
    <SettingsSection
      title="Backend API"
      description="Server for market data and Portfolio."
    >
      <TextField
        isDisabled={backend.saving}
        isInvalid={error !== null}
        animation={reducedMotion ? "disable-all" : undefined}
      >
        <Label>Backend URL</Label>
        <Input
          accessibilityLabel="Backend URL"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="done"
          value={draft}
          placeholder="https://api.example.com"
          onChangeText={(value) => {
            setDraft(value);
            setError(null);
          }}
          onSubmitEditing={() => {
            if (!backend.saving && draft !== backend.origin)
              requestChange(false);
          }}
        />
        {error ? <FieldError>{error}</FieldError> : null}
      </TextField>
      {backend.status === "error" && error === null ? (
        <Text accessibilityRole="alert" className="text-sm text-warning">
          The backend preference could not be loaded or saved. Try saving again.
        </Text>
      ) : null}
      <View className="flex-row flex-wrap gap-2">
        <Button
          animation={reducedMotion ? "disable-all" : undefined}
          className="min-h-12 flex-1"
          isDisabled={backend.saving || draft === backend.origin}
          onPress={() => requestChange(false)}
          variant="secondary"
        >
          <Button.Label>
            {backend.saving ? "Saving…" : "Save backend"}
          </Button.Label>
        </Button>
        {backend.override !== null ? (
          <Button
            animation={reducedMotion ? "disable-all" : undefined}
            className="min-h-12 flex-1"
            isDisabled={backend.saving}
            onPress={() => requestChange(true)}
            variant="outline"
          >
            <Button.Label>Use default</Button.Label>
          </Button>
        ) : null}
      </View>
    </SettingsSection>
  );
}
