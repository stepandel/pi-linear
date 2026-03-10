import { LinearGraphQLClient } from "@linear/sdk";
import type { AgentActivityContent } from "./types.js";

const LINEAR_API_URL = "https://api.linear.app/graphql";

let client: LinearGraphQLClient;

export function getLinearClient(): LinearGraphQLClient {
  if (!client) {
    const apiKey = process.env.LINEAR_API_KEY;
    if (!apiKey) throw new Error("LINEAR_API_KEY is required");
    client = new LinearGraphQLClient(LINEAR_API_URL, {
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
    });
  }
  return client;
}

const AGENT_ACTIVITY_CREATE = `
  mutation AgentActivityCreate($input: AgentActivityCreateInput!) {
    agentActivityCreate(input: $input) {
      success
      agentActivity {
        id
      }
    }
  }
`;

interface AgentActivityCreateResult {
  agentActivityCreate: {
    success: boolean;
    agentActivity?: { id: string };
  };
}

/**
 * Emit an agent activity to Linear.
 * Ephemeral activities (thought/action) disappear when the next activity arrives.
 */
export async function emitActivity(
  agentSessionId: string,
  content: AgentActivityContent,
  options?: { ephemeral?: boolean }
) {
  const linear = getLinearClient();
  try {
    const result = await linear.request<
      AgentActivityCreateResult,
      { input: Record<string, unknown> }
    >(AGENT_ACTIVITY_CREATE, {
      input: {
        agentSessionId,
        content,
        ephemeral: options?.ephemeral,
      },
    });
    if (!result.agentActivityCreate.success) {
      console.error("[linear] Failed to emit activity:", content.type);
    }
    return result;
  } catch (err) {
    console.error("[linear] Error emitting activity:", err);
    throw err;
  }
}

/** Quick helpers for common activity types */
export const activity = {
  thought(sessionId: string, body: string, ephemeral = true) {
    return emitActivity(sessionId, { type: "thought", body }, { ephemeral });
  },

  action(
    sessionId: string,
    action: string,
    parameter: string = "",
    result?: string
  ) {
    const content: AgentActivityContent = result
      ? { type: "action", action, parameter, result }
      : { type: "action", action, parameter };
    return emitActivity(sessionId, content, { ephemeral: !result });
  },

  response(sessionId: string, body: string) {
    return emitActivity(sessionId, { type: "response", body });
  },

  error(sessionId: string, body: string) {
    return emitActivity(sessionId, { type: "error", body });
  },

  elicitation(sessionId: string, body: string) {
    return emitActivity(sessionId, { type: "elicitation", body });
  },
};
