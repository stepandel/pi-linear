#!/usr/bin/env node

import { createServer, type Server } from "node:http";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { URL } from "node:url";

const LINEAR_AUTHORIZE_URL = "https://linear.app/oauth/authorize";
const LINEAR_TOKEN_URL = "https://api.linear.app/oauth/token";
const LINEAR_API_URL = "https://api.linear.app/graphql";
const DEFAULT_SCOPES = "read,write";
const CALLBACK_PORT = 13457;
const CALLBACK_PATH = "/oauth/callback";
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
const TIMEOUT_MS = 120_000; // 2 minutes

// --- Helpers ---

function log(msg: string): void {
  console.log(`[pi-linear setup] ${msg}`);
}

function error(msg: string): void {
  console.error(`[pi-linear setup] ERROR: ${msg}`);
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (const arg of argv) {
    const match = arg.match(/^--([a-z-]+)=(.+)$/);
    if (match) {
      args[match[1]] = match[2];
    }
  }
  return args;
}

async function openBrowser(url: string): Promise<void> {
  const { exec } = await import("node:child_process");
  const platform = process.platform;
  const cmd =
    platform === "darwin"
      ? "open"
      : platform === "win32"
        ? "start"
        : "xdg-open";

  return new Promise((resolve, reject) => {
    exec(`${cmd} "${url}"`, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function waitForCallback(port: number): Promise<{ code: string }> {
  return new Promise((resolve, reject) => {
    let server: Server;

    const timeout = setTimeout(() => {
      server?.close();
      reject(new Error("Timed out waiting for OAuth callback (2 minutes)"));
    }, TIMEOUT_MS);

    server = createServer((req, res) => {
      if (!req.url?.startsWith(CALLBACK_PATH)) {
        res.writeHead(404);
        res.end("Not Found");
        return;
      }

      const url = new URL(req.url, `http://localhost:${port}`);
      const code = url.searchParams.get("code");
      const errorParam = url.searchParams.get("error");

      if (errorParam) {
        const desc = url.searchParams.get("error_description") ?? errorParam;
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(htmlPage("Setup Failed", `<p>Linear returned an error: <strong>${escapeHtml(desc)}</strong></p><p>You can close this tab.</p>`));
        clearTimeout(timeout);
        server.close();
        reject(new Error(`OAuth authorization failed: ${desc}`));
        return;
      }

      if (!code) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(htmlPage("Setup Failed", "<p>No authorization code received.</p>"));
        clearTimeout(timeout);
        server.close();
        reject(new Error("No authorization code in callback"));
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(htmlPage("Setup Complete", "<p>App installed successfully. You can close this tab.</p>"));
      clearTimeout(timeout);
      server.close();
      resolve({ code });
    });

    server.listen(port, () => {
      log(`Callback server listening on port ${port}`);
    });

    server.on("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to start callback server: ${(err as NodeJS.ErrnoException).message}`));
    });
  });
}

async function exchangeCodeForToken(
  code: string,
  clientId: string,
  clientSecret: string,
): Promise<{ access_token: string; expires_in: number; scope: string }> {
  const res = await fetch(LINEAR_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Token exchange failed (HTTP ${res.status}): ${body}`);
  }

  return (await res.json()) as { access_token: string; expires_in: number; scope: string };
}

async function fetchClientCredentialsToken(
  clientId: string,
  clientSecret: string,
): Promise<{ access_token: string; expires_in: number; scope: string }> {
  const res = await fetch(LINEAR_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: DEFAULT_SCOPES,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`client_credentials token request failed (HTTP ${res.status}): ${body}`);
  }

  return (await res.json()) as { access_token: string; expires_in: number; scope: string };
}

async function verifyToken(token: string): Promise<{ name: string; email?: string }> {
  const res = await fetch(LINEAR_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: "{ viewer { id name email } }" }),
  });

  if (!res.ok) {
    throw new Error(`API verification failed (HTTP ${res.status})`);
  }

  const json = (await res.json()) as {
    data?: { viewer: { id: string; name: string; email?: string } };
    errors?: { message: string }[];
  };

  if (json.errors?.length) {
    throw new Error(`API error: ${json.errors[0].message}`);
  }

  return json.data!.viewer;
}

function loadExistingConfig(configPath: string): Record<string, unknown> {
  if (existsSync(configPath)) {
    try {
      return JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function htmlPage(title: string, body: string): string {
  return `<!DOCTYPE html><html><head><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;text-align:center;color:#333}
h1{font-size:1.5rem}p{color:#666}</style></head>
<body><h1>${escapeHtml(title)}</h1>${body}</body></html>`;
}

// --- Main ---

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const clientId = args["client-id"];
  const clientSecret = args["client-secret"];
  const webhookSecret = args["webhook-secret"];
  const configDir = args["config-dir"] ?? ".";
  const skipInstall = args["skip-install"] === "true";

  if (!clientId || !clientSecret) {
    console.log(`
Usage: npx pi-linear setup --client-id=<id> --client-secret=<secret> [options]

Required:
  --client-id=<id>          OAuth app client ID from Linear
  --client-secret=<secret>  OAuth app client secret from Linear

Optional:
  --webhook-secret=<secret> Webhook signing secret (auto-generated if omitted)
  --config-dir=<path>       Directory for .pi/linear.json (default: current dir)
  --skip-install=true       Skip the OAuth install flow (if app is already installed)
`);
    process.exit(1);
  }

  const configPath = join(configDir, ".pi", "linear.json");

  // Step 1: Install the app into the workspace via OAuth authorize flow
  if (!skipInstall) {
    log("Step 1/3: Installing app into workspace...");

    const state = randomBytes(16).toString("hex");
    const authorizeUrl = `${LINEAR_AUTHORIZE_URL}?${new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      scope: DEFAULT_SCOPES,
      actor: "app",
      response_type: "code",
      state,
    })}`;

    log("Opening browser for admin authorization...");
    log(`If the browser doesn't open, visit:\n  ${authorizeUrl}\n`);

    try {
      await openBrowser(authorizeUrl);
    } catch {
      // browser open failed, user will use the printed URL
    }

    const { code } = await waitForCallback(CALLBACK_PORT);
    log("Authorization code received.");

    // Exchange the code — this completes the installation
    log("Exchanging authorization code...");
    await exchangeCodeForToken(code, clientId, clientSecret);
    log("App installed successfully.");
  } else {
    log("Step 1/3: Skipping install (--skip-install=true)");
  }

  // Step 2: Verify client_credentials token works
  log("Step 2/3: Verifying client_credentials token...");
  const tokenResult = await fetchClientCredentialsToken(clientId, clientSecret);
  const viewer = await verifyToken(tokenResult.access_token);
  log(`Authenticated as: ${viewer.name}${viewer.email ? ` (${viewer.email})` : ""}`);
  log(`Token scopes: ${tokenResult.scope}`);
  log(`Token expires in: ${Math.round(tokenResult.expires_in / 86400)} days`);

  // Step 3: Write config
  log("Step 3/3: Writing config...");

  const piDir = join(configDir, ".pi");
  if (!existsSync(piDir)) mkdirSync(piDir, { recursive: true });

  const existing = loadExistingConfig(configPath);
  const secret = webhookSecret ?? (existing.webhookSecret as string) ?? randomBytes(32).toString("hex");

  const config: Record<string, unknown> = {
    ...existing,
    clientId,
    clientSecret,
    webhookSecret: secret,
    enableAgentSessions: true,
  };

  // Remove apiKey if switching to OAuth
  delete config.apiKey;

  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  log(`Config written to ${configPath}`);

  if (!webhookSecret && !existing.webhookSecret) {
    log(`Generated webhook secret: ${secret}`);
    log("Set this as the signing secret in your Linear app's webhook settings.");
  }

  console.log(`
Setup complete! Next steps:
  1. In Linear app settings, set the webhook URL to your server
     (e.g. https://your-host:3456/hooks/linear)
  2. Set the webhook signing secret to: ${secret}
  3. Make sure "Agent session events" is enabled in webhook settings
  4. Start your agent — it will use OAuth automatically
`);
}

main().catch((err) => {
  error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
