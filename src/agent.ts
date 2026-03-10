import {
  AuthStorage,
  createAgentSession,
  createCodingTools,
  createExtensionRuntime,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type ResourceLoader,
  type AgentSession,
} from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";
import { activity } from "./linear.js";
import type { AgentSessionEventPayload } from "./types.js";

/** Track active agent sessions by Linear session ID */
const activeSessions = new Map<string, AgentSession>();

function createResourceLoader(systemPrompt: string): ResourceLoader {
  return {
    getExtensions: () => ({
      extensions: [],
      errors: [],
      runtime: createExtensionRuntime(),
    }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => systemPrompt,
    getAppendSystemPrompt: () => [],
    getPathMetadata: () => new Map(),
    extendResources: () => {},
    reload: async () => {},
  };
}

async function createSession(cwd: string, systemPrompt: string) {
  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey("anthropic", process.env.ANTHROPIC_API_KEY!);
  const modelRegistry = new ModelRegistry(authStorage);
  const model = getModel("anthropic", "claude-sonnet-4-20250514");

  const { session } = await createAgentSession({
    cwd,
    model,
    thinkingLevel: "medium",
    authStorage,
    modelRegistry,
    resourceLoader: createResourceLoader(systemPrompt),
    tools: createCodingTools(cwd),
    sessionManager: SessionManager.inMemory(),
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: true },
    }),
  });

  return session;
}

function buildSystemPrompt(payload: AgentSessionEventPayload): string {
  const issue = payload.agentSession.issue;
  const parts = [
    "You are a coding agent working on Linear issues.",
    "You have access to read, write, edit files and run bash commands.",
    "Be concise in your work. Focus on solving the issue.",
  ];

  if (issue) {
    parts.push(
      "",
      `## Current Issue: ${issue.identifier} - ${issue.title}`,
      issue.description || ""
    );
  }

  if (payload.promptContext) {
    parts.push("", "## Context from Linear", payload.promptContext);
  }

  if (payload.guidance?.length) {
    parts.push(
      "",
      "## Guidance",
      ...payload.guidance.map((g) => `- ${g.instruction}`)
    );
  }

  return parts.join("\n");
}

/**
 * Handle a new agent session (action: "created").
 * Acknowledges immediately, then runs the agent asynchronously.
 */
export async function handleSessionCreated(
  payload: AgentSessionEventPayload
): Promise<void> {
  const sessionId = payload.agentSession.id;
  const issue = payload.agentSession.issue;

  // 1. Acknowledge within 10 seconds
  await activity.thought(
    sessionId,
    `Looking at ${issue?.identifier ?? "this issue"}...`
  );

  // 2. Build prompt from issue context
  const prompt = issue?.description
    ? `Solve this issue: ${issue.identifier} - ${issue.title}\n\n${issue.description}`
    : "Analyze the codebase and help with the assigned task.";

  // 3. Run agent (fire-and-forget, errors are caught)
  runAgent(sessionId, payload, prompt).catch((err) => {
    console.error(`[agent] Session ${sessionId} failed:`, err);
    activity.error(sessionId, `Agent failed: ${err.message}`);
  });
}

/**
 * Handle a follow-up prompt (action: "prompted").
 * The user sent a message in an existing session.
 */
export async function handleSessionPrompted(
  payload: AgentSessionEventPayload
): Promise<void> {
  const sessionId = payload.agentSession.id;
  const userMessage = payload.agentActivity?.content;

  if (!userMessage || userMessage.type !== "prompt") {
    console.warn(`[agent] Prompted without a prompt activity for ${sessionId}`);
    return;
  }

  // Acknowledge
  await activity.thought(sessionId, "Reading your message...");

  const session = activeSessions.get(sessionId);
  if (session) {
    // Continue existing session with follow-up
    session.followUp(userMessage.body);
  } else {
    // Session was cleaned up; start fresh
    runAgent(sessionId, payload, userMessage.body).catch((err) => {
      console.error(`[agent] Session ${sessionId} follow-up failed:`, err);
      activity.error(sessionId, `Agent failed: ${err.message}`);
    });
  }
}

async function runAgent(
  linearSessionId: string,
  payload: AgentSessionEventPayload,
  prompt: string
): Promise<void> {
  const tag = payload.agentSession.issue?.identifier ?? linearSessionId.slice(0, 8);
  console.log(`[agent:${tag}] Starting agent session`);

  const cwd = process.cwd();
  const systemPrompt = buildSystemPrompt(payload);
  const session = await createSession(cwd, systemPrompt);

  activeSessions.set(linearSessionId, session);

  // Stream agent events to Linear activities + terminal logs
  let lastText = "";
  session.subscribe((event) => {
    switch (event.type) {
      case "agent_start":
        console.log(`[agent:${tag}] Agent started`);
        break;
      case "agent_end":
        console.log(`[agent:${tag}] Agent finished`);
        break;
      case "turn_start":
        console.log(`[agent:${tag}] Turn started`);
        break;
      case "turn_end":
        console.log(`[agent:${tag}] Turn ended`);
        break;
      case "message_start":
        console.log(`[agent:${tag}] Assistant message started`);
        break;
      case "message_end":
        console.log(`[agent:${tag}] Assistant message ended`);
        break;
      case "tool_execution_start": {
        console.log(
          `[agent:${tag}] Tool start: ${event.toolName}`,
          typeof event.args === "string"
            ? truncate(event.args, 100)
            : truncate(JSON.stringify(event.args), 100)
        );
        activity.action(linearSessionId, `Running ${event.toolName}`);
        break;
      }
      case "tool_execution_end": {
        const resultText =
          typeof event.result === "string"
            ? event.result
            : JSON.stringify(event.result ?? "");
        const preview = truncate(resultText, 200);
        console.log(
          `[agent:${tag}] Tool end: ${event.toolName}`,
          event.isError ? "(ERROR)" : "",
          truncate(resultText, 150)
        );
        activity.action(
          linearSessionId,
          `Ran ${event.toolName}`,
          undefined,
          preview
        );
        break;
      }
      case "message_update": {
        if (event.assistantMessageEvent?.type === "text_delta") {
          const delta = event.assistantMessageEvent.delta;
          process.stdout.write(delta);
          lastText += delta;
        }
        break;
      }
    }
  });

  try {
    await session.prompt(prompt);

    // Send final response
    const response = lastText.trim() || "Done.";
    console.log(`\n[agent:${tag}] Sending response (${response.length} chars)`);
    await activity.response(linearSessionId, response);
    console.log(`[agent:${tag}] Done`);
  } catch (err) {
    console.error(`[agent:${tag}] Error:`, err);
    throw err;
  } finally {
    activeSessions.delete(linearSessionId);
  }
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
}
