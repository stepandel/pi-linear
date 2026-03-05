const TOKEN_URL = "https://api.linear.app/oauth/token";
const EXPIRY_BUFFER_MS = 60 * 60 * 1000; // 1 hour

export class OAuthTokenManager {
  private cachedToken: string | undefined;
  private expiresAt = 0;
  private inflight: Promise<string> | undefined;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  async getToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.expiresAt) {
      return this.cachedToken;
    }

    // Coalesce concurrent requests
    if (this.inflight) return this.inflight;

    this.inflight = this.fetchToken().finally(() => {
      this.inflight = undefined;
    });

    return this.inflight;
  }

  invalidate(): void {
    this.cachedToken = undefined;
    this.expiresAt = 0;
  }

  private async fetchToken(): Promise<string> {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });

    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body = await res.text();
        if (body) detail += `: ${body}`;
      } catch {
        // ignore
      }
      throw new Error(`OAuth token request failed (HTTP ${res.status}): ${detail}`);
    }

    const json = (await res.json()) as {
      access_token: string;
      token_type: string;
      expires_in: number;
    };

    this.cachedToken = json.access_token;
    this.expiresAt = Date.now() + json.expires_in * 1000 - EXPIRY_BUFFER_MS;

    return this.cachedToken;
  }
}
