import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type sql from 'mssql'
import { connectionSchema } from '@shared/database'
import { randomUUID } from 'node:crypto'
import {
  MssqlMutations,
  mutationMetadataSql,
  type MutationImports,
} from '@main/database/mssql/mutations'
import { parseMutation } from '@main/database/policy'

function driver(imports?: MutationImports) {
  const profile = connectionSchema.parse({
    id: randomUUID(),
    name: 'fixture',
    host: 'localhost',
    database: 'fixture',
    username: 'writer',
    readOnly: false,
  })
  const state = {
    transaction: false,
    header: {
      objectId: 1,
      schemaVersion: 'v1',
      canInspect: 1,
      canSelect: 1,
      canWrite: 1,
      risks: 0,
    },
    columns: [
      {
        name: 'id',
        systemType: 56,
        userType: 56,
        maxLength: 4,
        nullable: false,
        computed: false,
        identity: true,
        primaryKey: true,
        ordinal: 1,
        hidden: false,
        generatedAlways: 0,
        encrypted: false,
        masked: false,
      },
      {
        name: 'amount',
        systemType: 56,
        userType: 56,
        maxLength: 4,
        nullable: false,
        computed: false,
        identity: false,
        primaryKey: false,
        ordinal: 2,
        hidden: false,
        generatedAlways: 0,
        encrypted: false,
        masked: false,
      },
      {
        name: 'rv',
        systemType: 189,
        userType: 189,
        maxLength: 8,
        nullable: false,
        computed: false,
        identity: false,
        primaryKey: false,
        ordinal: 3,
        hidden: false,
        generatedAlways: 0,
        encrypted: false,
        masked: false,
      },
    ],
    rows: [['0x0000000000000001', '1', '10']] as unknown[][],
    output: [['0x0000000000000001']] as unknown[][],
    cancelled: 0,
    hold: false,
    changeSchema: false,
    headerCalls: 0,
    sent: [] as string[],
    inputs: [] as { name: string; value: unknown }[],
  }
  class Request extends EventEmitter {
    arrayRowMode = false
    private reject?: (cause: Error) => void
    input(name: string, _type: unknown, value: unknown): this {
      state.inputs.push({ name, value })
      return this
    }
    cancel(): boolean {
      state.cancelled++
      this.reject?.(new Error('request cancelled'))
      return true
    }
    async query<T>(text: string): Promise<{ recordset: T[] }> {
      state.sent.push(text)
      if (text === mutationMetadataSql.header) {
        state.headerCalls++
        return {
          recordset: [
            {
              ...state.header,
              schemaVersion:
                state.changeSchema && state.headerCalls > 1
                  ? 'v2'
                  : state.header.schemaVersion,
            },
          ] as T[],
        }
      }
      if (text === mutationMetadataSql.columns)
        return { recordset: state.columns as T[] }
      if (
        text.startsWith('SELECT COUNT(*) AS [count]') ||
        text.startsWith('SELECT COUNT_BIG(*) AS [count]')
      )
        return { recordset: [{ count: 2 }] as T[] }
      if (text.startsWith('SELECT TOP')) {
        if (state.hold)
          return new Promise((_, reject) => {
            this.reject = reject
          })
        return { recordset: state.rows as T[] }
      }
      return { recordset: state.output as T[] }
    }
  }
  const requests = new Map<string, sql.Request>()
  const mutations = new MssqlMutations(
    () => profile,
    () => new Request() as unknown as sql.Request,
    () => state.transaction,
    requests,
    imports,
  )
  const query = parseMutation('UPDATE dbo.items SET amount=20 WHERE id=1')
  const controller = new AbortController()
  const id = randomUUID()
  return {
    mutations,
    query,
    controller,
    id,
    state,
    profile,
    requests,
    preview: () => mutations.preview(query, id, controller.signal, false),
  }
}
describe('mssql mutation SQL and guard adapter (explicit driver request double)', () => {
  it('casts rowversion to binary before hexadecimal conversion in preview and OUTPUT', async () => {
    const f = driver()
    const snapshot = await f.preview()
    expect(
      f.state.sent.find((text) => text.startsWith('SELECT TOP')),
    ).toContain('CONVERT(varchar(18),CONVERT(binary(8),[rv]),1)')
    expect(snapshot.executionSql).toContain(
      'CONVERT(varchar(18),CONVERT(binary(8),deleted.[rv]),1)',
    )
  })
  it('uses parameter metadata and a bounded version-guarded OUTPUT statement; does not write during preview', async () => {
    const f = driver()
    const snapshot = await f.preview()
    expect(snapshot.versions).toEqual(['0x0000000000000001'])
    expect(snapshot.sample.rows).toEqual([{ c0: '1', c1: '10' }])
    expect(snapshot.executionSql).toContain(
      'OUTPUT CONVERT(varchar(18),CONVERT(binary(8),deleted.[rv]),1)',
    )
    expect(snapshot.executionSql).toContain('[rv] IN (0x0000000000000001)')
    expect(f.state.sent.every((text) => !text.startsWith('UPDATE'))).toBe(true)
    expect(f.state.inputs).toContainEqual({ name: 'schema', value: 'dbo' })
    expect(f.state.inputs).toContainEqual({
      name: 'permission',
      value: 'UPDATE',
    })
    await expect(
      f.mutations.preview(f.query, f.id, f.controller.signal, true),
    ).rejects.toThrow('requires a transaction')
    f.state.transaction = true
    const locked = await f.mutations.preview(
      f.query,
      f.id,
      f.controller.signal,
      true,
    )
    expect(
      f.state.sent.some((text) => text.includes('WITH (UPDLOCK,HOLDLOCK)')),
    ).toBe(true)
    expect(
      await f.mutations.apply(f.query, locked, f.id, f.controller.signal),
    ).toBe(1)
    expect(f.state.sent.at(-1)).toBe(snapshot.executionSql)
    expect(f.requests.size).toBe(0)
  })
  it.each(['canInspect', 'canSelect', 'canWrite', 'risks'] as const)(
    'fails closed when %s does not satisfy the table guard',
    async (key) => {
      const f = driver()
      f.state.header[key] = key === 'risks' ? 1 : 0
      await expect(f.preview()).rejects.toThrow('Write target refused')
      expect(
        f.state.sent.some(
          (text) => text.startsWith('SELECT TOP') || text.startsWith('UPDATE'),
        ),
      ).toBe(false)
    },
  )
  it.each([
    'no-pk',
    'computed',
    'lob',
    'user-type',
    'pk-assignment',
    'version-assignment',
    'wrong-case',
    'hidden',
    'generated',
    'encrypted',
    'masked',
  ])('refuses an unsupported target: %s', async (kind) => {
    const f = driver()
    let query = f.query
    if (kind === 'no-pk') f.state.columns[0]!.primaryKey = false
    if (kind === 'computed') f.state.columns[1]!.computed = true
    if (kind === 'hidden') f.state.columns[1]!.hidden = true
    if (kind === 'generated') f.state.columns[1]!.generatedAlways = 5
    if (kind === 'encrypted') f.state.columns[1]!.encrypted = true
    if (kind === 'masked') f.state.columns[1]!.masked = true
    if (kind === 'lob') f.state.columns[1]!.maxLength = -1
    if (kind === 'user-type') f.state.columns[1]!.userType = 1001
    if (kind === 'pk-assignment')
      query = parseMutation('UPDATE dbo.items SET id=2 WHERE id=1')
    if (kind === 'version-assignment')
      query = parseMutation("UPDATE dbo.items SET rv='0x123' WHERE id=1")
    if (kind === 'wrong-case')
      query = parseMutation('UPDATE dbo.items SET AMOUNT=2 WHERE id=1')
    await expect(
      f.mutations.preview(query, f.id, f.controller.signal, false),
    ).rejects.toThrow()
    expect(f.state.sent.some((text) => text.startsWith('UPDATE'))).toBe(false)
  })
  it('refuses zero, too many, duplicate targets and concurrent metadata changes', async () => {
    const f = driver()
    f.state.rows = []
    await expect(f.preview()).rejects.toThrow('between 1 and 1000')
    f.state.rows = Array.from({ length: 1001 }, (_, n) => [
      `0x${n.toString(16).padStart(16, '0')}`,
      String(n),
      '1',
    ])
    await expect(f.preview()).rejects.toThrow('between 1 and 1000')
    f.state.rows = [
      ['0x0000000000000001', '1', '1'],
      ['0x0000000000000001', '2', '1'],
    ]
    await expect(f.preview()).rejects.toThrow('Ambiguous')
    f.state.rows.pop()
    f.state.headerCalls = 0
    f.state.changeSchema = true
    await expect(f.preview()).rejects.toThrow('metadata changed')
  })
  it('compares execution SQL/metadata again and rejects unexpected affected versions', async () => {
    const f = driver()
    const snapshot = await f.preview()
    f.state.transaction = true
    await expect(
      f.mutations.apply(
        f.query,
        { ...snapshot, executionSql: 'DELETE FROM everything' },
        f.id,
        f.controller.signal,
      ),
    ).rejects.toThrow('changed')
    expect(f.state.sent.some((text) => text.startsWith('UPDATE'))).toBe(false)
    f.state.output = [['0x0000000000000002']]
    await expect(
      f.mutations.apply(f.query, snapshot, f.id, f.controller.signal),
    ).rejects.toThrow('Affected rows differ')
  })
  it('without a rowversion guards by exact PK text (ADR-035)', async () => {
    const f = driver()
    f.state.columns = f.state.columns.filter((column) => column.name !== 'rv')
    f.state.rows = [["2:1|O'k", '1', '10']]
    const snapshot = await f.preview()
    expect(snapshot.versions).toEqual(["2:1|O'k"])
    expect(snapshot.executionSql).toContain(
      'OUTPUT CONCAT(DATALENGTH(CONVERT(nvarchar(4000),deleted.[id])),',
    )
    // Snapshot text returns only as an escaped literal, case kept.
    expect(snapshot.executionSql).toContain(`IN (N'2:1|O''k')`)
    f.state.transaction = true
    f.state.output = [["2:1|o'k"]]
    await expect(
      f.mutations.apply(f.query, snapshot, f.id, f.controller.signal),
    ).rejects.toThrow('Affected rows differ')
    f.state.output = [["2:1|O'k"]]
    await expect(
      f.mutations.apply(f.query, snapshot, f.id, f.controller.signal),
    ).resolves.toBe(1)
  })
  it('limits the display sample while preserving all target versions, and supports DELETE generation', async () => {
    const f = driver()
    f.state.rows = Array.from({ length: 30 }, (_, n) => [
      `0x${n.toString(16).padStart(16, '0')}`,
      String(n),
      '1',
    ])
    const snapshot = await f.mutations.preview(
      parseMutation('DELETE FROM dbo.items WHERE id>0'),
      f.id,
      f.controller.signal,
      false,
    )
    expect(snapshot.versions).toHaveLength(30)
    expect(snapshot.sample.rows).toHaveLength(20)
    expect(snapshot.sample.truncated).toBe(true)
    expect(snapshot.executionSql).toMatch(/^DELETE FROM \[dbo\]\.\[items\]/)
  })
  it('cancels the active request and clears request tracking without sending a write', async () => {
    const f = driver()
    f.state.hold = true
    const pending = f.preview()
    const rejected = expect(pending).rejects.toThrow('cancelled')
    await vi.waitFor(() =>
      expect(f.state.sent.some((text) => text.startsWith('SELECT TOP'))).toBe(
        true,
      ),
    )
    f.controller.abort()
    await rejected
    expect(f.state.cancelled).toBe(1)
    expect(f.requests.size).toBe(0)
    expect(f.state.sent.some((text) => text.startsWith('UPDATE'))).toBe(false)
  })
})
describe('excel JOIN preview row counts (driver double)', () => {
  const table = `stage_${'a'.repeat(32)}`
  const stageId = randomUUID()
  const imports: MutationImports = {
    find: () => ({
      id: stageId,
      tableName: table,
      columns: ['id', 'amt'],
      rows: [
        ['1', '5'],
        ['8', '6'],
        ['9', '7'],
      ],
    }),
    load: async () => undefined,
    isolated: (run) => run(),
  }
  it('reports total and ON-unmatched stage rows on the unlocked preview only', async () => {
    const env = driver(imports)
    env.state.rows = [['0x0000000000000001', '1', '10', '5', 0]]
    const query = parseMutation(
      `UPDATE t SET amount = TRY_CONVERT(int, s.amt) FROM dbo.items AS t JOIN [import].[${table}] AS s ON t.id = TRY_CONVERT(int, s.id)`,
    )
    const snapshot = await env.mutations.preview(
      query,
      env.id,
      env.controller.signal,
      false,
    )
    expect(snapshot.importRows).toEqual({ total: 3, unmatched: 2 })
    expect(env.state.sent).toContainEqual(
      expect.stringMatching(
        /^SELECT COUNT\(\*\) AS \[count\] FROM \[#stage_a+\] AS \[s\] WHERE NOT EXISTS \(SELECT 1 FROM \[dbo\]\.\[items\] AS \[t\] WHERE /,
      ),
    )
    env.state.sent = []
    env.state.transaction = true
    const locked = await env.mutations.preview(
      query,
      env.id,
      env.controller.signal,
      true,
    )
    expect(locked.importRows).toBeUndefined()
    expect(env.state.sent.some((text) => text.includes('AS [count]'))).toBe(
      false,
    )
  })
  it('reports the stage total for INSERT without an extra query', async () => {
    const env = driver(imports)
    env.state.rows = [['9', 0]]
    const snapshot = await env.mutations.preview(
      parseMutation(
        `INSERT INTO dbo.items (amount) SELECT TRY_CONVERT(int, s.amt) FROM [import].[${table}] AS s LEFT JOIN dbo.items AS t ON t.id = TRY_CONVERT(int, s.id) WHERE t.id IS NULL`,
      ),
      env.id,
      env.controller.signal,
      false,
    )
    expect(snapshot.importRows).toEqual({ total: 3, unmatched: undefined })
    expect(env.state.sent.some((text) => text.includes('AS [count]'))).toBe(
      false,
    )
  })
})
describe('read-only change preview (driver double)', () => {
  it('shows current and new values without the write opt-in and sends no write', async () => {
    const env = driver()
    env.profile.readOnly = true
    env.state.rows = [['1', '10', '20']]
    const query = parseMutation('UPDATE dbo.items SET amount=20 WHERE id=1')
    const result = await env.mutations.inspect(
      query,
      env.id,
      env.controller.signal,
    )
    expect(result).toMatchObject({ kind: 'update', affectedRows: 2 })
    expect(result.sample.columns.map((column) => column.name)).toEqual([
      'id',
      'amount',
      '→ amount',
    ])
    expect(result.sample.rows).toEqual([{ c0: '1', c1: '10', c2: '20' }])
    expect(result.sample.truncated).toBe(true)
    expect(
      env.state.sent.some((text) => /^\s*(UPDATE|DELETE|INSERT)\b/i.test(text)),
    ).toBe(false)
    expect(env.state.sent).toContainEqual(
      expect.stringMatching(
        /^SELECT TOP \(20\) .* WHERE \(\[id\] = 1\) ORDER BY \[id\]$/,
      ),
    )
    // The guarded apply path still refuses a read-only profile.
    await expect(
      env.mutations.checkTarget(query, env.id, env.controller.signal),
    ).rejects.toThrow('opt-in')
  })
  it('lists the rows a DELETE would remove', async () => {
    const env = driver()
    env.state.rows = [['1', '10']]
    const result = await env.mutations.inspect(
      parseMutation('DELETE FROM dbo.items WHERE id = 1'),
      env.id,
      env.controller.signal,
    )
    expect(result.kind).toBe('delete')
    expect(result.sample.columns.map((column) => column.name)).toEqual([
      'id',
      'amount',
    ])
  })
})
