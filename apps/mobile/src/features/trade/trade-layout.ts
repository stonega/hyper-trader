const SPLIT_WORKSPACE_MIN_WIDTH = 360;
const SPLIT_WORKSPACE_MAX_FONT_SCALE = 1.25;

export function shouldSplitTradeWorkspace({
  width,
  fontScale,
}: {
  readonly width: number;
  readonly fontScale: number;
}): boolean {
  return (
    Number.isFinite(width) &&
    Number.isFinite(fontScale) &&
    width >= SPLIT_WORKSPACE_MIN_WIDTH &&
    fontScale <= SPLIT_WORKSPACE_MAX_FONT_SCALE
  );
}
