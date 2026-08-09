import { describe, expect, test } from "bun:test";

import {
  buildRedactedDiagnosticExport,
  diagnosticExportJson,
  type RedactedDiagnosticExport,
} from "./diagnostic-export";

describe("diagnostic export", () => {
  test("allowlists safe fields and structurally excludes secrets and signed material", () => {
    const bundle = buildRedactedDiagnosticExport({
      generatedAtMs: 1_700_000_000_000,
      appVersion: "0.1.0",
      buildVersion: "1",
      network: "testnet",
      account: {
        masterAccount: "0x1111111111111111111111111111111111111111",
        targetAccount: "0x2222222222222222222222222222222222222222",
        agentAddress: "0x3333333333333333333333333333333333333333",
        generation: 2,
        registrationState: "active",
      },
      session: { status: "locked", reason: "manual" },
      actions: [
        {
          correlationId: "act_0123456789abcdef0123456789abcdef",
          actionType: "market_order",
          state: "unresolved",
          intentDigest:
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          observedAtMs: 1_700_000_000_001,
          signature: "0xshould-not-exist",
          signedAction: { action: "forbidden" },
        },
      ],
      notification: {
        tokenState: "registered",
        tokenSuffix: "abcd1234",
        pushToken: "ExponentPushToken[forbidden]",
      },
      privateKey: "forbidden",
      signedPayload: { forbidden: true },
    });
    const json = diagnosticExportJson(bundle);

    expect(bundle.account).toEqual({
      masterSuffix: "111111",
      targetSuffix: "222222",
      agentSuffix: "333333",
      generation: 2,
      registrationState: "active",
    });
    expect(bundle.actions[0]).toEqual({
      correlationId: "act_0123456789abcdef0123456789abcdef",
      actionType: "market_order",
      state: "unresolved",
      intentDigest:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      observedAtMs: 1_700_000_000_001,
    });
    expect(json).not.toMatch(
      /privateKey|private_key|signature|signedAction|signedPayload|pushToken|ExponentPushToken|1111111111111111111111111111111111111111/,
    );
  });

  test("rejects malformed timestamps, identifiers, and token suffixes", () => {
    expect(() =>
      buildRedactedDiagnosticExport({ generatedAtMs: Number.NaN }),
    ).toThrow("generatedAtMs");
    expect(() =>
      buildRedactedDiagnosticExport({
        generatedAtMs: 1,
        notification: { tokenState: "registered", tokenSuffix: "token-full" },
      }),
    ).toThrow("token suffix");
  });

  test("rejects unknown or secret-looking values even in allowlisted fields", () => {
    const base = { generatedAtMs: 1_700_000_000_000 };
    const action = {
      correlationId: "act_0123456789abcdef0123456789abcdef",
      actionType: "market_order",
      state: "unresolved",
      intentDigest:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      observedAtMs: 1,
    };
    expect(() =>
      buildRedactedDiagnosticExport({
        ...base,
        actions: [
          {
            ...action,
            correlationId: "private-key-material",
          },
        ],
      }),
    ).toThrow("action summary");
    expect(() =>
      buildRedactedDiagnosticExport({
        ...base,
        actions: [{ ...action, actionType: "private_key_export" }],
      }),
    ).toThrow("action type");
    expect(() =>
      buildRedactedDiagnosticExport({
        ...base,
        actions: [{ ...action, state: "signature_captured" }],
      }),
    ).toThrow("action state");
    expect(() =>
      buildRedactedDiagnosticExport({
        ...base,
        session: { status: "locked", reason: "seed phrase copied" },
      }),
    ).toThrow("session reason");
    expect(() =>
      buildRedactedDiagnosticExport({
        ...base,
        account: {
          masterAccount: "0x1111111111111111111111111111111111111111",
          targetAccount: "0x2222222222222222222222222222222222222222",
          agentAddress: null,
          generation: null,
          registrationState: "private key active",
        },
      }),
    ).toThrow("registration state");
    expect(() =>
      buildRedactedDiagnosticExport({
        ...base,
        notification: {
          tokenState: "push token secret",
          tokenSuffix: null,
        },
      }),
    ).toThrow("notification state");
  });

  test("serialization reconstructs the allowlist after bundle mutation", () => {
    const bundle = buildRedactedDiagnosticExport({
      generatedAtMs: 1_700_000_000_000,
      actions: [
        {
          correlationId: "act_0123456789abcdef0123456789abcdef",
          actionType: "market_order",
          state: "unresolved",
          intentDigest:
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          observedAtMs: 1,
        },
      ],
      notification: {
        tokenState: "registered",
        tokenSuffix: "abcd1234",
      },
    }) as RedactedDiagnosticExport & Record<string, unknown>;
    bundle.privateKey = "forbidden";
    Object.assign(bundle.actions[0] as object, {
      signature: "forbidden",
      signedAction: { privateKey: "forbidden" },
    });
    Object.assign(bundle.notification as object, {
      pushToken: "ExponentPushToken[forbidden]",
      signedPayload: "forbidden",
    });

    expect(diagnosticExportJson(bundle)).not.toMatch(
      /privateKey|signature|signedAction|pushToken|ExponentPushToken|signedPayload|forbidden/,
    );
  });
});
