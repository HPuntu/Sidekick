export type AgentEventKind = "assistant" | "status" | "tool" | "user";

export type AgentSessionStatus = "idle" | "running" | "error";

export interface AgentEvent {
  id: string;
  kind: AgentEventKind;
  text: string;
  createdAt: string;
}

export function createAgentEvent(
  id: string,
  kind: AgentEventKind,
  text: string
): AgentEvent {
  return {
    id,
    kind,
    text,
    createdAt: new Date().toISOString()
  };
}
