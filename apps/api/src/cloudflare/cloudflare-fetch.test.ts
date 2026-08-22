import { describe, expect, test } from "bun:test";

import { createCloudflareNoRedirectFetch } from "./cloudflare-fetch";

describe("Cloudflare no-redirect fetch", () => {
  test("uses manual redirect handling and rejects redirects", async () => {
    let redirect: RequestRedirect | undefined;
    const fetchRequest = (async (_input, init) => {
      redirect = init?.redirect;
      return new Response(null, { status: 302 });
    }) as typeof globalThis.fetch;
    const request = createCloudflareNoRedirectFetch(fetchRequest);

    await expect(request("https://example.com")).rejects.toThrow(
      "redirect response rejected",
    );
    expect(redirect).toBe("manual");
  });

  test("returns non-redirect responses unchanged", async () => {
    const expected = new Response("ok", { status: 200 });
    const request = createCloudflareNoRedirectFetch(
      (async () => expected) as typeof globalThis.fetch,
    );

    expect(await request("https://example.com")).toBe(expected);
  });
});
