import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { emitAgentActivity, updateAgentSession } from "../src/agent-activity.js";
import { setAuth, _resetAuth } from "../src/linear-api.js";

describe("agent activity mutations", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    setAuth({ type: "apiKey", key: "lin_api_test" });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    _resetAuth();
  });

  it("emitAgentActivity sends correct GraphQL mutation", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { agentActivityCreate: { success: true } } }),
    });
    globalThis.fetch = mockFetch;

    await emitAgentActivity("session-1", "thought", "Thinking...");

    expect(mockFetch).toHaveBeenCalledOnce();
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.query).toContain("agentActivityCreate");
    expect(body.variables.input).toEqual({
      agentSessionId: "session-1",
      type: "thought",
      content: "Thinking...",
    });
  });

  it("updateAgentSession sends correct GraphQL mutation", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { agentSessionUpdate: { success: true } } }),
    });
    globalThis.fetch = mockFetch;

    await updateAgentSession("session-2", "complete");

    expect(mockFetch).toHaveBeenCalledOnce();
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.query).toContain("agentSessionUpdate");
    expect(body.variables.id).toBe("session-2");
    expect(body.variables.input).toEqual({ state: "complete" });
  });
});
