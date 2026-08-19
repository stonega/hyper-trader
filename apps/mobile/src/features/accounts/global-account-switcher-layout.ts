const DIALOG_EDGE_GUTTER = 20;

export interface AccountSwitcherDialogLayout {
  readonly maxHeight: number;
  readonly paddingBottom: number;
  readonly paddingLeft: number;
  readonly paddingRight: number;
  readonly paddingTop: number;
}

function normalizedInset(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function accountSwitcherDialogLayout({
  height,
  insetBottom,
  insetLeft,
  insetRight,
  insetTop,
}: {
  readonly height: number;
  readonly insetBottom: number;
  readonly insetLeft: number;
  readonly insetRight: number;
  readonly insetTop: number;
}): AccountSwitcherDialogLayout {
  const paddingBottom = Math.max(
    normalizedInset(insetBottom),
    DIALOG_EDGE_GUTTER,
  );
  const paddingLeft = Math.max(normalizedInset(insetLeft), DIALOG_EDGE_GUTTER);
  const paddingRight = Math.max(
    normalizedInset(insetRight),
    DIALOG_EDGE_GUTTER,
  );
  const paddingTop = Math.max(normalizedInset(insetTop), DIALOG_EDGE_GUTTER);
  const viewportHeight = Number.isFinite(height) && height > 0 ? height : 0;

  return {
    maxHeight: Math.max(0, viewportHeight - paddingTop - paddingBottom),
    paddingBottom,
    paddingLeft,
    paddingRight,
    paddingTop,
  };
}
