import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleAgentSessionEvent } from "../src/agent-session.js";
import * as agentActivity from "../src/agent-activity.js";
import type { AgentSessionEventPayload } from "../src/agent-session-types.js";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { InboxQueue } from "../src/work-queue.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("handleAgentSessionEvent", () => {
  let tmpDir: string;
  let queue: InboxQueue;
  let mockPi: ExtensionAPI;
  let logger: { info: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agent-session-test-"));
    queue = new InboxQueue(join(tmpDir, "inbox.jsonl"));
    mockPi = {
      sendUserMessage: vi.fn(),
      on: vi.fn(),
      registerTool: vi.fn(),
    } as unknown as ExtensionAPI;
    logger = { info: vi.fn(), error: vi.fn() };

    vi.spyOn(agentActivity, "emitAgentActivity").mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("immediately emits a thought activity for SLA acknowledgment", () => {
    const payload: AgentSessionEventPayload = {
      action: "created",
      type: "AgentSession",
      agentSessionId: "session-123",
      data: {},
      createdAt: new Date().toISOString(),
    };

    handleAgentSessionEvent(payload, mockPi, queue, logger);

    expect(agentActivity.emitAgentActivity).toHaveBeenCalledWith(
      "session-123",
      "thought",
      "Processing request...",
    );
  });

  it("enqueues a work item and sends a user message", async () => {
    const payload: AgentSessionEventPayload = {
      action: "prompted",
      type: "AgentSession",
      agentSessionId: "session-456",
      promptContext: { message: "Fix the login bug" },
      data: {},
      createdAt: new Date().toISOString(),
    };

    handleAgentSessionEvent(payload, mockPi, queue, logger);

    // Wait for the async enqueue to complete
    await vi.waitFor(async () => {
      const items = await queue.peek();
      expect(items.length).toBe(1);
    });

    const items = await queue.peek();
    expect(items[0].id).toBe("session-456");
    expect(items[0].event).toBe("agent_session");
    expect(items[0].summary).toContain("Fix the login bug");

    expect(mockPi.sendUserMessage).toHaveBeenCalledWith(
      expect.stringContaining("session-456"),
    );
  });
});
