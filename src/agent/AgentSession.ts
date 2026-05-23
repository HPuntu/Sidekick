export type AgentEventKind = "assistant" | "status" | "tool" | "user";

export type AgentSessionStatus = "idle" | "running" | "error";

export interface AgentToolEvent {
  callId?: string;
  eventType: string;
  input?: unknown;
  name?: string;
  output?: unknown;
  raw?: unknown;
  status: "blocked" | "call" | "error" | "info" | "result";
  title: string;
}

export interface AgentEvent {
  id: string;
  kind: AgentEventKind;
  text: string;
  createdAt: string;
  tool?: AgentToolEvent;
}

export function createAgentEvent(
  id: string,
  kind: AgentEventKind,
  text: string,
  tool?: AgentToolEvent
): AgentEvent {
  return {
    id,
    kind,
    text,
    createdAt: new Date().toISOString(),
    tool
  };
}
