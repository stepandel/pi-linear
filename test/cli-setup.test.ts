import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

// Test the config file merge logic in isolation
// (The actual OAuth flow requires network, so we test the file operations)

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

function writeConfig(
  configDir: string,
  clientId: string,
  clientSecret: string,
  webhookSecret: string,
): Record<string, unknown> {
  const piDir = join(configDir, ".pi");
  if (!existsSync(piDir)) mkdirSync(piDir, { recursive: true });

  const configPath = join(piDir, "linear.json");
  const existing = loadExistingConfig(configPath);

  const config: Record<string, unknown> = {
    ...existing,
    clientId,
    clientSecret,
    webhookSecret,
    enableAgentSessions: true,
  };

  delete config.apiKey;

  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  return config;
}

describe("setup config writing", () => {
  let tmpDir: string;

  function setup() {
    tmpDir = mkdtempSync(join(tmpdir(), "setup-test-"));
    return tmpDir;
  }

  function cleanup() {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  it("creates .pi/linear.json from scratch", () => {
    const dir = setup();
    try {
      const config = writeConfig(dir, "cid", "csecret", "whsecret");
      expect(config.clientId).toBe("cid");
      expect(config.clientSecret).toBe("csecret");
      expect(config.webhookSecret).toBe("whsecret");
      expect(config.enableAgentSessions).toBe(true);

      const path = join(dir, ".pi", "linear.json");
      expect(existsSync(path)).toBe(true);
      const written = JSON.parse(readFileSync(path, "utf-8"));
      expect(written.clientId).toBe("cid");
    } finally {
      cleanup();
    }
  });

  it("merges with existing config and removes apiKey", () => {
    const dir = setup();
    try {
      const piDir = join(dir, ".pi");
      mkdirSync(piDir, { recursive: true });
      writeFileSync(
        join(piDir, "linear.json"),
        JSON.stringify({
          apiKey: "lin_api_old",
          agentMapping: { "uuid-1": "agent-1" },
          teamIds: ["ENG"],
        }),
      );

      const config = writeConfig(dir, "new-cid", "new-csecret", "new-wh");
      expect(config.apiKey).toBeUndefined();
      expect(config.clientId).toBe("new-cid");
      expect(config.agentMapping).toEqual({ "uuid-1": "agent-1" });
      expect(config.teamIds).toEqual(["ENG"]);
    } finally {
      cleanup();
    }
  });
});
