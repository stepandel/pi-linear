import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { AgentSessionEventPayload } from "./agent-session-types.js";
import { emitAgentActivity } from "./agent-activity.js";
import type { InboxQueue, EnqueueEntry } from "./work-queue.js";
import { formatErrorMessage } from "./utils.js";

export function handleAgentSessionEvent(
  payload: AgentSessionEventPayload,
  pi: ExtensionAPI,
  queue: InboxQueue,
  logger: { info: (msg: string) => void; error: (msg: string) => void },
): void {
  const { agentSessionId, action, promptContext } = payload;

  logger.info(`[linear] Agent session event: ${action} session=${agentSessionId}`);

  // Immediately acknowledge within the 10s SLA
  emitAgentActivity(agentSessionId, "thought", "Processing request...").catch(
    (err) => logger.error(`[linear] Failed to acknowledge session ${agentSessionId}: ${formatErrorMessage(err)}`),
  );

  // Enqueue a work item for the agent to process
  const summary = promptContext?.message
    ? `Agent session: ${promptContext.message}`
    : `Agent session ${action}`;

  const entry: EnqueueEntry = {
    id: agentSessionId,
    issueId: (promptContext?.issueId as string) ?? agentSessionId,
    event: "agent.session",
    summary,
    issuePriority: 0,
  };

  queue
    .enqueue([entry])
    .then((added) => {
      if (added > 0) {
        pi.sendUserMessage(
          `New Linear agent session (${agentSessionId}). Use the linear_agent_session tool to respond.`,
        );
      }
    })
    .catch((err) =>
      logger.error(`[linear] Agent session enqueue error: ${formatErrorMessage(err)}`),
    );
}
