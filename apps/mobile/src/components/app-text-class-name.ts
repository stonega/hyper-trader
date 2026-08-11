const FONT_CLASS =
  /(?:^|\s)font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black|mono|sans)(?:\s|$)/;

export function appTextClassName(className?: string): string {
  if (className && FONT_CLASS.test(className)) return className;
  return className ? `font-normal ${className}` : "font-normal";
}
