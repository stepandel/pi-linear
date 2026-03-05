import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../src/config.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("loadConfig", () => {
  let tmpDir: string;

  const savedEnv: Record<string, string | undefined> = {};
  const envKeys = [
    "LINEAR_API_KEY",
    "LINEAR_CLIENT_ID",
    "LINEAR_CLIENT_SECRET",
    "LINEAR_WEBHOOK_SECRET",
    "LINEAR_ENABLE_AGENT_SESSIONS",
  ];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "config-test-"));
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when no auth config is present", () => {
    expect(loadConfig(tmpDir)).toBeNull();
  });

  it("returns null when apiKey is set but no webhook secret", () => {
    process.env.LINEAR_API_KEY = "lin_api_test";
    expect(loadConfig(tmpDir)).toBeNull();
  });

  it("loads with apiKey auth", () => {
    process.env.LINEAR_API_KEY = "lin_api_test";
    process.env.LINEAR_WEBHOOK_SECRET = "secret";
    const config = loadConfig(tmpDir);
    expect(config).not.toBeNull();
    expect(config!.apiKey).toBe("lin_api_test");
    expect(config!.clientId).toBeUndefined();
  });

  it("loads with client_credentials auth", () => {
    process.env.LINEAR_CLIENT_ID = "my-client-id";
    process.env.LINEAR_CLIENT_SECRET = "my-client-secret";
    process.env.LINEAR_WEBHOOK_SECRET = "secret";
    const config = loadConfig(tmpDir);
    expect(config).not.toBeNull();
    expect(config!.clientId).toBe("my-client-id");
    expect(config!.clientSecret).toBe("my-client-secret");
    expect(config!.apiKey).toBeUndefined();
  });

  it("returns null when only clientId is set (missing clientSecret)", () => {
    process.env.LINEAR_CLIENT_ID = "my-client-id";
    process.env.LINEAR_WEBHOOK_SECRET = "secret";
    expect(loadConfig(tmpDir)).toBeNull();
  });

  it("reads enableAgentSessions from env", () => {
    process.env.LINEAR_API_KEY = "lin_api_test";
    process.env.LINEAR_WEBHOOK_SECRET = "secret";
    process.env.LINEAR_ENABLE_AGENT_SESSIONS = "true";
    const config = loadConfig(tmpDir);
    expect(config!.enableAgentSessions).toBe(true);
  });

  it("reads enableAgentSessions from config file", () => {
    const piDir = join(tmpDir, ".pi");
    mkdirSync(piDir, { recursive: true });
    writeFileSync(
      join(piDir, "linear.json"),
      JSON.stringify({
        apiKey: "lin_api_test",
        webhookSecret: "secret",
        enableAgentSessions: true,
      }),
    );
    const config = loadConfig(tmpDir);
    expect(config!.enableAgentSessions).toBe(true);
  });
});
