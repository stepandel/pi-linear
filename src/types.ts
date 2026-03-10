// Linear Agent webhook payload types

export interface AgentSessionEventPayload {
  action: "created" | "prompted";
  type: "AgentSessionEvent";
  agentSession: AgentSessionPayload;
  agentActivity?: AgentActivityPayload;
  promptContext?: string;
  previousComments?: CommentPayload[];
  guidance?: GuidanceRulePayload[];
  appUserId: string;
  oauthClientId: string;
  organizationId: string;
  webhookId: string;
  webhookTimestamp: number;
  createdAt: string;
}

export interface AgentSessionPayload {
  id: string;
  status: AgentSessionStatus;
  appUserId: string;
  issue?: IssuePayload;
  issueId?: string;
  comment?: CommentPayload;
  creator?: UserPayload;
  creatorId?: string;
  sourceCommentId?: string;
  sourceMetadata?: Record<string, unknown>;
  summary?: string;
  url?: string;
  startedAt?: string;
  endedAt?: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
  organizationId: string;
  type: string;
}

export type AgentSessionStatus =
  | "pending"
  | "active"
  | "awaitingInput"
  | "complete"
  | "error"
  | "stale";

export interface IssuePayload {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  url: string;
  priority: number;
  state?: { name: string; type: string };
  labels?: Array<{ name: string }>;
  assignee?: UserPayload;
  project?: { name: string; id: string };
}

export interface CommentPayload {
  id: string;
  body: string;
  userId?: string;
  user?: UserPayload;
  createdAt: string;
}

export interface UserPayload {
  id: string;
  name: string;
  email?: string;
}

export interface GuidanceRulePayload {
  id: string;
  instruction: string;
}

export interface AgentActivityPayload {
  id: string;
  content: AgentActivityContent;
  createdAt: string;
}

export type AgentActivityContent =
  | { type: "thought"; body: string }
  | { type: "action"; action: string; parameter: string; result?: string }
  | { type: "response"; body: string }
  | { type: "error"; body: string }
  | { type: "elicitation"; body: string }
  | { type: "prompt"; body: string };
