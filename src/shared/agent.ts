import { z } from 'zod'
import type { SqlProposal } from './mcp'
import { sqlFormattingSchema } from './sqlFormatting'

export const providerSchema = z.enum(['codex', 'copilot'])
// CLI model id (e.g. gpt-5-codex); never a flag, path or quoted value.
export const agentModelSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/,
    '모델 이름 형식이 올바르지 않습니다.',
  )
export type AgentProvider = z.infer<typeof providerSchema>
export const agentRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    provider: providerSchema,
    prompt: z.string().trim().min(1).max(16_000),
    resume: z.boolean(),
    // Absent = the CLI's own default model.
    model: agentModelSchema.optional(),
    context: z
      .object({
        connectionId: z.string().uuid(),
        shareSchema: z.literal(true),
        sqlFormatting: sqlFormattingSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
export const agentCancelSchema = z
  .object({ requestId: z.string().uuid() })
  .strict()
export type AgentRequest = z.infer<typeof agentRequestSchema>
export type AgentStatus = {
  provider: AgentProvider
  installed: boolean | null
  version?: string
  auth: 'subscription' | 'api-key' | 'unknown' | 'unavailable'
  available: boolean
  reason: string
  // Model ids the installed CLI offers (local catalog, no network/AI call).
  models?: string[]
}
export type AgentPayload =
  | { type: 'tool'; name: string; status: 'started' | 'completed' }
  | { type: 'proposal'; proposal: SqlProposal }
  | { type: 'text'; text: string }
  | { type: 'session'; sessionId: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | {
      type: 'error'
      code: 'auth' | 'limit' | 'protocol' | 'process' | 'timeout' | 'policy'
      message: string
    }
  | { type: 'done'; outcome: 'completed' | 'cancelled' | 'failed' }
export type AgentEvent = AgentPayload & {
  requestId: string
  provider: AgentProvider
}
export interface AgentApi {
  status(): Promise<AgentStatus[]>
  start(input: AgentRequest): Promise<void>
  cancel(input: { requestId: string }): Promise<void>
  reset(provider: AgentProvider): Promise<void>
  onEvent(listener: (event: AgentEvent) => void): () => void
}
