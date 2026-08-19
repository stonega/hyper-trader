import { describe, expect, test } from "bun:test";
import type { CandlestickGeometry } from "victory-native";

import {
  buildCandlestickPathGroups,
  type CandlestickPathBuilder,
} from "./candlestick-path-groups";

type Command =
  | { readonly kind: "move" | "line"; readonly x: number; readonly y: number }
  | { readonly kind: "rect"; readonly rect: CandlestickGeometry["body"] };

class RecordingBuilder
  implements
    CandlestickPathBuilder<readonly Command[], CandlestickGeometry["body"]>
{
  readonly commands: Command[] = [];

  moveTo(x: number, y: number): void {
    this.commands.push({ kind: "move", x, y });
  }

  lineTo(x: number, y: number): void {
    this.commands.push({ kind: "line", x, y });
  }

  addRect(rect: CandlestickGeometry["body"]): void {
    this.commands.push({ kind: "rect", rect });
  }

  detach(): readonly Command[] {
    return this.commands;
  }
}

function candle(
  status: CandlestickGeometry["status"],
  x: number,
  bodyHeight = 4,
): CandlestickGeometry {
  const open = status === "positive" ? 10 : status === "negative" ? 12 : 11;
  const close = status === "positive" ? 12 : status === "negative" ? 10 : 11;
  return {
    datumIndex: x,
    x,
    xValue: x,
    open,
    high: 13,
    low: 9,
    close,
    openY: 20,
    highY: 10,
    lowY: 30,
    closeY: 16,
    status,
    body: { x: x - 1, y: 16, width: 2, height: bodyHeight },
    wick: { x, y1: 10, y2: 30 },
  };
}

describe("candlestick path groups", () => {
  test("builds immutable body and wick paths grouped by candle status", () => {
    const paths = buildCandlestickPathGroups(
      [candle("positive", 2), candle("negative", 4), candle("neutral", 6)],
      {
        createBuilder: () => new RecordingBuilder(),
        createRect: (body) => body,
      },
    );

    expect(paths.map(({ status }) => status)).toEqual([
      "positive",
      "negative",
      "neutral",
    ]);
    expect(paths[0]?.wickPath).toEqual([
      { kind: "move", x: 2, y: 10 },
      { kind: "line", x: 2, y: 30 },
    ]);
    expect(paths[0]?.bodyPath).toEqual([
      {
        kind: "rect",
        rect: { x: 1, y: 16, width: 2, height: 4 },
      },
    ]);
    expect(paths[1]?.wickPath).toHaveLength(2);
    expect(paths[1]?.bodyPath).toHaveLength(1);
    expect(paths[2]?.wickPath).toHaveLength(2);
    expect(paths[2]?.bodyPath).toHaveLength(1);
  });

  test("keeps a valid wick while omitting a zero-area body", () => {
    const [positive] = buildCandlestickPathGroups([candle("positive", 2, 0)], {
      createBuilder: () => new RecordingBuilder(),
      createRect: (body) => body,
    });

    expect(positive?.wickPath).toHaveLength(2);
    expect(positive?.bodyPath).toEqual([]);
  });
});
