export function createCloudflareNoRedirectFetch(
  fetchRequest: typeof globalThis.fetch = globalThis.fetch.bind(globalThis),
): typeof globalThis.fetch {
  const request = async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await fetchRequest(input, {
      ...init,
      redirect: "manual",
    });
    if (response.status >= 300 && response.status < 400) {
      throw new TypeError("redirect response rejected");
    }
    return response;
  };
  return request as typeof globalThis.fetch;
}
