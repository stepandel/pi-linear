import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { graphql, setAuth, _resetAuth } from "../src/linear-api.js";
import { OAuthTokenManager } from "../src/oauth-token-manager.js";

describe("graphql() auth modes", () => {
  const originalFetch = globalThis.fetch;

  function mockGraphqlResponse(data: unknown) {
    return vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data }),
    });
  }

  beforeEach(() => {
    _resetAuth();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    _resetAuth();
  });

  it("throws when auth not configured", async () => {
    await expect(graphql("{ viewer { id } }")).rejects.toThrow(
      "Linear auth not configured",
    );
  });

  it("sends bare API key in Authorization header", async () => {
    const mockFetch = mockGraphqlResponse({ viewer: { id: "123" } });
    globalThis.fetch = mockFetch;

    setAuth({ type: "apiKey", key: "lin_api_test123" });
    await graphql("{ viewer { id } }");

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe("lin_api_test123");
  });

  it("sends Bearer token for OAuth mode", async () => {
    // Mock the token manager
    const tokenManager = new OAuthTokenManager("id", "secret");
    vi.spyOn(tokenManager, "getToken").mockResolvedValue("oauth-token-xyz");

    const mockFetch = mockGraphqlResponse({ viewer: { id: "456" } });
    globalThis.fetch = mockFetch;

    setAuth({ type: "oauth", tokenManager });
    await graphql("{ viewer { id } }");

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe("Bearer oauth-token-xyz");
  });

  it("retries once on 401 in OAuth mode", async () => {
    const tokenManager = new OAuthTokenManager("id", "secret");
    const getTokenSpy = vi
      .spyOn(tokenManager, "getToken")
      .mockResolvedValueOnce("stale-token")
      .mockResolvedValueOnce("fresh-token");
    const invalidateSpy = vi.spyOn(tokenManager, "invalidate");

    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: false, status: 401, statusText: "Unauthorized", text: async () => "" };
      }
      return { ok: true, json: async () => ({ data: { viewer: { id: "789" } } }) };
    });

    setAuth({ type: "oauth", tokenManager });
    const result = await graphql<{ viewer: { id: string } }>("{ viewer { id } }");

    expect(result.viewer.id).toBe("789");
    expect(invalidateSpy).toHaveBeenCalledOnce();
    expect(getTokenSpy).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry on 401 in apiKey mode", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "bad key",
    });

    setAuth({ type: "apiKey", key: "lin_api_bad" });
    await expect(graphql("{ viewer { id } }")).rejects.toThrow(
      "Linear API HTTP 401",
    );
  });
});
