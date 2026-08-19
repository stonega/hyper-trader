import type { CandlestickGeometry, CandlestickStatus } from "victory-native";

export interface CandlestickPathBuilder<Path, Rect> {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  addRect(rect: Rect): void;
  detach(): Path;
}

export interface CandlestickPathFactory<Path, Rect> {
  createBuilder(): CandlestickPathBuilder<Path, Rect>;
  createRect(body: CandlestickGeometry["body"]): Rect;
}

export interface CandlestickPathGroup<Path> {
  readonly status: CandlestickStatus;
  readonly bodyPath: Path;
  readonly wickPath: Path;
}

const CANDLE_STATUSES = ["positive", "negative", "neutral"] as const;

export function buildCandlestickPathGroups<Path, Rect>(
  geometry: readonly CandlestickGeometry[],
  factory: CandlestickPathFactory<Path, Rect>,
): CandlestickPathGroup<Path>[] {
  return CANDLE_STATUSES.map((status) => {
    const bodyBuilder = factory.createBuilder();
    const wickBuilder = factory.createBuilder();

    for (const candle of geometry) {
      if (candle.status !== status) continue;

      wickBuilder.moveTo(candle.wick.x, candle.wick.y1);
      wickBuilder.lineTo(candle.wick.x, candle.wick.y2);

      if (candle.body.width > 0 && candle.body.height > 0) {
        bodyBuilder.addRect(factory.createRect(candle.body));
      }
    }

    return {
      status,
      bodyPath: bodyBuilder.detach(),
      wickPath: wickBuilder.detach(),
    };
  });
}
