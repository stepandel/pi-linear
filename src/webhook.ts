import { createHmac, timingSafeEqual } from "node:crypto";
import type { AgentSessionEventPayload } from "./types.js";

/**
 * Verify Linear webhook signature.
 * Linear signs payloads with HMAC-SHA256 using the webhook secret.
 */
export function verifySignature(
  rawBody: string,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature) return false;

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");

  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * Parse and validate a Linear webhook payload as an AgentSessionEvent.
 * Returns null if the event type doesn't match.
 */
export function parseAgentSessionEvent(
  body: unknown
): AgentSessionEventPayload | null {
  const payload = body as Record<string, unknown>;

  if (payload.type !== "AgentSessionEvent") return null;
  if (payload.action !== "created" && payload.action !== "prompted")
    return null;

  return payload as unknown as AgentSessionEventPayload;
}
