import { expect, test } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { CodexAdapter } from '@main/agent/codex'
import { runProcess, type ProcessRunner } from '@main/agent/process'
import { JsonlDecoder } from '@main/agent/protocol'
import type { AgentPayload } from '@shared/agent'

test.skipIf(process.env.AI_DB_TEST_AGENT !== '1')(
  'real subscription CLI adapter start/resume (two quota turns, no DB)',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ai-db-agent-integration-'))
    const diagnostics: unknown[] = []
    const runner: ProcessRunner = async (options) => {
      if (!options.input) return runProcess(options)
      const observer = new JsonlDecoder((input) => {
        const event = input as {
          type?: string
          message?: string
          error?: { message?: string }
          item?: { type?: string; message?: string }
        }
        const message =
          event.message ?? event.error?.message ?? event.item?.message ?? ''
        diagnostics.push({
          type: event.type,
          itemType: event.item?.type,
          unsupportedModel: /model.*not supported|model_not_found/i.test(
            message,
          ),
        })
      })
      try {
        const result = await runProcess({
          ...options,
          stdout: (chunk) => {
            observer.push(chunk)
            options.stdout?.(chunk)
          },
        })
        observer.finish()
        diagnostics.push({
          exitCode: result.code,
          unsupportedModel: /model.*not supported|model_not_found/i.test(
            result.stderr,
          ),
        })
        return result
      } catch (error) {
        diagnostics.push({
          transportError: error instanceof Error ? error.message : 'transport',
        })
        throw error
      }
    }
    const adapter = new CodexAdapter(directory, runner)
    try {
      expect(await adapter.detect()).toMatchObject({
        available: true,
        auth: 'subscription',
      })
      const events: AgentPayload[] = []
      await adapter.start(
        {
          prompt:
            'Remember marker STUDIO_42. Reply exactly STUDIO_42. Do not use any tools.',
          signal: new AbortController().signal,
        },
        (event) => events.push(event),
      )
      expect(events.at(-1), JSON.stringify({ events, diagnostics })).toEqual({
        type: 'done',
        outcome: 'completed',
      })
      const session = events.find((event) => event.type === 'session')
      if (session?.type !== 'session') throw new Error('No session')
      const resumed: AgentPayload[] = []
      await adapter.resume(
        {
          sessionId: session.sessionId,
          prompt:
            'What marker did I ask you to remember? Reply only with the marker. Do not use tools.',
          signal: new AbortController().signal,
        },
        (event) => resumed.push(event),
      )
      expect(resumed.at(-1), JSON.stringify({ resumed, diagnostics })).toEqual({
        type: 'done',
        outcome: 'completed',
      })
      expect(
        resumed.some(
          (event) => event.type === 'text' && event.text.includes('STUDIO_42'),
        ),
      ).toBe(true)
    } finally {
      await adapter.dispose()
      const target = resolve(directory)
      if (
        target.startsWith(resolve(tmpdir())) &&
        basename(target).startsWith('ai-db-agent-integration-')
      )
        await rm(target, { recursive: true, force: true })
    }
  },
  180_000,
)
