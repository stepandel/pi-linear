import type { TSchema } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";

export function formatErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function safeParseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function jsonResult(data: unknown): { content: { type: "text"; text: string }[]; details: undefined } {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    details: undefined,
  };
}

export function stringEnum<T extends readonly string[]>(
  values: T,
  options?: { description?: string },
): TSchema {
  return Type.Unsafe<T[number]>({
    type: "string",
    enum: [...values],
    ...(options?.description ? { description: options.description } : {}),
  });
}

