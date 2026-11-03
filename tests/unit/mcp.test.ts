import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { connect } from 'node:net'
import { toolNames, tools, type SqlProposal } from '@shared/mcp'
import { MetadataCache, type MetadataScope } from '@main/mcp/metadata'
import { ToolSession } from '@main/mcp/session'
import { McpProtocol } from '@main/mcp/protocol'
import { openMcpScope } from '@main/mcp/broker'
import { decodeEvent, JsonlDecoder } from '@main/agent/protocol'
import { codexArguments } from '@main/agent/codex'
import { useWorkspace } from '@/store'

function fixture() {
  let current = true
  let now = Date.now()
  const scope: MetadataScope = {
    key: randomUUID(),
    connectionId: randomUUID(),
    database: 'fixture',
    maxRows: 10,
    assertCurrent: () => {
      if (!current) throw new Error('connection changed secret')
    },
    tables: vi.fn(async () => [{ schema: 'dbo', name: 'items' }]),
    describe: vi.fn(async () => ({
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
    })),
  }
  const cache = new MetadataCache(() => now)
  const controller = new AbortController()
  const proposals: SqlProposal[] = []
  const session = new ToolSession(
    scope,
    cache,
    controller.signal,
    (proposal) => proposals.push(proposal),
    () => now,
  )
  return {
    scope,
    cache,
    controller,
    proposals,
    session,
    invalidate: () => {
      current = false
    },
    advance: (ms: number) => {
      now += ms
    },
  }
}
const payload = (result: Awaited<ReturnType<ToolSession['call']>>) =>
  JSON.parse(result.content[0]!.text) as Record<string, unknown>
describe('scoped metadata tools (no query execution port)', () => {
  it('exposes exactly the seven specified tools with no arbitrary SQL bridge', () => {
    expect(tools.map((tool) => tool.name)).toEqual(toolNames)
    expect(tools.every((tool) => tool.annotations.readOnlyHint)).toBe(true)
    expect(JSON.stringify(tools)).not.toContain('execute_query')
  })
  it('lists only the scoped database and reads schema without rows or credentials', async () => {
    const { session, scope } = fixture()
    expect(
      payload(await session.call('db_list_databases', {})).databases,
    ).toEqual(['fixture'])
    expect(payload(await session.call('db_list_tables', {})).tables).toEqual([
      { schema: 'dbo', name: 'items' },
    ])
    const schema = payload(await session.call('db_get_schema', {}))
    expect(schema).toMatchObject({
      database: 'fixture',
      truncated: false,
      untrustedMetadata: true,
    })
    expect(JSON.stringify(schema)).toContain('id')
    expect(scope.describe).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(schema)).not.toContain('password')
  })
  it.each([
    ['db_list_tables', { connectionId: randomUUID() }],
    ['db_get_schema', { database: 'another' }],
    ['db_describe_table', { schema: 'dbo', table: 'missing' }],
    [
      'db_get_foreign_keys',
      { schema: 'dbo', table: 'items', sql: 'DROP TABLE items' },
    ],
    ['db_propose_sql', { sql: 'DELETE FROM dbo.items', explanation: 'bad' }],
    ['db_propose_sql', { sql: 'SELECT 1; SELECT 2;', explanation: 'bad' }],
    // ADR-028: AI SELECTs must list columns.
    ['db_propose_sql', { sql: 'SELECT * FROM dbo.items', explanation: 'bad' }],
    [
      'db_propose_sql',
      { sql: 'SELECT i.id, i.* FROM dbo.items AS i', explanation: 'bad' },
    ],
    ['db_execute_query', { sql: 'SELECT 1' }],
  ])('refuses out-of-scope/extra/unsafe arguments: %s', async (name, args) => {
    const { session, proposals } = fixture()
    expect(await session.call(name, args)).toMatchObject({ isError: true })
    expect(proposals).toHaveLength(0)
  })
  it('publishes normalized SELECT proposals for the app to run, without approval tokens or rows', async () => {
    const { session, proposals, scope } = fixture()
    const result = payload(
      await session.call('db_propose_sql', {
        sql: 'SELECT 42 AS answer',
        explanation: 'Review this constant query.',
      }),
    )
    expect(result).toEqual({
      proposalId: proposals[0]?.id,
      autoRunByApp: true,
      rowsSharedWithAssistant: false,
    })
    expect(proposals[0]).toMatchObject({
      connectionId: scope.connectionId,
      database: 'fixture',
    })
    expect(proposals[0]?.sql).toContain('42')
    expect(JSON.stringify(proposals)).not.toContain('approvalToken')
    expect(scope.tables).not.toHaveBeenCalled()
  })
  it('requires proposal tables to exist in the bound metadata, never another database', async () => {
    const { session, proposals } = fixture()
    expect(
      await session.call('db_propose_sql', {
        sql: 'SELECT id FROM dbo.missing',
        explanation: 'guess',
      }),
    ).toMatchObject({ isError: true })
    expect(
      await session.call('db_propose_sql', {
        sql: 'SELECT id FROM otherdb.dbo.items',
        explanation: 'outside',
      }),
    ).toMatchObject({ isError: true })
    expect(
      await session.call('db_propose_sql', {
        sql: 'SELECT id FROM dbo.items',
        explanation: 'review',
      }),
    ).not.toHaveProperty('isError')
    expect(proposals).toHaveLength(1)
  })
  it('does not pretend a static analysis is a server execution plan', async () => {
    const { session, scope } = fixture()
    expect(
      payload(
        await session.call('db_explain_query', { sql: 'SELECT 1 AS value' }),
      ),
    ).toMatchObject({ supported: false })
    expect(scope.tables).not.toHaveBeenCalled()
    expect(
      await session.call('db_explain_query', { sql: 'EXEC p' }),
    ).toMatchObject({ isError: true })
  })
  it('bounds schema tables/columns, response bytes, calls, proposals and expiry', async () => {
    const f = fixture()
    vi.mocked(f.scope.tables).mockResolvedValue(
      Array.from({ length: 500 }, (_, n) => ({ schema: 'dbo', name: `t${n}` })),
    )
    expect(payload(await f.session.call('db_get_schema', {}))).toMatchObject({
      truncated: true,
    })
    expect(f.scope.describe).toHaveBeenCalledTimes(8)
    for (let n = 0; n < 39; n++) await f.session.call('db_list_databases', {})
    expect(await f.session.call('db_list_databases', {})).toMatchObject({
      isError: true,
    })
    const g = fixture()
    for (let n = 0; n < 5; n++)
      await g.session.call('db_propose_sql', {
        sql: 'SELECT 1 AS a',
        explanation: 'review',
      })
    expect(
      await g.session.call('db_propose_sql', {
        sql: 'SELECT 1 AS a',
        explanation: 'review',
      }),
    ).toMatchObject({ isError: true })
    expect(g.proposals).toHaveLength(5)
    g.advance(130001)
    expect(await g.session.call('db_get_schema', {})).toMatchObject({
      isError: true,
    })
  })
  it('refuses huge outputs and cancelled/disconnected metadata even from cache', async () => {
    const f = fixture()
    vi.mocked(f.scope.describe).mockResolvedValue({
      columns: [
        {
          name: 'x'.repeat(30000),
          type: 'int',
          nullable: false,
          primaryKey: false,
          ordinal: 1,
        },
      ],
      indexes: [],
      foreignKeys: [],
    })
    expect(
      await f.session.call('db_describe_table', {
        schema: 'dbo',
        table: 'items',
      }),
    ).toMatchObject({ isError: true })
    f.invalidate()
    const rejected = await f.session.call('db_list_tables', {})
    expect(rejected.isError).toBe(true)
    expect(JSON.stringify(rejected)).not.toContain('secret')
    const g = fixture()
    g.controller.abort()
    expect(await g.session.call('db_get_schema', {})).toMatchObject({
      isError: true,
    })
  })
  it('caches within a generation/TTL but never returns stale results after async scope changes', async () => {
    const f = fixture()
    await f.session.call('db_list_tables', {})
    await f.session.call('db_list_tables', {})
    expect(f.scope.tables).toHaveBeenCalledTimes(1)
    f.advance(30001)
    await f.session.call('db_list_tables', {})
    expect(f.scope.tables).toHaveBeenCalledTimes(2)
    f.scope.key = randomUUID()
    vi.mocked(f.scope.tables).mockImplementationOnce(async () => {
      f.invalidate()
      return []
    })
    expect(await f.session.call('db_list_tables', {})).toMatchObject({
      isError: true,
    })
  })
})

describe('MCP JSON-RPC lifecycle, catalog and strict calls', () => {
  it.each(['codex', 'copilot'])(
    'negotiates the standard stdio contract with a %s client fixture (not the real CLI)',
    async (name) => {
      const { session } = fixture()
      const protocol = new McpProtocol(session)
      expect(
        await protocol.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      ).toMatchObject({ error: { code: -32002 } })
      expect(
        await protocol.handle({
          jsonrpc: '2.0',
          id: 2,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name, version: 'fixture' },
          },
        }),
      ).toMatchObject({
        result: { capabilities: { tools: { listChanged: false } } },
      })
      expect(
        await protocol.handle({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        }),
      ).toBeUndefined()
      expect(
        await protocol.handle({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/list',
          params: { _meta: { progressToken: 'standard-mcp-metadata' } },
        }),
      ).toMatchObject({ result: { tools } })
      expect(
        await protocol.handle({
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: { name: 'db_list_databases', arguments: {} },
        }),
      ).toMatchObject({ result: { content: [{ type: 'text' }] } })
      expect(
        await protocol.handle({ jsonrpc: '2.0', id: 4, method: 'tools/list' }),
      ).toMatchObject({ error: { code: -32600 } })
      expect(
        await protocol.handle({
          jsonrpc: '2.0',
          id: 5,
          method: 'tools/call',
          params: { name: 'db_execute_query', arguments: {} },
        }),
      ).toMatchObject({ error: { code: -32602 } })
      expect(
        await protocol.handle({
          jsonrpc: '2.0',
          id: 6,
          method: 'resources/read',
        }),
      ).toMatchObject({ error: { code: -32601 } })
      expect(
        await protocol.handle([{ jsonrpc: '2.0', id: 7, method: 'ping' }]),
      ).toMatchObject({ error: { code: -32600 } })
    },
  )
  it('accepts only scoped MCP diagnostic events and never forwards raw tool results', () => {
    const raw = {
      type: 'item.completed',
      item: {
        type: 'mcp_tool_call',
        server: 'ai_db',
        tool: 'db_get_schema',
        arguments: { token: 'private' },
        result: 'sensitive-metadata',
      },
    }
    expect(() => decodeEvent('codex', raw)).toThrow()
    expect(decodeEvent('codex', raw, true)).toEqual([
      { type: 'tool', name: 'db_get_schema', status: 'completed' },
    ])
    expect(() =>
      decodeEvent(
        'codex',
        { ...raw, item: { ...raw.item, server: 'other' } },
        true,
      ),
    ).toThrow()
  })
  it('keeps capability values out of CLI argv and uses exactly one server allowlist', () => {
    const launch = {
      executable: process.execPath,
      script: 'C:\\app\\mcp-stdio.js',
      environment: {
        AI_DB_MCP_TOKEN: 'do-not-print',
        AI_DB_MCP_ADDRESS: 'local',
      },
    }
    const args = codexArguments(undefined, launch).join(' ')
    expect(args).toContain('mcp_servers={ai_db=')
    expect(args).toContain('enabled_tools=')
    expect(args).not.toContain('do-not-print')
    expect(args).not.toContain('http')
    expect(args).toContain('--enable code_mode_host')
    expect(args).toContain('--disable shell_tool')
    expect(args).toContain('--disable code_mode ')
  })
})

describe('local capability broker (no TCP listeners)', () => {
  it('serves valid newline-delimited requests, rejects wrong capabilities and revokes sockets on cancellation', async () => {
    const f = fixture()
    const broker = await openMcpScope(
      f.scope,
      f.cache,
      f.controller.signal,
      () => {},
      { executable: process.execPath, script: 'fixture.js', electron: false },
    )
    const address = broker.launch.environment.AI_DB_MCP_ADDRESS!
    const socket = connect(address)
    try {
      const received: unknown[] = []
      const decoder = new JsonlDecoder((value) => received.push(value))
      socket.on('data', (chunk: Buffer) => decoder.push(chunk))
      socket.write(
        JSON.stringify({
          token: broker.launch.environment.AI_DB_MCP_TOKEN,
          request: {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2025-06-18',
              capabilities: {},
              clientInfo: { name: 'test', version: '1' },
            },
          },
        }) + '\n',
      )
      await vi.waitFor(() => expect(received).toHaveLength(1))
      expect(received[0]).toMatchObject({
        result: { serverInfo: { name: 'ai-db-studio' } },
      })
      const wrong = connect(address)
      wrong.on('error', () => {})
      const denied = new Promise<void>((resolve) =>
        wrong.once('close', () => resolve()),
      )
      wrong.write(
        JSON.stringify({
          token: '0'.repeat(64),
          request: { jsonrpc: '2.0', id: 9, method: 'ping' },
        }) + '\n',
      )
      await denied
      const ended = new Promise<void>((resolve) =>
        socket.once('close', () => resolve()),
      )
      f.controller.abort()
      await ended
    } finally {
      socket.destroy()
      await broker.close()
    }
  })
})

it('opens a SQL proposal in a new tab rather than changing/executing the original SQL', () => {
  const store = useWorkspace.getState()
  const before = structuredClone(store.settings)
  const connectionId = randomUUID()
  store.openProposal('SELECT 42 AS answer;', connectionId)
  const after = useWorkspace.getState().settings
  expect(after.tabs).toHaveLength(before.tabs.length + 1)
  expect(after.tabs[0]).toEqual(before.tabs[0])
  expect(after.tabs.at(-1)).toMatchObject({
    title: 'AI 제안 · 검토 필요',
    connectionId,
    sql: 'SELECT  42 AS answer;',
  })
  useWorkspace.getState().update(before)
})

it('publishes arbitrary requested SQL only as explicitly unvalidated drafts that need a user preview', async () => {
  const f = fixture()
  const sql =
    'UPDATE t SET t.amount = e.amount FROM dbo.items AS t JOIN [import].[stage_fixture] AS e ON t.id = e.id;'
  const result = payload(
    await f.session.call('db_propose_sql', {
      sql,
      explanation: 'User-requested SQL draft only.',
      draft: true,
    }),
  )
  expect(result).toMatchObject({
    executed: false,
    validated: false,
    userPreviewAndConfirmationRequired: true,
  })
  expect(f.proposals[0]).toMatchObject({
    sql,
    draft: true,
    connectionId: f.scope.connectionId,
  })
  expect(f.scope.tables).not.toHaveBeenCalled()
  expect(JSON.stringify(f.proposals)).not.toMatch(/approvalToken|commitToken/)
})

it('discovers uploaded table column metadata and validates a staged SELECT without reading cells', async () => {
  const f = fixture()
  vi.mocked(f.scope.tables).mockResolvedValue([
    { schema: 'import', name: 'stage_fixture' },
  ])
  vi.mocked(f.scope.describe).mockResolvedValue({
    columns: [
      {
        name: '상품코드',
        type: 'nvarchar(max)',
        nullable: true,
        primaryKey: false,
        ordinal: 1,
      },
    ],
    indexes: [],
    foreignKeys: [],
  })
  expect(
    payload(await f.session.call('db_list_tables', { schema: 'import' })),
  ).toMatchObject({ tables: [{ schema: 'import', name: 'stage_fixture' }] })
  const result = await f.session.call('db_propose_sql', {
    sql: 'SELECT e.[상품코드] FROM [import].[stage_fixture] AS e',
    explanation: 'Use uploaded Excel source.',
  })
  expect(result).not.toHaveProperty('isError')
  expect(f.proposals[0]?.sql).toContain('[import].[stage_fixture] AS [e]')
  expect(f.proposals[0]).not.toHaveProperty('draft')
  expect(JSON.stringify(f.proposals)).not.toContain('values')
})
