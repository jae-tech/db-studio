import { expect, test } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { openMcpScope } from '@main/mcp/broker'
import { MetadataCache } from '@main/mcp/metadata'
import { CopilotAdapter } from '@main/agent/copilot'
import type { AgentPayload } from '@shared/agent'
import type { SqlProposal } from '@shared/mcp'

// Opt-in: uses the signed-in official GitHub Copilot CLI and its premium requests.
test.skipIf(process.env.AI_DB_TEST_COPILOT !== '1')(
  'official Copilot CLI: isolated home, ai_db MCP discovery, SELECT proposal and same-session resume',
  async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'aidb-copilot-'))
    const table = `items_${randomUUID().slice(0, 8)}`
    const column = `metric_${randomUUID().slice(0, 8)}`
    const adapter = new CopilotAdapter(workspace)
    const turn = async (prompt: string, sessionId?: string) => {
      const controller = new AbortController()
      const proposals: SqlProposal[] = []
      const scope = await openMcpScope(
        {
          key: randomUUID(),
          connectionId: randomUUID(),
          database: 'copilot_fixture_not_live',
          maxRows: 10,
          assertCurrent: () => {},
          tables: async () => [{ schema: 'dbo', name: table }],
          describe: async () => ({
            columns: [
              {
                name: 'id',
                type: 'int',
                nullable: false,
                primaryKey: true,
                ordinal: 1,
              },
              {
                name: column,
                type: 'int',
                nullable: true,
                primaryKey: false,
                ordinal: 2,
              },
            ],
            indexes: [],
            foreignKeys: [],
          }),
        },
        new MetadataCache(),
        controller.signal,
        (proposal) => proposals.push(proposal),
        {
          executable: process.execPath,
          script: resolve('out/main/mcp-stdio.js'),
          electron: false,
        },
      )
      const events: AgentPayload[] = []
      try {
        const run = { prompt, signal: controller.signal, mcp: scope.launch }
        if (sessionId)
          await adapter.resume({ ...run, sessionId }, (e) => events.push(e))
        else await adapter.start(run, (e) => events.push(e))
      } finally {
        await scope.close()
      }
      return { events, proposals }
    }
    try {
      expect(await adapter.inspectAuth()).toMatchObject({
        provider: 'copilot',
        available: true,
      })
      const first = await turn(
        'Use the ai_db tools: call db_list_tables, then db_describe_table for the table you find, then call db_propose_sql once with a SELECT of id and the non-key column from that dbo table, with a short explanation. Do not use SELECT *. Reply briefly.',
      )
      expect(first.events.at(-1), JSON.stringify(first.events)).toEqual({
        type: 'done',
        outcome: 'completed',
      })
      expect(first.events).toContainEqual({
        type: 'tool',
        name: 'db_list_tables',
        status: 'completed',
      })
      expect(first.proposals).toHaveLength(1)
      expect(first.proposals[0]!.sql).toContain(column)
      expect(first.proposals[0]!.sql).toContain(table)
      const session = first.events.find((e) => e.type === 'session')
      if (session?.type !== 'session') throw new Error('No session')

      const second = await turn(
        'Call ai_db db_list_databases once and reply with only the database name.',
        session.sessionId,
      )
      expect(second.events.at(-1), JSON.stringify(second.events)).toEqual({
        type: 'done',
        outcome: 'completed',
      })
      expect(second.events).toContainEqual({
        type: 'session',
        sessionId: session.sessionId,
      })
      expect(JSON.stringify(second.events)).toContain(
        'copilot_fixture_not_live',
      )
    } finally {
      await adapter.dispose()
      await rm(workspace, { recursive: true, force: true })
    }
  },
  300_000,
)
