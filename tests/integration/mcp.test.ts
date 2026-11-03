import { expect, test } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { openMcpScope } from '@main/mcp/broker'
import { MetadataCache, type MetadataScope } from '@main/mcp/metadata'
import { JsonlDecoder } from '@main/agent/protocol'
import { agentEnvironment } from '@main/agent/process'
import { CodexAdapter } from '@main/agent/codex'
import type { AgentPayload } from '@shared/agent'
import type { SqlProposal } from '@shared/mcp'

function metadataFixture(): MetadataScope {
  return {
    key: randomUUID(),
    connectionId: randomUUID(),
    database: 'explicit_test_fixture_not_a_live_database',
    maxRows: 10,
    assertCurrent: () => {},
    tables: async () => [{ schema: 'dbo', name: 'items' }],
    describe: async () => ({
      columns: [
        {
          name: 'id',
          type: 'int',
          nullable: false,
          primaryKey: true,
          ordinal: 1,
        },
      ],
      indexes: [],
      foreignKeys: [],
    }),
  }
}
test.each(['codex', 'copilot', 'electron-runtime'])(
  'real stdio relay with %s protocol fixture (not the official CLI)',
  async (name) => {
    const controller = new AbortController()
    const proposals: SqlProposal[] = []
    const metadata = metadataFixture()
    const electron = name === 'electron-runtime'
    const runtimePath = electron
      ? (createRequire(import.meta.url)('electron') as string)
      : process.execPath
    const broker = await openMcpScope(
      metadata,
      new MetadataCache(),
      controller.signal,
      (proposal) => proposals.push(proposal),
      {
        executable: runtimePath,
        script: resolve('out/main/mcp-stdio.js'),
        electron,
      },
    )
    const child = spawn(broker.launch.executable, [broker.launch.script], {
      shell: false,
      windowsHide: true,
      env: { ...agentEnvironment(process.env), ...broker.launch.environment },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const closed = new Promise<void>((resolve, reject) => {
      child.once('close', () => resolve())
      child.once('error', reject)
    })
    const pending = new Map<
      number,
      { resolve(value: unknown): void; reject(error: Error): void }
    >()
    const decoder = new JsonlDecoder((value) => {
      const response = value as { id: number }
      pending.get(response.id)?.resolve(value)
      pending.delete(response.id)
    })
    child.stdout.on('data', (chunk: Buffer) => decoder.push(chunk))
    let diagnostics = 0
    child.stderr.on('data', (chunk: Buffer) => {
      diagnostics += chunk.length
    })
    child.stdin.on('error', () => {})
    const rpc = (
      id: number,
      method: string,
      params?: unknown,
    ): Promise<unknown> =>
      new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id)
          reject(new Error('MCP reply timed out'))
        }, 5000)
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timeout)
            resolve(value)
          },
          reject,
        })
        child.stdin.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id,
            method,
            ...(params === undefined ? {} : { params }),
          }) + '\n',
        )
      })
    try {
      expect(
        await rpc(1, 'initialize', {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name, version: 'fixture' },
        }),
      ).toMatchObject({ result: { serverInfo: { name: 'ai-db-studio' } } })
      child.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        }) + '\n',
      )
      const catalog = (await rpc(2, 'tools/list')) as {
        result: { tools: unknown[] }
      }
      expect(catalog.result.tools).toHaveLength(7)
      expect(
        await rpc(3, 'tools/call', { name: 'db_get_schema', arguments: {} }),
      ).toMatchObject({ result: { content: [{ type: 'text' }] } })
      expect(
        await rpc(4, 'tools/call', {
          name: 'db_propose_sql',
          arguments: {
            sql: 'SELECT 42 AS answer',
            explanation: 'Review this fixture query.',
          },
        }),
      ).toMatchObject({ result: { content: [{ type: 'text' }] } })
      expect(proposals).toHaveLength(1)
      expect(
        await rpc(5, 'tools/call', {
          name: 'db_execute_query',
          arguments: { sql: 'DROP TABLE items' },
        }),
      ).toMatchObject({ error: { code: -32602 } })
      expect(diagnostics).toBe(0)
      controller.abort()
      await closed
      expect(child.exitCode).toBe(0)
    } finally {
      child.kill()
      await broker.close()
    }
  },
)

test.skipIf(process.env.AI_DB_TEST_AGENT !== '1')(
  'official Codex CLI invokes scoped stdio metadata/proposal tools (fixture DB, real subscription turn)',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ai-db-mcp-live-'))
    const controller = new AbortController()
    const proposals: SqlProposal[] = []
    const metadata = metadataFixture()
    let broker = await openMcpScope(
      metadata,
      new MetadataCache(),
      controller.signal,
      (proposal) => proposals.push(proposal),
      {
        executable: process.execPath,
        script: resolve('out/main/mcp-stdio.js'),
        electron: false,
      },
    )
    const adapter = new CodexAdapter(directory)
    try {
      expect(await adapter.detect()).toMatchObject({
        available: true,
        auth: 'subscription',
      })
      const events: AgentPayload[] = []
      await adapter.start(
        {
          prompt:
            'This is a fixture-only MCP smoke test. Call ai_db db_get_schema with {} once. Then call ai_db db_propose_sql with sql SELECT 42 AS answer and explanation Review this constant fixture query. Do not use any other tools. Do not execute SQL. Then say done.',
          signal: controller.signal,
          mcp: broker.launch,
        },
        (event) => events.push(event),
      )
      expect(events.at(-1), JSON.stringify(events)).toEqual({
        type: 'done',
        outcome: 'completed',
      })
      expect(
        events.some(
          (event) =>
            event.type === 'tool' &&
            event.name === 'db_get_schema' &&
            event.status === 'completed',
        ),
        JSON.stringify(events),
      ).toBe(true)
      expect(proposals).toHaveLength(1)
      expect(proposals[0]?.sql).toContain('42')
      const session = events.find((event) => event.type === 'session')
      if (session?.type !== 'session') throw new Error('No successful session')
      const previousToken = broker.launch.environment.AI_DB_MCP_TOKEN
      await broker.close()
      broker = await openMcpScope(
        metadata,
        new MetadataCache(),
        controller.signal,
        (proposal) => proposals.push(proposal),
        {
          executable: process.execPath,
          script: resolve('out/main/mcp-stdio.js'),
          electron: false,
        },
      )
      expect(broker.launch.environment.AI_DB_MCP_TOKEN).not.toBe(previousToken)
      const resumed: AgentPayload[] = []
      await adapter.resume(
        {
          sessionId: session.sessionId,
          prompt:
            'Call ai_db db_list_databases once now. Do not use other tools. Report the scoped database name.',
          signal: controller.signal,
          mcp: broker.launch,
        },
        (event) => resumed.push(event),
      )
      expect(resumed.at(-1), JSON.stringify(resumed)).toEqual({
        type: 'done',
        outcome: 'completed',
      })
      expect(
        resumed.some(
          (event) =>
            event.type === 'tool' &&
            event.name === 'db_list_databases' &&
            event.status === 'completed',
        ),
        JSON.stringify(resumed),
      ).toBe(true)
    } finally {
      controller.abort()
      await adapter.dispose()
      await broker.close()
      const target = resolve(directory)
      if (
        target.startsWith(resolve(tmpdir())) &&
        basename(target).startsWith('ai-db-mcp-live-')
      )
        await rm(target, { recursive: true, force: true })
    }
  },
  160000,
)
