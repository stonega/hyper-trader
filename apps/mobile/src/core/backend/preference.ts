export const BACKEND_PREFERENCE_KEY = "@hyper-trader/backend-origin/v1";

export function normalizeBackendOrigin(value: string): string {
  const trimmed = value.trim();
  const invalid = () =>
    new TypeError(
      "Enter an HTTPS server URL without a path, query, or login details.",
    );
  if (
    trimmed.length === 0 ||
    trimmed.length > 2048 ||
    !/^https:\/\/[^/]/i.test(trimmed) ||
    /[\s\\?#@]/u.test(trimmed) ||
    Array.from(trimmed).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) {
    throw invalid();
  }
  const pathStart = trimmed.indexOf("/", "https://".length);
  if (pathStart !== -1 && trimmed.slice(pathStart) !== "/") throw invalid();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw invalid();
  }
  if (
    url.protocol !== "https:" ||
    url.hostname === "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw invalid();
  }
  return url.origin;
}

export function parseBackendPreference(value: string | null): string | null {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      Object.keys(parsed).length !== 2 ||
      !("version" in parsed) ||
      parsed.version !== 1 ||
      !("origin" in parsed) ||
      typeof parsed.origin !== "string"
    ) {
      return null;
    }
    return normalizeBackendOrigin(parsed.origin);
  } catch {
    return null;
  }
}
