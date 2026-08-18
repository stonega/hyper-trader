import {
  AuthenticationType,
  supportedAuthenticationTypesAsync,
} from "expo-local-authentication";
import { useEffect, useState } from "react";

import { createExpoDeviceAuthenticationPort } from "../../platform/security/device-auth";

export interface DeviceAuthStatus {
  readonly status: "checking" | "available" | "unavailable" | "error";
  readonly strong: boolean;
  readonly methods: readonly string[];
  readonly message: string;
}

const INITIAL_DEVICE_AUTH_STATUS: DeviceAuthStatus = {
  status: "checking",
  strong: false,
  methods: [],
  message: "Checking device authentication…",
};

function methodLabel(value: AuthenticationType): string {
  switch (value) {
    case AuthenticationType.FINGERPRINT:
      return "Fingerprint";
    case AuthenticationType.FACIAL_RECOGNITION:
      return "Face recognition";
    case AuthenticationType.IRIS:
      return "Iris recognition";
  }
}

function unavailableMessage(
  reason: "no_hardware" | "not_enrolled" | "not_strong",
) {
  switch (reason) {
    case "no_hardware":
      return "Strong device authentication hardware is unavailable. Trading unlock remains unavailable.";
    case "not_enrolled":
      return "Strong device authentication is not enrolled. Trading unlock remains unavailable.";
    case "not_strong":
      return "Only a weaker device authentication level is enrolled; signing stays locked.";
  }
}

export function useDeviceAuthStatus(): DeviceAuthStatus {
  const [state, setState] = useState<DeviceAuthStatus>(
    INITIAL_DEVICE_AUTH_STATUS,
  );
  useEffect(() => {
    let active = true;
    void Promise.all([
      createExpoDeviceAuthenticationPort().then((port) => port.assess()),
      supportedAuthenticationTypesAsync(),
    ])
      .then(([assessment, methods]) => {
        if (!active) return;
        if (assessment.status === "unavailable") {
          setState({
            status: "unavailable",
            strong: false,
            methods: methods.map(methodLabel),
            message: unavailableMessage(assessment.reason),
          });
          return;
        }
        setState({
          status: "available",
          strong: true,
          methods: methods.map(methodLabel),
          message: "Strong device authentication is enrolled.",
        });
      })
      .catch(() => {
        if (!active) return;
        setState({
          status: "error",
          strong: false,
          methods: [],
          message:
            "Device authentication capability could not be verified. Signing stays locked.",
        });
      });
    return () => {
      active = false;
    };
  }, []);
  return state;
}
