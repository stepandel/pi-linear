import { graphql } from "./linear-api.js";
import type { AgentActivityType, AgentSessionState } from "./agent-session-types.js";

export async function emitAgentActivity(
  sessionId: string,
  type: AgentActivityType,
  content: string,
): Promise<void> {
  await graphql(
    `mutation($input: AgentActivityCreateInput!) {
      agentActivityCreate(input: $input) {
        success
      }
    }`,
    {
      input: {
        agentSessionId: sessionId,
        type,
        content,
      },
    },
  );
}

export async function updateAgentSession(
  sessionId: string,
  state: AgentSessionState,
): Promise<void> {
  await graphql(
    `mutation($id: String!, $input: AgentSessionUpdateInput!) {
      agentSessionUpdate(id: $id, input: $input) {
        success
      }
    }`,
    {
      id: sessionId,
      input: { state },
    },
  );
}
