import { describe, expect, test } from "bun:test";

import { parseAuthoritativeOrderStatus } from "./evidence";

const expected = {
  assetId: 0,
  oid: null,
  cloid: "0x00000000000000000000000000000001",
};

describe("authoritative order-status evidence", () => {
  test("parses exact documented identity and recognized lifecycle", () => {
    expect(
      parseAuthoritativeOrderStatus(
        {
          status: "order",
          order: {
            order: {
              oid: 42,
              cloid: "0x00000000000000000000000000000001",
            },
            status: "filled",
            statusTimestamp: 1_000,
          },
        },
        expected,
      ),
    ).toEqual({
      kind: "order",
      assetId: 0,
      oid: 42,
      cloid: expected.cloid,
      status: "filled",
    });
  });

  test("keeps unknown status vocabulary and wrong identities malformed", () => {
    expect(
      parseAuthoritativeOrderStatus(
        {
          status: "order",
          order: {
            order: { oid: 42, cloid: expected.cloid },
            status: "futureAccepted",
          },
        },
        expected,
      ),
    ).toEqual({ kind: "malformed" });
    expect(
      parseAuthoritativeOrderStatus(
        {
          status: "order",
          order: {
            order: {
              oid: 42,
              cloid: "0x00000000000000000000000000000002",
            },
            status: "open",
          },
        },
        expected,
      ),
    ).toEqual({ kind: "malformed" });
    expect(
      parseAuthoritativeOrderStatus(
        { status: "unknownOid", order: { forged: true } },
        expected,
      ),
    ).toEqual({ kind: "malformed" });
  });

  test.each(["liquidatedCanceled", "scheduledCancel"])(
    "recognizes documented terminal status %s",
    (status) => {
      expect(
        parseAuthoritativeOrderStatus(
          {
            status: "order",
            order: {
              order: { oid: 42, cloid: expected.cloid },
              status,
              statusTimestamp: 1_000,
            },
          },
          expected,
        ),
      ).toMatchObject({ kind: "order", status: "canceled" });
    },
  );
});
