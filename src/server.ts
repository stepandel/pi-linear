import { Hono } from "hono";
import { verifySignature, parseAgentSessionEvent } from "./webhook.js";
import { handleSessionCreated, handleSessionPrompted } from "./agent.js";

export const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok" }));

app.post("/webhooks/linear", async (c) => {
  const rawBody = await c.req.text();

  // Verify signature if secret is configured
  const secret = process.env.LINEAR_WEBHOOK_SECRET;
  if (secret) {
    const signature = c.req.header("Linear-Signature") ?? undefined;
    if (!verifySignature(rawBody, signature, secret)) {
      return c.json({ error: "Invalid signature" }, 401);
    }
  }

  // Parse payload
  const body = JSON.parse(rawBody);
  const event = parseAgentSessionEvent(body);

  if (!event) {
    // Not an agent session event — ignore
    return c.json({ ok: true });
  }

  console.log(
    `[webhook] ${event.action} session=${event.agentSession.id} issue=${event.agentSession.issue?.identifier ?? "none"}`
  );

  // Respond immediately (Linear requires <5s response), handle async
  switch (event.action) {
    case "created":
      // Fire-and-forget: handleSessionCreated acknowledges within 10s
      handleSessionCreated(event).catch((err) =>
        console.error("[webhook] handleSessionCreated error:", err)
      );
      break;
    case "prompted":
      handleSessionPrompted(event).catch((err) =>
        console.error("[webhook] handleSessionPrompted error:", err)
      );
      break;
  }

  return c.json({ ok: true });
});
