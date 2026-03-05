import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface LinearConfig {
  apiKey?: string;
  clientId?: string;
  clientSecret?: string;
  webhookSecret: string;
  webhookPort?: number;
  agentMapping?: Record<string, string>;
  teamIds?: string[];
  eventFilter?: string[];
  debounceMs?: number;
  stateActions?: Record<string, string>;
  enableAgentSessions?: boolean;
}

/**
 * Load Linear configuration from (in order of precedence):
 * 1. Environment variables (LINEAR_API_KEY, LINEAR_WEBHOOK_SECRET, etc.)
 * 2. A JSON config file at `.pi/linear.json` in the cwd
 *
 * Environment variables override file values.
 */
export function loadConfig(cwd: string): LinearConfig | null {
  let fileConfig: Partial<LinearConfig> = {};

  const configPath = join(cwd, ".pi", "linear.json");
  if (existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(readFileSync(configPath, "utf-8")) as Partial<LinearConfig>;
    } catch {
      // ignore parse errors — env vars may still be sufficient
    }
  }

  const apiKey = process.env.LINEAR_API_KEY ?? fileConfig.apiKey;
  const clientId = process.env.LINEAR_CLIENT_ID ?? fileConfig.clientId;
  const clientSecret = process.env.LINEAR_CLIENT_SECRET ?? fileConfig.clientSecret;
  const webhookSecret = process.env.LINEAR_WEBHOOK_SECRET ?? fileConfig.webhookSecret;

  if (!webhookSecret) return null;
  if (!apiKey && !(clientId && clientSecret)) return null;

  const enableAgentSessionsStr = process.env.LINEAR_ENABLE_AGENT_SESSIONS;
  const enableAgentSessions =
    enableAgentSessionsStr === "true" || enableAgentSessionsStr === "1"
      ? true
      : fileConfig.enableAgentSessions;

  const portStr = process.env.LINEAR_WEBHOOK_PORT;
  const webhookPort = portStr ? parseInt(portStr, 10) : fileConfig.webhookPort;

  let agentMapping = fileConfig.agentMapping;
  if (process.env.LINEAR_AGENT_MAPPING) {
    try {
      agentMapping = JSON.parse(process.env.LINEAR_AGENT_MAPPING) as Record<string, string>;
    } catch {
      // ignore
    }
  }

  let teamIds = fileConfig.teamIds;
  if (process.env.LINEAR_TEAM_IDS) {
    teamIds = process.env.LINEAR_TEAM_IDS.split(",").map((s) => s.trim());
  }

  let eventFilter = fileConfig.eventFilter;
  if (process.env.LINEAR_EVENT_FILTER) {
    eventFilter = process.env.LINEAR_EVENT_FILTER.split(",").map((s) => s.trim());
  }

  const debounceStr = process.env.LINEAR_DEBOUNCE_MS;
  const debounceMs = debounceStr ? parseInt(debounceStr, 10) : fileConfig.debounceMs;

  return {
    apiKey,
    clientId,
    clientSecret,
    webhookSecret,
    webhookPort: webhookPort && !isNaN(webhookPort) ? webhookPort : undefined,
    agentMapping,
    teamIds,
    eventFilter,
    debounceMs,
    stateActions: fileConfig.stateActions,
    enableAgentSessions,
  };
}
