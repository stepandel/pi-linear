import { Type, type Static } from "@sinclair/typebox";
import { jsonResult, stringEnum, formatErrorMessage } from "../utils.js";
import { emitAgentActivity, updateAgentSession } from "../agent-activity.js";
import type { ToolDefinition } from "../types.js";

const Params = Type.Object({
  action: stringEnum(
    ["thought", "action", "response", "error", "complete"] as const,
    {
      description:
        "thought: post an in-progress status update. " +
        "action: post an action activity (tool use, code generation). " +
        "response: post final response and complete the session. " +
        "error: post error and set session to error state. " +
        "complete: update session state to complete (no activity).",
    },
  ),
  sessionId: Type.String({
    description: "The agent session ID to interact with.",
  }),
  content: Type.Optional(
    Type.String({
      description:
        "Activity content. Required for thought, action, response, error.",
    }),
  ),
});
type Params = Static<typeof Params>;

export function createAgentSessionTool(): ToolDefinition {
  return {
    name: "linear_agent_session",
    label: "Linear Agent Session",
    description:
      "Interact with a Linear agent session. Post thought/action/response/error activities or complete the session.",
    parameters: Params,
    async execute(_toolCallId: string, params: Params) {
      try {
        switch (params.action) {
          case "thought":
          case "action":
            if (!params.content) {
              return jsonResult({ error: "content is required for " + params.action });
            }
            await emitAgentActivity(params.sessionId, params.action, params.content);
            return jsonResult({ success: true, action: params.action, sessionId: params.sessionId });

          case "response":
            if (!params.content) {
              return jsonResult({ error: "content is required for response" });
            }
            await emitAgentActivity(params.sessionId, "response", params.content);
            await updateAgentSession(params.sessionId, "complete");
            return jsonResult({ success: true, action: "response", sessionId: params.sessionId, completed: true });

          case "error":
            if (!params.content) {
              return jsonResult({ error: "content is required for error" });
            }
            await emitAgentActivity(params.sessionId, "error", params.content);
            await updateAgentSession(params.sessionId, "error");
            return jsonResult({ success: true, action: "error", sessionId: params.sessionId });

          case "complete":
            await updateAgentSession(params.sessionId, "complete");
            return jsonResult({ success: true, action: "complete", sessionId: params.sessionId });

          default:
            return jsonResult({
              error: `Unknown action: ${(params as { action: string }).action}`,
            });
        }
      } catch (err) {
        return jsonResult({
          error: `linear_agent_session error: ${formatErrorMessage(err)}`,
        });
      }
    },
  };
}
