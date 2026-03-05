import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { setAuth } from "./linear-api.js";
import { OAuthTokenManager } from "./oauth-token-manager.js";
import { loadConfig } from "./config.js";
import { createWebhookHandler } from "./webhook-handler.js";
import { createEventRouter, type RouterAction } from "./event-router.js";
import { InboxQueue, type EnqueueEntry } from "./work-queue.js";
import { createDebouncer } from "./debouncer.js";
import { formatErrorMessage } from "./utils.js";

import { createQueueTool } from "./tools/queue-tool.js";
import { createIssueTool } from "./tools/linear-issue-tool.js";
import { createCommentTool } from "./tools/linear-comment-tool.js";
import { createTeamTool } from "./tools/linear-team-tool.js";
import { createProjectTool } from "./tools/linear-project-tool.js";
import { createRelationTool } from "./tools/linear-relation-tool.js";
import { createAgentSessionTool } from "./tools/linear-agent-session-tool.js";
import { handleAgentSessionEvent } from "./agent-session.js";
import type { AgentSessionEventPayload } from "./agent-session-types.js";

const DEFAULT_DEBOUNCE_MS = 30_000;
const DEFAULT_WEBHOOK_PORT = 3456;

let webhookServer: Server | undefined;

export default function activate(pi: ExtensionAPI): void {
  const cwd = "."; // pi extensions run in the project root
  const config = loadConfig(cwd);

  if (!config) {
    console.error(
      "[linear] Missing auth config (LINEAR_API_KEY or LINEAR_CLIENT_ID+LINEAR_CLIENT_SECRET) " +
      "and LINEAR_WEBHOOK_SECRET — extension is inert. Set env vars or create .pi/linear.json",
    );
    return;
  }

  if (config.clientId && config.clientSecret) {
    const tokenManager = new OAuthTokenManager(config.clientId, config.clientSecret);
    setAuth({ type: "oauth", tokenManager });
  } else if (config.apiKey) {
    setAuth({ type: "apiKey", key: config.apiKey });
  }

  const agentMapping = config.agentMapping ?? {};
  if (Object.keys(agentMapping).length === 0) {
    console.info("[linear] agentMapping is empty — all webhook events will be dropped");
  }

  const debounceMs =
    config.debounceMs && config.debounceMs > 0
      ? config.debounceMs
      : DEFAULT_DEBOUNCE_MS;

  // --- Queue setup ---
  const queueDir = join(cwd, ".pi", "linear");
  if (!existsSync(queueDir)) mkdirSync(queueDir, { recursive: true });
  const queuePath = join(queueDir, "inbox.jsonl");
  const queue = new InboxQueue(queuePath);

  // Recover stale in_progress items from a previous crash
  queue.recover().then((count) => {
    if (count > 0) {
      console.info(`[linear] Recovered ${count} stale in_progress queue item(s)`);
    }
  }).catch((err) => {
    console.error(`[linear] Queue recovery failed: ${formatErrorMessage(err)}`);
  });

  // --- Register tools ---
  const tools = [
    createQueueTool(queue),
    createIssueTool(),
    createCommentTool(),
    createTeamTool(),
    createProjectTool(),
    createRelationTool(),
    ...(config.enableAgentSessions ? [createAgentSessionTool()] : []),
  ];

  for (const tool of tools) {
    pi.registerTool(tool as Parameters<typeof pi.registerTool>[0]);
  }

  // --- Auto-wake: after queue "complete", nudge agent if items remain ---
  pi.on("tool_result", async (event) => {
    // Only trigger after a successful linear_queue complete action
    if (event.toolName !== "linear_queue") return;
    if (event.isError) return;

    // Check the result text for the "completed" field to confirm it was a complete action
    const resultText = event.content?.[0]?.type === "text" ? event.content[0].text : "";
    if (!resultText.includes('"completed"')) return;

    const remaining = await queue.peek();
    if (remaining.length === 0) return;

    pi.sendUserMessage(
      `${remaining.length} item(s) remaining in Linear queue. Use the linear_queue tool to continue processing.`,
    );
  });

  // --- Webhook server & event routing ---
  const logger = {
    info: (msg: string) => console.info(msg),
    error: (msg: string) => console.error(msg),
  };

  const routeEvent = createEventRouter({
    agentMapping,
    logger,
    eventFilter: config.eventFilter?.length ? config.eventFilter : undefined,
    teamIds: config.teamIds?.length ? config.teamIds : undefined,
    stateActions: config.stateActions,
  });

  const debouncer = createDebouncer<RouterAction>({
    delayMs: debounceMs,
    buildKey: (action) => action.agentId,
    onFlush: async (actions) => {
      await dispatchActions(actions, pi, queue, logger);
    },
    onError: (err) => {
      logger.error(`[linear] Debounce flush failed: ${formatErrorMessage(err)}`);
    },
  });

  const handler = createWebhookHandler({
    webhookSecret: config.webhookSecret,
    logger,
    onAgentSessionEvent: config.enableAgentSessions
      ? (event) => {
          handleAgentSessionEvent(
            event as unknown as AgentSessionEventPayload,
            pi,
            queue,
            logger,
          );
        }
      : undefined,
    onEvent: (event) => {
      const actions = routeEvent(event);
      for (const action of actions) {
        logger.info(
          `[event-router] ${action.type} agent=${action.agentId} event=${action.event}: ${action.detail}`,
        );

        if (action.type === "wake") {
          debouncer.enqueue(action);
        }

        if (action.type === "notify") {
          queue
            .enqueue([
              {
                id: action.commentId || action.identifier,
                issueId: action.identifier,
                event: action.event,
                summary: action.issueLabel,
                issuePriority: action.issuePriority,
              },
            ])
            .catch((err) =>
              logger.error(`[linear] Notify enqueue error: ${formatErrorMessage(err)}`),
            );
        }
      }
    },
  });

  const port = config.webhookPort ?? DEFAULT_WEBHOOK_PORT;
  webhookServer = createServer(async (req, res) => {
    // Route only /hooks/linear, return 404 for everything else
    if (req.url === "/hooks/linear" || req.url === "/hooks/linear/") {
      await handler(req, res);
    } else {
      res.writeHead(404);
      res.end("Not Found");
    }
  });

  webhookServer.listen(port, () => {
    logger.info(`[linear] Webhook server listening on port ${port} at /hooks/linear (debounce: ${debounceMs}ms)`);
  });

  // Cleanup on shutdown
  pi.on("session_shutdown", () => {
    debouncer.flushAll().catch(() => {});
    if (webhookServer) {
      webhookServer.close();
      webhookServer = undefined;
    }
  });
}

async function dispatchActions(
  actions: RouterAction[],
  pi: ExtensionAPI,
  queue: InboxQueue,
  logger: { info: (msg: string) => void; error: (msg: string) => void },
): Promise<void> {
  if (actions.length === 0) return;

  const entries: EnqueueEntry[] = actions.map((a) => ({
    id: a.commentId || a.identifier,
    issueId: a.identifier,
    event: a.event,
    summary: a.issueLabel,
    issuePriority: a.issuePriority,
  }));
  const added = await queue.enqueue(entries);

  if (added === 0) {
    logger.info("[linear] All notifications deduped — skipping agent dispatch");
    return;
  }

  // Send a user message to trigger the agent to process the queue
  pi.sendUserMessage(
    `${added} new Linear notification(s) queued. Use the linear_queue tool to process them.`,
  );
}
