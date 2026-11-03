import { StringDecoder } from 'node:string_decoder'
import { z } from 'zod'
import type { AgentPayload, AgentProvider } from '@shared/agent'
import { toolNameSchema } from '@shared/mcp'

const record = z.object({ type: z.string() }).passthrough()
const session = z.string().uuid()
const tokens = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export function classifyError(message: string): 'auth' | 'limit' | 'process' {
  if (
    /rate.?limit|usage.?limit|quota|\b429\b|insufficient_quota/i.test(message)
  )
    return 'limit'
  if (
    /auth|login|sign.?in|unauthorized|\b(?:401|403)\b|credential/i.test(message)
  )
    return 'auth'
  return 'process'
}
// Never forward raw diagnostics, tool arguments, reasoning, or unknown provider fields.
export function decodeEvent(
  provider: AgentProvider,
  input: unknown,
  allowMcp = false,
): AgentPayload[] {
  const event = record.parse(input)
  if (provider === 'codex') {
    if (event.type === 'thread.started')
      return [{ type: 'session', sessionId: session.parse(event.thread_id) }]
    if (event.type.startsWith('item.')) {
      const item = record.parse(event.item)
      if (item.type === 'mcp_tool_call' && allowMcp) {
        if (item.server !== 'ai_db') throw new Error('Unscoped MCP server')
        const name = toolNameSchema.parse(item.tool)
        if (event.type === 'item.started' || event.type === 'item.completed')
          return [
            {
              type: 'tool',
              name,
              status: event.type === 'item.started' ? 'started' : 'completed',
            },
          ]
        return []
      }
      if (item.type === 'error') {
        const message = z.string().max(16_384).parse(item.message)
        // 0.164.0 labels this expected startup notice as an error item, but
        // proceeds with a successful tool-free turn. Never ignore other errors.
        if (
          message.startsWith('Code Mode is ') &&
          message.includes('is disabled.')
        )
          return []
        return [
          {
            type: 'error',
            code: classifyError(message),
            message:
              'CLI reported an error. Check authentication and subscription usage in the official CLI.',
          },
        ]
      }
      if (
        !['agent_message', 'reasoning', 'plan', 'todo_list'].includes(item.type)
      ) {
        throw new Error('Unexpected tool event')
      }
      if (event.type === 'item.completed' && item.type === 'agent_message') {
        return [
          { type: 'text', text: z.string().max(128_000).parse(item.text) },
        ]
      }
    }
    if (event.type === 'turn.completed') {
      const usage = z
        .object({ input_tokens: tokens, output_tokens: tokens })
        .parse(event.usage)
      return [
        {
          type: 'usage',
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
        },
        { type: 'done', outcome: 'completed' },
      ]
    }
    if (event.type === 'turn.failed' || event.type === 'error') {
      const detail =
        event.type === 'error'
          ? event
          : z.object({ message: z.string() }).parse(event.error)
      return [
        {
          type: 'error',
          code: classifyError(String(detail.message)),
          message:
            'CLI request failed. Check login and subscription usage in the official CLI.',
        },
      ]
    }
    if (event.type === 'turn.started' || event.type.startsWith('item.'))
      return []
    throw new Error('Unknown Codex event')
  }
  return []
}

export class JsonlDecoder {
  private readonly decoder = new StringDecoder('utf8')
  private pending = ''
  private bytes = 0
  private records = 0
  constructor(private readonly accept: (value: unknown) => void) {}
  push(chunk: Buffer): void {
    this.bytes += chunk.length
    if (this.bytes > 1_048_576) throw new Error('CLI output limit exceeded')
    this.consume(this.decoder.write(chunk), false)
  }
  finish(): void {
    this.consume(this.decoder.end(), true)
  }
  private consume(text: string, final: boolean): void {
    this.pending += text
    const lines = this.pending.split('\n')
    this.pending = lines.pop() ?? ''
    if (Buffer.byteLength(this.pending) > 262_144)
      throw new Error('CLI line limit exceeded')
    if (final && this.pending.trim()) {
      lines.push(this.pending)
      this.pending = ''
    }
    for (const line of lines) {
      if (Buffer.byteLength(line) > 262_144)
        throw new Error('CLI line limit exceeded')
      if (line.trim()) {
        if (++this.records > 2048)
          throw new Error('CLI event count limit exceeded')
        this.accept(JSON.parse(line) as unknown)
      }
    }
  }
}
