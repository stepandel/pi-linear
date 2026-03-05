export type AgentActivityType =
  | "thought"
  | "action"
  | "elicitation"
  | "response"
  | "error";

export type AgentSessionState =
  | "active"
  | "complete"
  | "error"
  | "awaitingInput";

export interface AgentSessionEventPayload {
  action: "created" | "prompted";
  type: "AgentSession";
  agentSessionId: string;
  promptContext?: {
    message?: string;
    issueId?: string;
    [key: string]: unknown;
  };
  data: Record<string, unknown>;
  createdAt: string;
}
