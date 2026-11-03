import type { AgentPayload, AgentStatus } from '@shared/agent'
import type { McpLaunch } from '@shared/mcp'

export type AgentTurn = {
  prompt: string
  sessionId?: string
  signal: AbortSignal
  mcp?: McpLaunch
  model?: string
}
export interface AgentAdapter {
  detect(): Promise<AgentStatus>
  inspectAuth(): Promise<AgentStatus>
  start(turn: AgentTurn, emit: (event: AgentPayload) => void): Promise<void>
  resume(
    turn: AgentTurn & { sessionId: string },
    emit: (event: AgentPayload) => void,
  ): Promise<void>
  cancel(): void
  dispose(): Promise<void>
}
