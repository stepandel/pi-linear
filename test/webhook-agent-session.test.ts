import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import { createWebhookHandler } from "../src/webhook-handler.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { EventEmitter } from "node:events";

function makeReqRes(body: string, secret: string) {
  const signature = createHmac("sha256", secret).update(body).digest("hex");

  const req = new EventEmitter() as IncomingMessage;
  req.method = "POST";
  req.url = "/hooks/linear";
  req.headers = {
    "linear-signature": signature,
    "linear-delivery": `delivery-${Date.now()}`,
  };

  const res = {
    writeHead: vi.fn(),
    end: vi.fn(),
  } as unknown as ServerResponse;

  // Simulate body delivery
  setTimeout(() => {
    (req as EventEmitter).emit("data", Buffer.from(body));
    (req as EventEmitter).emit("end");
  }, 0);

  return { req, res };
}

describe("webhook handler AgentSession routing", () => {
  it("routes AgentSession events to onAgentSessionEvent", async () => {
    const onEvent = vi.fn();
    const onAgentSessionEvent = vi.fn();
    const logger = { info: vi.fn(), error: vi.fn() };

    const handler = createWebhookHandler({
      webhookSecret: "test-secret",
      logger,
      onEvent,
      onAgentSessionEvent,
    });

    const body = JSON.stringify({
      action: "created",
      type: "AgentSession",
      data: { id: "session-abc" },
      createdAt: new Date().toISOString(),
    });

    const { req, res } = makeReqRes(body, "test-secret");
    await handler(req, res);

    expect(onAgentSessionEvent).toHaveBeenCalledOnce();
    expect(onAgentSessionEvent.mock.calls[0][0].type).toBe("AgentSession");
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("routes non-AgentSession events to onEvent", async () => {
    const onEvent = vi.fn();
    const onAgentSessionEvent = vi.fn();
    const logger = { info: vi.fn(), error: vi.fn() };

    const handler = createWebhookHandler({
      webhookSecret: "test-secret",
      logger,
      onEvent,
      onAgentSessionEvent,
    });

    const body = JSON.stringify({
      action: "update",
      type: "Issue",
      data: { id: "issue-xyz" },
      createdAt: new Date().toISOString(),
    });

    const { req, res } = makeReqRes(body, "test-secret");
    await handler(req, res);

    expect(onEvent).toHaveBeenCalledOnce();
    expect(onAgentSessionEvent).not.toHaveBeenCalled();
  });

  it("falls back to onEvent when onAgentSessionEvent is not provided", async () => {
    const onEvent = vi.fn();
    const logger = { info: vi.fn(), error: vi.fn() };

    const handler = createWebhookHandler({
      webhookSecret: "test-secret",
      logger,
      onEvent,
    });

    const body = JSON.stringify({
      action: "created",
      type: "AgentSession",
      data: { id: "session-def" },
      createdAt: new Date().toISOString(),
    });

    const { req, res } = makeReqRes(body, "test-secret");
    await handler(req, res);

    expect(onEvent).toHaveBeenCalledOnce();
  });
});
