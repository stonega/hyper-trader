import { describe, expect, test } from "bun:test";

import { parseWalletReturn } from "./callback";

describe("wallet return parser", () => {
  test("parses only the exact reviewed callback shape", () => {
    expect(
      parseWalletReturn(
        "hypertrader://wallet-return?attempt=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&session=session-1",
      ),
    ).toEqual({
      attemptId:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      connectorSessionId: "session-1",
    });
  });

  test("rejects alternate schemes, duplicate keys, and malformed identifiers", () => {
    expect(
      parseWalletReturn(
        "https://evil.invalid/wallet-return?attempt=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&session=session-1",
      ),
    ).toBeNull();
    expect(
      parseWalletReturn(
        "hypertrader://wallet-return?attempt=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&attempt=0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb&session=session-1",
      ),
    ).toBeNull();
    expect(
      parseWalletReturn(
        "hypertrader://wallet-return?attempt=short&session=session-1",
      ),
    ).toBeNull();
  });
});
