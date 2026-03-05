import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OAuthTokenManager } from "../src/oauth-token-manager.js";

describe("OAuthTokenManager", () => {
  const originalFetch = globalThis.fetch;

  function mockFetchSuccess(token = "test-token", expiresIn = 86400) {
    return vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: token,
        token_type: "Bearer",
        expires_in: expiresIn,
      }),
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("fetches a token on first call", async () => {
    const mockFetch = mockFetchSuccess();
    globalThis.fetch = mockFetch;

    const mgr = new OAuthTokenManager("client-id", "client-secret");
    const token = await mgr.getToken();

    expect(token).toBe("test-token");
    expect(mockFetch).toHaveBeenCalledOnce();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.linear.app/oauth/token");
    expect(opts.method).toBe("POST");
    const body = opts.body as URLSearchParams;
    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("client_id")).toBe("client-id");
    expect(body.get("client_secret")).toBe("client-secret");
  });

  it("returns cached token on subsequent calls", async () => {
    const mockFetch = mockFetchSuccess();
    globalThis.fetch = mockFetch;

    const mgr = new OAuthTokenManager("id", "secret");
    await mgr.getToken();
    await mgr.getToken();
    await mgr.getToken();

    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("refetches after invalidate()", async () => {
    const mockFetch = mockFetchSuccess();
    globalThis.fetch = mockFetch;

    const mgr = new OAuthTokenManager("id", "secret");
    await mgr.getToken();
    mgr.invalidate();
    await mgr.getToken();

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("refetches when token is expired (past expiry buffer)", async () => {
    const mockFetch = mockFetchSuccess("token-1", 3600); // 1 hour — within the 1h buffer
    globalThis.fetch = mockFetch;

    const mgr = new OAuthTokenManager("id", "secret");
    const token1 = await mgr.getToken();
    expect(token1).toBe("token-1");

    // Token expires_in is 3600s but buffer is 3600s, so it's already "expired"
    // Advance a tiny bit and it should refetch
    vi.advanceTimersByTime(1000);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "token-2",
        token_type: "Bearer",
        expires_in: 86400,
      }),
    });

    const token2 = await mgr.getToken();
    expect(token2).toBe("token-2");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent requests", async () => {
    let resolveToken: (v: Response) => void;
    const fetchPromise = new Promise<Response>((r) => {
      resolveToken = r;
    });
    globalThis.fetch = vi.fn().mockReturnValue(fetchPromise);

    const mgr = new OAuthTokenManager("id", "secret");
    const p1 = mgr.getToken();
    const p2 = mgr.getToken();
    const p3 = mgr.getToken();

    resolveToken!({
      ok: true,
      json: async () => ({
        access_token: "coalesced",
        token_type: "Bearer",
        expires_in: 86400,
      }),
    } as Response);

    const [t1, t2, t3] = await Promise.all([p1, p2, p3]);
    expect(t1).toBe("coalesced");
    expect(t2).toBe("coalesced");
    expect(t3).toBe("coalesced");
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it("throws on HTTP error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: async () => "invalid_client",
    });

    const mgr = new OAuthTokenManager("bad-id", "bad-secret");
    await expect(mgr.getToken()).rejects.toThrow(
      "OAuth token request failed (HTTP 400): Bad Request: invalid_client",
    );
  });
});
